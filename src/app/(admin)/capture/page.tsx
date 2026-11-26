'use client';
// ZP-1100: "Add with AI" (OWNER only). Photograph a garment, the site writes the
// listing and (AI mode) makes model photos. The browser drives the work one step
// per request. See docs/storefront/ai-capture.md.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/Toast';
import { ProductPicture } from '@/components/ProductPicture';
import type { CaptureDraftDto } from '@/lib/capture/drafts';

const REFERENCE_MAX = 3;
const OWN_MAX = 6;
const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;
const POLL_MS = 15_000;
const AUDIENCES = ['women', 'men', 'girls', 'boys', 'unisex'] as const;

type Draft = CaptureDraftDto;

const STATUS_CHIP: Record<Draft['status'], { label: string; className: string }> = {
  NEW: { label: 'Waiting', className: 'badge-neutral' },
  GENERATING: { label: 'Working', className: 'bg-amber-100 text-amber-800' },
  READY: { label: 'Ready', className: 'badge-success' },
  APPROVED: { label: 'Approved', className: 'badge-neutral' },
  REJECTED: { label: 'Rejected', className: 'badge-neutral' },
  FAILED: { label: 'Failed', className: 'bg-rose-100 text-rose-800' },
};

// ─── Browser helpers ──────────────────────────────────────────────────────────

/** Downscale to at most MAX_SIDE px on the long side, as JPEG, so uploads are fast on weak signal. */
async function downscale(file: File): Promise<File> {
  let source: ImageBitmap | HTMLImageElement;
  let width: number;
  let height: number;
  let cleanup = () => {};
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    cleanup = () => bitmap.close();
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('This photo could not be read. Try another one.'));
      img.src = url;
    }).finally(() => URL.revokeObjectURL(url));
    source = img;
    width = img.naturalWidth;
    height = img.naturalHeight;
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot resize photos.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('This photo could not be resized.');
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } finally {
    cleanup();
  }
}

