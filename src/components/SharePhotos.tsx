'use client';

// Share product photos to WhatsApp (chat or Status) and other apps through the
// phone's share sheet, or download them where the browser can't share files.
// Photos are converted to JPEG first: WhatsApp treats WebP files as stickers.
import { useState } from 'react';
import { useToast } from '@/components/Toast';

async function toJpeg(url: string, name: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('A photo could not be loaded.');
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot prepare the photo.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('This browser cannot prepare the photo.');
  return new File([blob], name, { type: 'image/jpeg' });
}

function download(file: File) {
  const href = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = href;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'vyra';
}

export function SharePhotos({ urls, title, text }: { urls: string[]; title: string; text?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (urls.length === 0) return null;

  const prepare = () => Promise.all(urls.map((u, i) => toJpeg(u, `${slug(title)}-${i + 1}.jpg`)));

  const share = async () => {
    setBusy(true);
    try {
      const files = await prepare();
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
        try {
          await navigator.share({ files, title, text });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return; // closed the share sheet
          throw err;
        }
      } else {
        files.forEach(download);
        toast.success(`${files.length} photo${files.length === 1 ? '' : 's'} downloaded.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The photos could not be shared.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const files = await prepare();
      files.forEach(download);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The photos could not be downloaded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2" data-testid="share-photos">
      <button type="button" className="btn btn-primary min-h-12 px-5" onClick={share} disabled={busy}>
        {busy ? 'Preparing…' : 'Share photos (WhatsApp…)'}
      </button>
      <button type="button" className="btn btn-secondary min-h-12 px-5" onClick={save} disabled={busy}>
        Download
      </button>
    </div>
  );
}
