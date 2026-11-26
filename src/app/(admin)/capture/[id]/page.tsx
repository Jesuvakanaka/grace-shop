'use client';
// ZP-1100: review one AI capture draft (OWNER only). See docs/storefront/ai-capture.md.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { CaptureDraftDto } from '@/lib/capture/drafts';

type Draft = Omit<CaptureDraftDto, 'createdAt' | 'updatedAt'>;
type ApiError = { error?: string; field?: string };
type Category = { id: number; name: string };
type ApproveResult = { productId: number; published: boolean; missing?: string[] };

type Edits = {
  publicName: string;
  description: string;
  categoryId: string;
  colours: string;
  sizes: string;
  fabric: string;
  care: string;
  altText: string;
  listingType: 'IN_STOCK' | 'PRE_ORDER';
  shipFrom: string;
  shipTo: string;
  unitCostRmb: string;
  sellingPriceUsd: string;
  quantity: string;
};

const DESCRIPTION_MAX = 2000;
const SLOTS = ['Standing', 'Playful', 'Seated'];

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function toEdits(d: Draft): Edits {
  const l = d.listing;
  return {
    publicName: l?.publicName ?? '',
    description: l?.description ?? '',
    categoryId: l?.categoryId ? String(l.categoryId) : '',
    colours: l?.colours ?? '',
    sizes: l?.sizes ?? '',
    fabric: l?.fabric ?? '',
    care: l?.care ?? '',
    altText: l?.altText ?? '',
    listingType: d.listingType,
    shipFrom: d.shipFrom ?? '',
    shipTo: d.shipTo ?? '',
    unitCostRmb: d.unitCostRmb === null ? '' : String(d.unitCostRmb),
    sellingPriceUsd: d.sellingPriceUsd === null ? '' : String(d.sellingPriceUsd),
    quantity: String(d.quantity),
  };
}