function monthValue(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function omitKey(map: Record<number, string>, key: number) {
  const copy = { ...map };
  delete copy[key];
  return copy;
}

async function readJson(res: Response) {
  return (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
}

// ─── Photo picker ─────────────────────────────────────────────────────────────

function PhotoPicker({
  label,
  hint,
  files,
  max,
  onChange,
  testId,
}: {
  label: string;
  hint: string;
  files: File[];
  max: number;
  onChange: (files: File[]) => void;
  testId: string;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;
    const room = max - files.length;
    if (picked.length > room) toast.error(`You can add ${max} photos at most.`);
    setWorking(true);
    try {
      const resized = await Promise.all(picked.slice(0, Math.max(0, room)).map(downscale));
      onChange([...files, ...resized]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the photo');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div data-testid={testId}>
      <span className="label">{label}</span>
      <p className="text-xs text-slate-500 mb-2">{hint}</p>
      <div className="flex flex-wrap gap-3">
        {urls.map((url, i) => (
          <div key={url} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
            <img src={url} alt={`Photo ${i + 1}`} className="w-24 h-24 rounded-lg object-cover border border-slate-200" />
            <button
              type="button"
              className="absolute -top-2 -right-2 w-9 h-9 rounded-full bg-white border border-slate-300 text-slate-700 text-lg leading-none shadow"
              onClick={() => onChange(files.filter((_, j) => j !== i))}
              aria-label={`Remove photo ${i + 1}`}
            >
              ×
            </button>
          </div>
        ))}
        {files.length < max && (
          <button
            type="button"
            className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-300 text-slate-600 text-sm flex flex-col items-center justify-center gap-1 active:bg-slate-50"
            onClick={() => inputRef.current?.click()}
            disabled={working}
          >
            <span className="text-2xl leading-none">{working ? '…' : '+'}</span>
            {working ? 'Resizing' : 'Add photo'}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onPick}
        data-testid={`${testId}-input`}
      />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// ─── House model ──────────────────────────────────────────────────────────────

function HouseModelCard() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/capture/house-model')
      .then(readJson)
      .then((body) => setUrl(typeof body.url === 'string' ? body.url : null))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const choose = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const resized = await downscale(file);
      const form = new FormData();
      form.append('photo', resized);
      const res = await fetch('/api/capture/house-model', { method: 'PUT', body: form });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body.error || 'The photo could not be saved.');
      setUrl(typeof body.url === 'string' ? body.url : null);
      toast.success('House model saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The photo could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/capture/house-model', { method: 'DELETE' });
      if (!res.ok) throw new Error((await readJson(res)).error || 'The photo could not be removed.');
      setUrl(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The photo could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4 mb-4" data-testid="house-model">
      <button type="button" className="w-full flex items-center justify-between min-h-10 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="font-semibold">House model</span>
        <span className="text-sm text-slate-500">{open ? 'Hide' : url ? 'Set' : 'Not set'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">This lady wears every women&apos;s piece, so all photos show the same model. Children&apos;s and men&apos;s pieces don&apos;t use her.</p>
          <div className="flex items-center gap-3">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="House model" className="w-24 h-24 rounded-lg object-cover border border-slate-200" />
            ) : (
              <span className="text-sm text-slate-500">{loaded ? 'No house model yet' : 'Loading...'}</span>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary min-h-12 px-5" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? 'Saving…' : 'Choose photo'}
            </button>
            {url && (
              <button type="button" className="btn btn-secondary min-h-12 px-5" disabled={busy} onClick={remove}>
                Remove
              </button>
            )}
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={choose} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function CapturePage() {
  const { isOwner, loading: authLoading } = useAuth();
  const toast = useToast();

  // Form
  const [reference, setReference] = useState<File[]>([]);
  const [own, setOwn] = useState<File[]>([]);
  const [imageMode, setImageMode] = useState<'AI' | 'OWN'>('AI');
  const [listingType, setListingType] = useState<'IN_STOCK' | 'PRE_ORDER'>('IN_STOCK');
  const [shipFrom, setShipFrom] = useState(() => monthValue(3));
  const [shipTo, setShipTo] = useState(() => monthValue(4));
  const [unitCostRmb, setUnitCostRmb] = useState('');
  const [sellingPriceUsd, setSellingPriceUsd] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>('women');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Queue
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<number, string>>({});

  // Processing loop state (refs so the loop always sees the latest)
  const draftsRef = useRef<Draft[]>([]);
  const runningRef = useRef(false);
  const stoppedRef = useRef(false);
  const skipRef = useRef(new Set<number>()); // run failed without a draft update: wait for Retry
  const retryRef = useRef(new Set<number>()); // FAILED drafts the owner asked to run again
  const abortRef = useRef<AbortController | null>(null);
  const pumpRef = useRef<() => void>(() => {});

  const applyDrafts = useCallback((next: Draft[]) => {
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  const upsert = useCallback(
    (draft: Draft) => {
      const list = draftsRef.current;
      applyDrafts(list.some((d) => d.id === draft.id) ? list.map((d) => (d.id === draft.id ? draft : d)) : [draft, ...list]);
    },
    [applyDrafts],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/capture');
      const data = await readJson(res);
      if (res.ok && Array.isArray(data.drafts)) {
        const incoming = data.drafts as Draft[];
        // Keep the row being processed as the loop last saw it if the list is older.
        applyDrafts(incoming);
      }
    } catch {
      // offline: keep what we have
    }
    setLoading(false);
    pumpRef.current();
  }, [applyDrafts]);

  const pickNext = useCallback((): Draft | null => {
    const candidates = draftsRef.current
      .filter((d) => {
        if (skipRef.current.has(d.id)) return false;
        if (d.status === 'FAILED') return retryRef.current.has(d.id);
        return (d.status === 'NEW' || d.status === 'GENERATING') && !d.busy;
      })
      .sort((a, b) => a.id - b.id);
    return candidates[0] ?? null;
  }, []);

  const pump = useCallback(async () => {
    if (runningRef.current || stoppedRef.current) return;
    runningRef.current = true;
    try {
      while (!stoppedRef.current) {
        const next = pickNext();
        if (!next) break;
        const controller = new AbortController();
        abortRef.current = controller;
        // Show the row as working while the request is out.
        upsert({ ...next, status: 'GENERATING', busy: true, error: null });
        setLocalErrors((e) => omitKey(e, next.id));
        try {
          const res = await fetch(`/api/capture/${next.id}/run`, { method: 'POST', signal: controller.signal });
          const data = await readJson(res);
          if (stoppedRef.current) break;
          if (res.ok && data.draft) {
            retryRef.current.delete(next.id);
            upsert(data.draft as Draft);
          } else {
            throw new Error(data.error || 'Could not run this step');
          }
        } catch (err) {
          if (stoppedRef.current) break;
          retryRef.current.delete(next.id);
          skipRef.current.add(next.id);
          upsert({ ...next, status: 'FAILED', busy: false });
          setLocalErrors((e) => ({ ...e, [next.id]: err instanceof Error ? err.message : 'Could not run this step' }));
        }
      }
    } finally {
      runningRef.current = false;
      abortRef.current = null;
    }
  }, [pickNext, upsert]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  useEffect(() => {
    if (!isOwner) return;
    stoppedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      stoppedRef.current = true;
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [isOwner, load]);

  const retry = (id: number) => {
    skipRef.current.delete(id);
    retryRef.current.add(id);
    setLocalErrors((e) => omitKey(e, id));
    pumpRef.current();
  };

  if (authLoading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (!isOwner) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-2">Add with AI</h1>
        <p className="text-slate-600">Only the owner can add products with AI.</p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (reference.length < 1) return setFormError('Add at least 1 photo of the garment.');
    if (imageMode === 'OWN' && own.length < 1) return setFormError('Add at least 1 finished photo, or choose AI photos.');
    if (listingType === 'PRE_ORDER' && (!shipFrom || !shipTo)) return setFormError('Choose the ship-from and ship-to months.');
    if (listingType === 'PRE_ORDER' && shipTo < shipFrom) return setFormError('The ship window ends before it starts.');

    const form = new FormData();
    reference.forEach((f) => form.append('reference', f));
    if (imageMode === 'OWN') own.forEach((f) => form.append('own', f));
    form.append('imageMode', imageMode);
    form.append('listingType', listingType);
    form.append('unitCostRmb', unitCostRmb);
    form.append('sellingPriceUsd', sellingPriceUsd);
    form.append('quantity', quantity || '1');
    if (listingType === 'PRE_ORDER') {
      form.append('shipFrom', `${shipFrom}-01`);
      form.append('shipTo', `${shipTo}-01`);
    }
    form.append('audience', audience);
    form.append('notes', notes);

    setSubmitting(true);
    try {
      const res = await fetch('/api/capture', { method: 'POST', body: form });
      const data = await readJson(res);
      if (!res.ok || !data.draft) {
        setFormError(data.error || 'Could not save. Check your signal and try again.');
        return;
      }
      toast.success('Saved. Next piece');
      // Batch mode: keep type, prices and audience; clear only the photos and note.
      setReference([]);
      setOwn([]);
      setNotes('');
      upsert(data.draft as Draft);
      pumpRef.current();
    } catch {
      setFormError('Could not save. Check your signal and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const visible = drafts.filter((d) => showAll || (d.status !== 'APPROVED' && d.status !== 'REJECTED'));
  const unfinished = drafts.some((d) => d.status === 'NEW' || d.status === 'GENERATING');

  return (
    <div className="p-4 md:p-6 max-w-2xl pb-24">
      <h1 className="text-2xl font-bold mb-1">Add with AI</h1>
      <p className="text-sm text-slate-500 mb-4">Photograph a piece. We write the listing, you check it.</p>

      <HouseModelCard />

      <form onSubmit={submit} className="card p-4 mb-6 space-y-5" data-testid="capture-form">
        <PhotoPicker
          label="Photos of the garment"
          hint={`1 to ${REFERENCE_MAX} photos: flat on a table, on a hanger, a close-up of details. Choose them from your photos, or take one.`}
          files={reference}
          max={REFERENCE_MAX}
          onChange={setReference}
          testId="capture-reference"
        />

        <fieldset>
          <legend className="label">Model photos</legend>
          <div className="grid gap-2">
            {(
              [
                ['AI', 'Make model photos with AI'],
                ['OWN', 'Use my own finished photos'],
              ] as const
            ).map(([value, text]) => (
              <label
                key={value}
                className={`flex items-center gap-3 min-h-12 px-4 rounded-xl border text-base ${imageMode === value ? 'border-brand-olive bg-brand-olive-50 font-medium' : 'border-slate-200'}`}
              >
                <input type="radio" name="imageMode" className="h-5 w-5" checked={imageMode === value} onChange={() => setImageMode(value)} data-testid={`capture-mode-${value}`} />
                {text}
              </label>
            ))}
          </div>
        </fieldset>

        {imageMode === 'OWN' && (
          <PhotoPicker
            label="Your finished photos"
            hint={`1 to ${OWN_MAX} photos, for example made earlier in ChatGPT.`}
            files={own}
            max={OWN_MAX}
            onChange={setOwn}
            testId="capture-own"
          />
        )}

        <fieldset>
          <legend className="label">Listing type</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['IN_STOCK', 'In stock'],
                ['PRE_ORDER', 'Pre-order'],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={listingType === value}
                onClick={() => setListingType(value)}
                className={`min-h-12 rounded-xl border text-base ${listingType === value ? 'border-brand-olive bg-brand-olive-50 text-brand-olive-700 font-semibold' : 'border-slate-200 text-slate-700'}`}
                data-testid={`capture-type-${value}`}
              >
                {text}
              </button>
            ))}
          </div>
        </fieldset>

        {listingType === 'PRE_ORDER' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="capture-ship-from">Ships from</label>
              <input id="capture-ship-from" type="month" className="input w-full min-h-12" value={shipFrom} onChange={(e) => setShipFrom(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="capture-ship-to">Ships to</label>
              <input id="capture-ship-to" type="month" className="input w-full min-h-12" value={shipTo} min={shipFrom} onChange={(e) => setShipTo(e.target.value)} required />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="capture-cost">Cost (RMB)</label>
            <input id="capture-cost" className="input w-full min-h-12" inputMode="decimal" value={unitCostRmb} onChange={(e) => setUnitCostRmb(e.target.value)} placeholder="0" data-testid="capture-cost" />
          </div>
          <div>
            <label className="label" htmlFor="capture-price">Selling price (USD)</label>
            <input id="capture-price" className="input w-full min-h-12" inputMode="decimal" value={sellingPriceUsd} onChange={(e) => setSellingPriceUsd(e.target.value)} placeholder="0.00" data-testid="capture-price" />
          </div>
          <div>
            <label className="label" htmlFor="capture-qty">Quantity</label>
            <input id="capture-qty" type="number" min={1} step={1} inputMode="numeric" className="input w-full min-h-12" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="capture-quantity" />
          </div>
          <div>
            <label className="label" htmlFor="capture-audience">Who is it for</label>
            <select id="capture-audience" className="input w-full min-h-12" value={audience} onChange={(e) => setAudience(e.target.value as (typeof AUDIENCES)[number])}>
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="capture-notes">Note for the AI (optional)</label>
          <textarea id="capture-notes" className="input w-full" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. girls 4-8 years, pink" />
        </div>

        {formError && <p className="text-sm text-rose-700" role="alert" data-testid="capture-form-error">{formError}</p>}
        <button className="btn btn-primary w-full min-h-14 text-lg" disabled={submitting} data-testid="capture-submit">
          {submitting ? 'Saving...' : 'Save piece'}
        </button>
      </form>

      {unfinished && (
        <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900" role="status" data-testid="capture-banner">
          Keep this page open while photos are made (about 1 minute per piece).
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Queue</h2>
        <label className="flex items-center gap-2 text-sm text-slate-700 min-h-10">
          <input type="checkbox" className="h-5 w-5" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} data-testid="capture-show-all" />
          Show all
        </label>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500">Loading...</div>
      ) : visible.length === 0 ? (
        <div className="card p-6 text-center text-slate-500">Nothing in the queue.</div>
      ) : (
        <ul className="space-y-3" data-testid="capture-queue">
          {visible.map((d) => {
            const chip = STATUS_CHIP[d.status];
            const photo = d.photos.reference[0];
            const error = localErrors[d.id] ?? d.error;
            const working = d.status === 'NEW' || d.status === 'GENERATING';
            return (
              <li key={d.id} className="card p-3" data-testid="capture-row" data-status={d.status}>
                <div className="flex items-center gap-3">
                  {photo ? (
                    <ProductPicture src={photo} alt="" size={64} className="rounded-lg shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-brand-cream-100 shrink-0" aria-hidden />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">{d.listing?.publicName || 'Writing listing…'}</p>
                    <span className={`badge ${chip.className} mt-1`} data-testid="capture-status">
                      {working && d.busy ? 'Working…' : chip.label}
                    </span>
                  </div>
                  {d.status === 'READY' ? (
                    <Link href={`/capture/${d.id}`} className="btn btn-primary min-h-12 px-5" data-testid="capture-review">
                      Review
                    </Link>
                  ) : d.status === 'FAILED' ? (
                    <button type="button" className="btn btn-secondary min-h-12 px-5" onClick={() => retry(d.id)} data-testid="capture-retry">
                      Retry
                    </button>
                  ) : (
                    <Link href={`/capture/${d.id}`} className="text-sm text-brand-olive-700 underline min-h-12 flex items-center px-2">
                      Open
                    </Link>
                  )}
                </div>
                {d.status === 'FAILED' && error && <p className="text-sm text-rose-700 mt-2" data-testid="capture-error">{error}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
