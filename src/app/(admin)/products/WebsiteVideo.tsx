'use client';
// ZP-501: the "Video" block of the product's Website section (OWNER only).
// Upload / replace / remove one optional video. The file is sent in chunks
// (see src/lib/website/video.ts) with a progress bar, then processed on the
// server (sound and metadata removed, max 720x1280) while the panel shows
// "Processing". The preview plays from the signed-in route, so it works
// before the product is published.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VIDEO_ACCEPT_LABEL,
  VIDEO_INPUT_ACCEPT,
  VIDEO_MAX_UPLOAD_BYTES,
  VIDEO_REFUSALS,
} from '@/lib/website/video-validation';

interface AdminVideo {
  status: 'PROCESSING' | 'READY' | 'FAILED';
  url: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number | null;
  error: string | null;
  /** An upload is being processed (also a replacement, from another tab or device). */
  processing: boolean;
}

type Phase = { kind: 'idle' } | { kind: 'uploading'; fraction: number } | { kind: 'processing' };

const seconds = (ms: number | null) => (ms == null ? '' : `${Math.round(ms / 100) / 10} s`);
const megabytes = (b: number | null) => (b == null ? '' : `${(b / 1024 / 1024).toFixed(1)} MB`);

async function json(res: Response): Promise<{ error?: string } & Record<string, unknown>> {
  return res.json().catch(() => ({}));
}

/** PUT one chunk with upload progress (fetch has no upload progress). */
function putChunk(url: string, token: string, body: Blob, onProgress: (loaded: number) => void) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Upload-Token', token);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let error: string | undefined;
      try {
        error = JSON.parse(xhr.responseText).error;
      } catch {
        /* not JSON */
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, error });
    };
    xhr.onerror = () => resolve({ ok: false, error: 'The connection was lost during the upload. Please try again.' });
    xhr.send(body);
  });
}

export function WebsiteVideo({ productId }: { productId: number }) {
  const base = `/api/website/products/${productId}/video`;
  const [video, setVideo] = useState<AdminVideo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(base);
    const data = await json(res);
    if (res.ok) setVideo((data.video as AdminVideo | null) ?? null);
    else setError(data.error || 'Could not load the video');
    setLoaded(true);
  }, [base]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    load();
  }, [load]);

  const busy = phase.kind !== 'idle';

  const upload = async (file: File) => {
    setError(null);
    setNotice(null);
    if (file.size === 0) return setError(VIDEO_REFUSALS.empty);
    if (file.size > VIDEO_MAX_UPLOAD_BYTES) return setError(VIDEO_REFUSALS.tooLarge);

    setPhase({ kind: 'uploading', fraction: 0 });
    try {
      const startRes = await fetch(`${base}/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size: file.size }),
      });
      const start = await json(startRes);
      if (!startRes.ok) return setError(start.error || 'Could not start the upload');
      const token = start.token as string;
      const chunkSize = start.chunkSize as number;
      const chunks = start.chunks as number;

      for (let i = 0; i < chunks; i++) {
        const offset = i * chunkSize;
        const r = await putChunk(`${base}/chunks/${i}`, token, file.slice(offset, offset + chunkSize), (sent) =>
          setPhase({ kind: 'uploading', fraction: Math.min(1, (offset + sent) / file.size) }),
        );
        if (!r.ok) return setError(r.error || 'The upload failed. Please try again.');
      }

      setPhase({ kind: 'processing' });
      const doneRes = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const done = await json(doneRes);
      if (!doneRes.ok) {
        setError(done.error || 'The video could not be processed.');
        await load();
        return;
      }
      setVideo(done.video as AdminVideo);
      setNotice('Video ready. It shows on the website while the product is published.');
    } catch {
      setError('The upload failed. Please check the connection and try again.');
    } finally {
      setPhase({ kind: 'idle' });
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove the video from this product?')) return;
    setError(null);
    setNotice(null);
    const res = await fetch(base, { method: 'DELETE' });
    const data = await json(res);
    if (!res.ok) return setError(data.error || 'Could not remove the video');
    setVideo(null);
    setNotice('Video removed.');
  };

  const ready = video?.status === 'READY' && video.url;

  return (
    <div data-testid="website-video">
      <div className="flex items-center justify-between gap-2">
        <span className="label mb-0">Video (optional)</span>
        <input
          ref={fileRef}
          type="file"
          accept={VIDEO_INPUT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
          data-testid="website-video-input"
        />
        <div className="flex gap-2">
          {ready && (
            <button type="button" className="btn btn-sm btn-ghost text-rose-700" onClick={remove} disabled={busy} data-testid="website-video-remove">
              Remove
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => fileRef.current?.click()}
            disabled={busy || !loaded}
            data-testid="website-video-upload"
          >
            {ready ? 'Replace video' : 'Add video'}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-1">
        {VIDEO_ACCEPT_LABEL}. Sound and location data are removed. The main photo is still required.
      </p>

      {phase.kind === 'uploading' && (
        <div className="mt-2" data-testid="website-video-progress">
          <div className="h-2 w-full rounded bg-slate-200 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.fraction * 100)}>
            <div className="h-full bg-[var(--color-brand-olive)] transition-[width]" style={{ width: `${Math.round(phase.fraction * 100)}%` }} />
          </div>
          <p className="text-xs text-slate-600 mt-1">Uploading… {Math.round(phase.fraction * 100)}%</p>
        </div>
      )}
      {(phase.kind === 'processing' || (phase.kind === 'idle' && (video?.status === 'PROCESSING' || video?.processing))) && (
        <p className="text-sm text-slate-600 mt-2" data-testid="website-video-processing">
          Processing the video… this can take up to a minute.
        </p>
      )}
      {error && (
        <p className="text-sm text-rose-700 mt-2" role="alert" data-testid="website-video-error">{error}</p>
      )}
      {!error && video?.status === 'FAILED' && video.error && phase.kind === 'idle' && (
        <p className="text-sm text-rose-700 mt-2" data-testid="website-video-failed">{video.error}</p>
      )}
      {notice && !error && <p className="text-sm text-emerald-700 mt-2" data-testid="website-video-notice">{notice}</p>}

      {ready && (
        <div className="mt-2 flex items-start gap-3">
          <video
            key={video.url}
            src={video.url!}
            poster={video.posterUrl ?? undefined}
            controls
            muted
            playsInline
            preload="metadata"
            width={video.width ?? undefined}
            height={video.height ?? undefined}
            className="rounded bg-black max-h-64 w-auto"
            style={{ aspectRatio: video.width && video.height ? `${video.width} / ${video.height}` : undefined }}
            data-testid="website-video-player"
          />
          <p className="text-xs text-slate-500" data-testid="website-video-info">
            {seconds(video.durationMs)} · {video.width}×{video.height} · {megabytes(video.sizeBytes)}
          </p>
        </div>
      )}
      {loaded && !video && phase.kind === 'idle' && !error && <p className="text-sm text-slate-500 mt-2">No video yet.</p>}
    </div>
  );
}