function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-slate-300 border-t-brand-olive ${className}`} role="status" aria-label="Working" />;
}

export default function CaptureReviewPage() {
  const { isOwner, loading: authLoading } = useAuth();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [edits, setEdits] = useState<Edits | null>(null);
  const [fieldError, setFieldError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const [itemNumber, setItemNumber] = useState('');
  const [approving, setApproving] = useState<null | 'publish' | 'draft'>(null);
  const [approveError, setApproveError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ApproveResult | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const status = draft?.status;
  const driving = status === 'NEW' || status === 'GENERATING';

  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    (async () => {
      const [d, c] = await Promise.all([send(`/api/capture/${id}`, 'GET'), send('/api/website/categories', 'GET')]);
      if (!alive) return;
      if (d.ok) setDraft(d.data.draft);
      else setLoadError(d.data.error || 'Could not load this draft');
      if (c.ok && Array.isArray(c.data)) setCategories(c.data.map((x: Category) => ({ id: x.id, name: x.name })));
    })();
    return () => {
      alive = false;
    };
  }, [isOwner, id]);

  // Drive the work one step per request until READY or FAILED.
  useEffect(() => {
    if (!isOwner || !driving) return;
    let alive = true;
    (async () => {
      while (alive) {
        const r = await send(`/api/capture/${id}/run`, 'POST');
        if (!alive) return;
        if (r.ok) {
          setDraft(r.data.draft);
          const s = r.data.draft.status;
          if (s !== 'NEW' && s !== 'GENERATING') return;
        } else if (r.status === 409) {
          await new Promise((res) => setTimeout(res, 3000));
        } else {
          setLoadError(r.data.error || 'A step failed. Reload the page to try again.');
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [isOwner, driving, id]);

  const retry = useCallback(async () => {
    setRetrying(true);
    const r = await send(`/api/capture/${id}/run`, 'POST');
    setRetrying(false);
    if (r.ok) setDraft(r.data.draft);
    else toast.error(r.data.error || 'Could not retry');
  }, [id, toast]);

  if (authLoading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (!isOwner) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-2">Capture</h1>
        <p className="text-slate-600">Only the owner can review captured products.</p>
      </div>
    );
  }
  if (loadError && !draft) {
    return (
      <div className="p-6">
        <p className="text-rose-700 mb-3">{loadError}</p>
        <Link href="/capture" className="text-brand-olive-700 underline">Back to capture</Link>
      </div>
    );
  }
  if (!draft) return <div className="p-8 text-center text-slate-500">Loading...</div>;

  const form = edits ?? toEdits(draft);
  const set = <K extends keyof Edits>(key: K, value: Edits[K]) => setEdits({ ...form, [key]: value });
  const errFor = (field: string) => (fieldError?.field === field ? <p className="text-sm text-rose-700 mt-1">{fieldError.error}</p> : null);
  const readOnly = draft.status === 'APPROVED' || draft.status === 'REJECTED';
  const editable = !readOnly && !!draft.listing;
  const isAi = draft.imageMode === 'AI';

  const madeCount = draft.photos.generated.filter(Boolean).length;
  const progress = !draft.listing ? 'Writing listing…' : isAi && madeCount < SLOTS.length ? `Making photo ${madeCount + 1} of ${SLOTS.length}…` : 'Finishing…';

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setFieldError(null);
    const body = {
      listing: {
        publicName: form.publicName,
        description: form.description,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        colours: form.colours,
        sizes: form.sizes,
        fabric: form.fabric,
        care: form.care,
        altText: form.altText,
        details: draft.listing?.details ?? [],
      },
      listingType: form.listingType,
      shipFrom: form.listingType === 'PRE_ORDER' ? form.shipFrom : null,
      shipTo: form.listingType === 'PRE_ORDER' ? form.shipTo : null,
      unitCostRmb: form.unitCostRmb,
      sellingPriceUsd: form.sellingPriceUsd,
      quantity: form.quantity,
    };
    const r = await send(`/api/capture/${id}`, 'PATCH', body);
    setSaving(false);
    if (!r.ok) {
      setFieldError(r.data);
      if (!r.data.field) toast.error(r.data.error || 'Could not save');
      return false;
    }
    setDraft(r.data.draft);
    setEdits(null);
    toast.success('Changes saved');
    return true;
  };

  const makeAgain = async (slot: number) => {
    const r = await send(`/api/capture/${id}/regenerate`, 'POST', { slot });
    if (!r.ok) return toast.error(r.data.error || 'Could not remake this photo');
    setDraft(r.data.draft);
  };

  const approve = async (publish: boolean) => {
    setApproveError(null);
    if (edits && !(await save())) return;
    setApproving(publish ? 'publish' : 'draft');
    const r = await send(`/api/capture/${id}/approve`, 'POST', { publish, itemNumber: itemNumber.trim() || null });
    setApproving(null);
    if (!r.ok) return setApproveError(r.data);
    setResult(r.data);
    const d = await send(`/api/capture/${id}`, 'GET');
    if (d.ok) setDraft(d.data.draft);
  };

  const reject = async () => {
    setConfirmReject(false);
    const r = await send(`/api/capture/${id}`, 'DELETE');
    if (!r.ok) return toast.error(r.data.error || 'Could not reject');
    setDraft(r.data.draft);
    toast.success('Draft rejected');
  };

  const slotCards = isAi
    ? SLOTS.map((label, slot) => {
        const url = draft.photos.generated[slot] ?? null;
        return (
          <div key={label} className="space-y-2">
            <div className="aspect-[3/4] w-full rounded-xl bg-brand-cream-100 overflow-hidden flex items-center justify-center">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={`${label} model photo`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-500 text-sm">
                  <Spinner className="h-6 w-6" />
                  Being made…
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-800">{label}</span>
              {draft.status === 'READY' && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => makeAgain(slot)} data-testid={`capture-remake-${slot}`}>
                  Make again
                </button>
              )}
            </div>
          </div>
        );
      })
    : draft.photos.own.map((url, i) => (
        <div key={url} className="aspect-[3/4] w-full rounded-xl bg-brand-cream-100 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`Your finished photo ${i + 1}`} className="h-full w-full object-cover" />
        </div>
      ));

  return (
    <div className="p-4 md:p-6 max-w-5xl space-y-6">
      <div>
        <Link href="/capture" className="text-sm text-slate-500 hover:text-slate-900">← Capture</Link>
        <h1 className="text-2xl font-bold">Review product #{draft.id}</h1>
      </div>

      {driving && (
        <div className="card p-4 flex items-center gap-3" data-testid="capture-progress">
          <Spinner />
          <span>{progress}</span>
        </div>
      )}

      {draft.status === 'FAILED' && (
        <div className="card p-4 border-rose-300 space-y-2" data-testid="capture-failed">
          <p className="font-medium text-rose-700">Something went wrong</p>
          <p className="text-sm text-slate-700">{draft.error || 'The last step failed.'}</p>
          <button type="button" className="btn btn-primary" onClick={retry} disabled={retrying}>
            {retrying ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      )}
      {loadError && <p className="text-sm text-rose-700">{loadError}</p>}
      {draft.status === 'REJECTED' && <div className="card p-4 text-slate-600">This draft was rejected.</div>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Photos</h2>
        {isAi && (
          <p className="text-sm text-slate-600">
            These model photos are AI-styled. The real garment photo stays in the gallery, shown last on the site.
          </p>
        )}
        {slotCards.length > 0 && <div className="grid gap-4 sm:grid-cols-3">{slotCards}</div>}
        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Your photo (shown last on the site)</p>
          <div className="flex flex-wrap gap-3">
            {draft.photos.reference.map((url, i) => (
              <div key={url} className="w-32 sm:w-40 aspect-[3/4] rounded-lg bg-brand-cream-100 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Your garment photo ${i + 1}`} className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {draft.status === 'APPROVED' && (
        <section className="card p-4 space-y-2" data-testid="capture-approved">
          <h2 className="text-lg font-semibold">Approved</h2>
          <p className="font-medium">{draft.listing?.publicName}</p>
          <p className="text-sm text-slate-600 whitespace-pre-line">{draft.listing?.description}</p>
          <p className="text-sm text-slate-600">
            {draft.listingType === 'PRE_ORDER' ? 'Pre-order' : 'In stock'} · Quantity {draft.quantity}
            {draft.sellingPriceUsd !== null && ` · $${draft.sellingPriceUsd}`}
          </p>
          <Link href="/products" className="btn btn-secondary inline-block">
            View in products{draft.productId ? ` (product #${draft.productId})` : ''}
          </Link>
        </section>
      )}

      {draft.listing && draft.listing.details.length > 0 && !readOnly && (
        <section className="card p-4 space-y-2" data-testid="capture-checklist">
          <h2 className="text-lg font-semibold">Check these details</h2>
          <p className="text-sm text-slate-600">
            The photos must match the real garment. Look at each photo above and tick each detail once you have checked it is right.
          </p>
          <ul className="space-y-1">
            {draft.listing.details.map((detail, i) => (
              <li key={i}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 mt-0.5"
                    checked={!!ticks[i]}
                    onChange={(e) => setTicks({ ...ticks, [i]: e.target.checked })}
                  />
                  {detail}
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editable && (
        <section className="card p-4 space-y-4" data-testid="capture-form">
          <h2 className="text-lg font-semibold">Listing</h2>
          <div>
            <label className="label" htmlFor="cap-name">Name</label>
            <input id="cap-name" className="input w-full" maxLength={120} value={form.publicName} onChange={(e) => set('publicName', e.target.value)} />
            {errFor('listing')}
          </div>
          <div>
            <label className="label" htmlFor="cap-desc">Description</label>
            <textarea id="cap-desc" className="input w-full" rows={6} maxLength={DESCRIPTION_MAX} value={form.description} onChange={(e) => set('description', e.target.value)} />
            <p className="text-xs text-slate-500 text-right">{form.description.length} / {DESCRIPTION_MAX}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="cap-cat">Category</label>
              <select id="cap-cat" className="input w-full" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {([['colours', 'Colours'], ['sizes', 'Sizes'], ['fabric', 'Fabric'], ['care', 'Care']] as const).map(([key, label]) => (
              <div key={key}>
                <label className="label" htmlFor={`cap-${key}`}>{label}</label>
                <input id={`cap-${key}`} className="input w-full" maxLength={200} value={form[key]} onChange={(e) => set(key, e.target.value)} />
              </div>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="cap-alt">Alt text (describes every photo)</label>
            <input id="cap-alt" className="input w-full" maxLength={200} value={form.altText} onChange={(e) => set('altText', e.target.value)} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="cap-type">Listing type</label>
              <select id="cap-type" className="input w-full" value={form.listingType} onChange={(e) => set('listingType', e.target.value as Edits['listingType'])}>
                <option value="IN_STOCK">In stock</option>
                <option value="PRE_ORDER">Pre-order</option>
              </select>
              {errFor('listingType')}
            </div>
            <div>
              <label className="label" htmlFor="cap-qty">{form.listingType === 'PRE_ORDER' ? 'Quantity bought' : 'Quantity'}</label>
              <input id="cap-qty" type="number" min={1} step={1} inputMode="numeric" className="input w-full" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
              {errFor('quantity')}
            </div>
            {form.listingType === 'PRE_ORDER' && (
              <>
                <div>
                  <label className="label" htmlFor="cap-from">Ships from (month)</label>
                  <input id="cap-from" type="date" className="input w-full" value={form.shipFrom} onChange={(e) => set('shipFrom', e.target.value)} />
                  {errFor('shipFrom')}
                </div>
                <div>
                  <label className="label" htmlFor="cap-to">Ships to (month)</label>
                  <input id="cap-to" type="date" className="input w-full" value={form.shipTo} onChange={(e) => set('shipTo', e.target.value)} />
                  {errFor('shipTo')}
                </div>
              </>
            )}
            <div>
              <label className="label" htmlFor="cap-cost">Cost (RMB)</label>
              <input id="cap-cost" type="number" min={0} step="0.01" inputMode="decimal" className="input w-full" value={form.unitCostRmb} onChange={(e) => set('unitCostRmb', e.target.value)} />
              {errFor('unitCostRmb')}
            </div>
            <div>
              <label className="label" htmlFor="cap-price">Selling price (USD)</label>
              <input id="cap-price" type="number" min={0} step="0.01" inputMode="decimal" className="input w-full" value={form.sellingPriceUsd} onChange={(e) => set('sellingPriceUsd', e.target.value)} />
              {errFor('sellingPriceUsd')}
            </div>
          </div>
          {fieldError && !fieldError.field && <p className="text-sm text-rose-700">{fieldError.error}</p>}
          <button type="button" className="btn btn-secondary" onClick={save} disabled={saving || !edits} data-testid="capture-save">
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </section>
      )}

      {draft.status === 'READY' && (
        <section className="card p-4 space-y-3" data-testid="capture-actions">
          <h2 className="text-lg font-semibold">Approve</h2>
          <div>
            <label className="label" htmlFor="cap-item">Item number (optional)</label>
            <input id="cap-item" className="input w-full sm:w-64" maxLength={60} placeholder={`CAP-${draft.id}`} value={itemNumber} onChange={(e) => setItemNumber(e.target.value)} />
          </div>
          {approveError && <p className="text-sm text-rose-700">{approveError.error}</p>}
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" className="btn btn-primary" onClick={() => approve(true)} disabled={!!approving} data-testid="capture-publish">
              {approving === 'publish' ? 'Publishing...' : 'Approve and publish'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => approve(false)} disabled={!!approving} data-testid="capture-keep-draft">
              {approving === 'draft' ? 'Saving...' : 'Approve, keep as draft'}
            </button>
            <button type="button" className="btn btn-danger sm:ml-auto" onClick={() => setConfirmReject(true)} disabled={!!approving}>
              Reject
            </button>
          </div>
        </section>
      )}
      {(draft.status === 'FAILED' || draft.status === 'NEW' || draft.status === 'GENERATING') && (
        <button type="button" className="btn btn-danger" onClick={() => setConfirmReject(true)}>Reject</button>
      )}

      {result && (
        <section className="card p-4 space-y-2" data-testid="capture-result">
          <p className="font-medium">
            {result.published ? 'Published. The product is live on the website.' : `Saved as product #${result.productId}, not published.`}
          </p>
          {result.missing && result.missing.length > 0 && (
            <div>
              <p className="text-sm text-amber-800">Publishing was blocked. Fix these in the product, then publish:</p>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {result.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          <Link href="/products" className="text-brand-olive-700 underline text-sm">Go to products →</Link>
        </section>
      )}

      <p className="text-xs text-slate-400">AI cost estimate: ${(draft.aiCostCents / 100).toFixed(2)}</p>

      <ConfirmDialog
        open={confirmReject}
        title="Reject this draft?"
        message="The draft will be thrown away and no product is created."
        confirmText="Reject"
        variant="danger"
        onConfirm={reject}
        onCancel={() => setConfirmReject(false)}
      />
    </div>
  );
}
