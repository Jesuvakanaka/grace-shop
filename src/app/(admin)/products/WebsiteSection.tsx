'use client';
// ZP-483: the "Website" section of the product editor (OWNER only).
// Publishing goes through POST /api/website/products/:id/publish (publishProduct);
// the gallery through /api/website/products/:id/images, which keeps
// Product.imageUrl equal to the primary photo.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProductPicture } from '@/components/ProductPicture';
import { useToast } from '@/components/Toast';
import { slugify, type PublishMissing } from '@/lib/storefront-model';
import { publicProductRef } from '@/lib/storefront/product-ref';
import {
  ALT_TEXT_MAX,
  DESCRIPTION_HINT,
  describeMissing,
  PHOTO_GUIDANCE,
  PUBLIC_DESCRIPTION_MAX,
  PUBLIC_NAME_MAX,
  WEBSITE_STATUS_LABEL,
  type WebsiteStatus,
} from '@/lib/website/labels';
import { STOREFRONT_PRODUCT_PAGE_READY } from '@/lib/website/preview-config';
import { WebsiteVideo } from './WebsiteVideo';
import { ReviewLinkCreator } from '@/components/ReviewLinkCreator';

interface GalleryImage {
  id: number;
  url: string;
  alt: string | null;
  isPrimary: boolean;
}

interface WebsiteProduct {
  id: number;
  productName: string;
  publicName: string | null;
  slug: string | null;
  publicDescription: string | null;
  categoryId: number | null;
  priceDisplay: 'SHOW_PRICE' | 'ASK_FOR_PRICE';
  featured: boolean;
  colours: string | null;
  sizes: string | null;
  published: boolean;
  publishedAt: string | null;
  sellingPriceUsd: number;
  images: GalleryImage[];
  readiness: { ready: boolean; missing: PublishMissing[] };
  status: WebsiteStatus;
  newUntil: string | null;
}

interface CategoryOption {
  id: number;
  name: string;
  published: boolean;
}

type Fields = {
  publicName: string;
  slug: string;
  publicDescription: string;
  categoryId: string;
  priceDisplay: 'SHOW_PRICE' | 'ASK_FOR_PRICE';
  colours: string;
  sizes: string;
  featured: boolean;
};

const DAY_MS = 86_400_000;
const NEW_ARRIVAL_DAYS = 30;
const formatDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const formatUsd = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function fieldsFrom(p: WebsiteProduct): Fields {
  return {
    publicName: p.publicName ?? '',
    slug: p.slug ?? '',
    publicDescription: p.publicDescription ?? '',
    categoryId: p.categoryId == null ? '' : String(p.categoryId),
    priceDisplay: p.priceDisplay,
    colours: p.colours ?? '',
    sizes: p.sizes ?? '',
    featured: p.featured,
  };
}

function newArrivalText(p: WebsiteProduct, now = new Date()): string {
  if (!p.publishedAt) return `Shown as New for ${NEW_ARRIVAL_DAYS} days after you first publish it.`;
  const until = new Date(new Date(p.publishedAt).getTime() + NEW_ARRIVAL_DAYS * DAY_MS);
  if (until.getTime() < now.getTime()) return `No longer shown as New (first published ${formatDay(new Date(p.publishedAt))}).`;
  return p.published ? `Shown as New until ${formatDay(until)}.` : `Shown as New until ${formatDay(until)} while published.`;
}

export function WebsiteSection({
  productId,
  retailPriceUsd,
  onPictureChange,
  onStatusChange,
}: {
  productId: number;
  /** Retail price as currently typed in the product form. */
  retailPriceUsd: number;
  /** The primary photo changed: the product form's picture must follow. */
  onPictureChange: (url: string | null) => void;
  onStatusChange: () => void;
}) {
  const toast = useToast();
  const [product, setProduct] = useState<WebsiteProduct | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [fields, setFields] = useState<Fields | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<{ error: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = useCallback(
    (p: WebsiteProduct, resetFields: boolean) => {
      setProduct(p);
      if (resetFields) {
        setFields(fieldsFrom(p));
        setSlugTouched(false);
      }
    },
    [],
  );

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      send(`/api/website/products/${productId}`, 'GET'),
      send('/api/website/categories', 'GET'),
    ]);
    if (p.ok) apply(p.data, true);
    else setError({ error: p.data.error || 'Could not load the website details' });
    if (c.ok) setCategories(c.data);
  }, [productId, apply]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    load();
  }, [load]);

  if (!product || !fields) {
    return (
      <section className="border-t border-slate-200 pt-4" data-testid="website-section">
        <h3 className="text-lg font-semibold">Website</h3>
        <p className="text-sm text-slate-500">{error ? error.error : 'Loading...'}</p>
      </section>
    );
  }

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((f) => (f ? { ...f, [key]: value } : f));
  const suggestedSlug = slugify(fields.publicName || product.productName);
  const slugValue = product.slug || slugTouched ? fields.slug : suggestedSlug;
  const missingText = describeMissing(product.readiness.missing);
  const canPublish = product.published || product.readiness.missing.every((m) => m === 'slug');

  const refreshAfterGallery = (images: GalleryImage[]) => {
    onPictureChange(images.find((i) => i.isPrimary)?.url ?? null);
    // Readiness depends on the photos: reload the product, keep typed fields.
    send(`/api/website/products/${productId}`, 'GET').then((r) => r.ok && apply(r.data, false));
    onStatusChange();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      publicName: fields.publicName || null,
      publicDescription: fields.publicDescription || null,
      categoryId: fields.categoryId ? Number(fields.categoryId) : null,
      priceDisplay: fields.priceDisplay,
      colours: fields.colours || null,
      sizes: fields.sizes || null,
      featured: fields.featured,
    };
    // An untouched slug is generated on publish (unique); only send one the owner typed or changed.
    if (slugTouched && fields.slug.trim() && fields.slug !== product.slug) body.slug = fields.slug;
    const r = await send(`/api/website/products/${productId}`, 'PATCH', body);
    setSaving(false);
    if (!r.ok) return setError(r.data);
    apply(r.data, true);
    onStatusChange();
    toast.success('Website details saved');
  };

  const togglePublish = async () => {
    setPublishing(true);
    setError(null);
    const r = await send(`/api/website/products/${productId}/publish`, 'POST', { publish: !product.published });
    setPublishing(false);
    if (!r.ok) return setError({ error: r.data.error || 'Could not publish' });
    const reloaded = await send(`/api/website/products/${productId}`, 'GET');
    if (reloaded.ok) apply(reloaded.data, !slugTouched);
    onStatusChange();
    toast.success(r.data.published ? 'Published on the website' : 'Removed from the website');
  };

  const uploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setError(null);
    const urls: string[] = [];
    const failures: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok) urls.push(data.url);
      else failures.push(`${file.name}: ${data.error || 'upload failed'}`);
    }
    if (urls.length) {
      const r = await send(`/api/website/products/${productId}/images`, 'POST', { urls });
      if (r.ok) refreshAfterGallery(r.data.images);
      else failures.push(r.data.error || 'Could not add the photos');
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (failures.length) setError({ error: failures.join(' · ') });
    else toast.success(`${urls.length} ${urls.length === 1 ? 'photo' : 'photos'} added`);
  };

  const galleryCall = async (url: string, method: string, body?: unknown) => {
    setGalleryBusy(true);
    setError(null);
    const r = await send(url, method, body);
    setGalleryBusy(false);
    if (!r.ok) {
      setError({ error: r.data.error || 'Could not change the photos' });
      load();
      return;
    }
    refreshAfterGallery(r.data.images);
  };

  const move = (index: number, delta: number) => {
    const order = product.images.map((i) => i.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    galleryCall(`/api/website/products/${productId}/images`, 'PUT', { order });
  };

  const preview = async () => {
    const r = await send(`/api/website/products/${productId}/preview-token`, 'POST');
    if (!r.ok) return setError({ error: r.data.error || 'Could not create a preview link' });
    window.open(r.data.url, '_blank', 'noopener');
  };

  const showPriceWarning = fields.priceDisplay === 'SHOW_PRICE' && !(retailPriceUsd > 0);

  return (
    <section className="border-t border-slate-200 pt-4 space-y-4" data-testid="website-section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Website</h3>
        <span
          className={`badge ${product.status === 'PUBLISHED' ? 'badge-success' : product.status === 'DRAFT' ? 'badge-info' : 'badge-warning'}`}
          data-testid="website-status"
        >
          {WEBSITE_STATUS_LABEL[product.status]}
        </span>
      </div>

      {/* Publish switch */}
      <div className="rounded-lg bg-brand-cream-100 p-3">
        <label className={`flex items-center gap-3 ${canPublish ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
          <input
            type="checkbox"
            role="switch"
            className="h-5 w-5 accent-[var(--color-brand-olive)]"
            checked={product.published}
            disabled={!canPublish || publishing}
            onChange={togglePublish}
            data-testid="website-publish-toggle"
          />
          <span className="font-medium">Published on website</span>
        </label>
        {!product.published && missingText && (
          <p className="text-sm text-amber-700 mt-2" data-testid="website-missing">{missingText}</p>
        )}
        <p className="text-xs text-slate-500 mt-2" data-testid="website-new-arrival">{newArrivalText(product)}</p>
        {/* ZP-504: customers' WhatsApp enquiries for this piece end with "(ref V-0099)". */}
        <p className="text-xs text-slate-500 mt-1" data-testid="website-enquiry-ref">
          Enquiry reference: <span className="font-mono text-slate-700">{publicProductRef(productId)}</span>
          {' '}(shown at the end of WhatsApp enquiries)
        </p>
      </div>

      {/* Field errors (slug, category) are shown under their field instead. */}
      {error && error.field !== 'slug' && error.field !== 'categoryId' && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm" data-testid="website-error">
          {error.error}
        </div>
      )}

      {/* Photo gallery */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="label mb-0">Photos</span>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={uploadFiles} data-testid="website-gallery-input" />
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            data-testid="website-gallery-upload"
          >
            {uploading ? 'Uploading...' : 'Add photos'}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-1">{PHOTO_GUIDANCE}. The first photo is the main photo.</p>
        {product.images.length === 0 ? (
          <p className="text-sm text-slate-500 mt-2">No photos yet.</p>
        ) : (
          <ul className="mt-2 space-y-2" data-testid="website-gallery">
            {product.images.map((img, index) => (
              <li key={img.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2" data-testid="website-gallery-item" data-primary={img.isPrimary}>
                <ProductPicture src={img.url} alt={img.alt || ''} size={64} className="rounded shrink-0" testId="website-gallery-thumb" />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1">
                    {img.isPrimary ? (
                      <span className="badge badge-brand" data-testid="website-gallery-primary">Main photo</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost px-2"
                        disabled={galleryBusy}
                        onClick={() => galleryCall(`/api/website/products/${productId}/images/${img.id}`, 'PATCH', { primary: true })}
                        data-testid="website-gallery-make-primary"
                      >
                        Make main
                      </button>
                    )}
                  </div>
                  <input
                    className="input w-full text-sm py-1"
                    defaultValue={img.alt ?? ''}
                    maxLength={ALT_TEXT_MAX}
                    placeholder="Describe the photo (alt text)"
                    aria-label={`Alt text for photo ${index + 1}`}
                    onBlur={(e) => {
                      const alt = e.target.value.trim();
                      if (alt !== (img.alt ?? '')) galleryCall(`/api/website/products/${productId}/images/${img.id}`, 'PATCH', { alt: alt || null });
                    }}
                    data-testid="website-gallery-alt"
                  />
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button type="button" className="btn btn-sm btn-ghost px-2" disabled={galleryBusy || index === 0} onClick={() => move(index, -1)} aria-label={`Move photo ${index + 1} up`} data-testid="website-gallery-up">↑</button>
                  <button type="button" className="btn btn-sm btn-ghost px-2" disabled={galleryBusy || index === product.images.length - 1} onClick={() => move(index, 1)} aria-label={`Move photo ${index + 1} down`} data-testid="website-gallery-down">↓</button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost px-2 text-rose-700"
                    disabled={galleryBusy}
                    onClick={() => window.confirm('Remove this photo from the website gallery?') && galleryCall(`/api/website/products/${productId}/images/${img.id}`, 'DELETE')}
                    aria-label={`Remove photo ${index + 1}`}
                    data-testid="website-gallery-delete"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Video (ZP-501): optional, separate from the photo gallery and readiness. */}
      <WebsiteVideo productId={productId} />

      {/* Reviews (ZP-508): a one-time review link for a customer who bought this piece. */}
      <ReviewLinkCreator productId={productId} />

      {/* Fields */}
      <div>
        <label className="label" htmlFor="website-public-name">Public name</label>
        <input
          id="website-public-name"
          className="input w-full"
          value={fields.publicName}
          maxLength={PUBLIC_NAME_MAX}
          placeholder={product.productName}
          onChange={(e) => set('publicName', e.target.value)}
          data-testid="website-public-name"
        />
        <p className="text-xs text-slate-500 mt-1">Leave empty to use “{product.productName}”.</p>
      </div>

      <div>
        <label className="label" htmlFor="website-slug">Web address (slug)</label>
        <input
          id="website-slug"
          className={`input w-full ${error?.field === 'slug' ? 'input-error' : ''}`}
          value={slugValue}
          onChange={(e) => {
            setSlugTouched(true);
            set('slug', e.target.value);
          }}
          data-testid="website-slug"
        />
        {error?.field === 'slug' ? (
          <p className="text-sm text-rose-700 mt-1" data-testid="website-slug-error">{error.error}</p>
        ) : (
          <p className="text-xs text-slate-500 mt-1">
            {product.slug ? 'Changing it keeps the old address working.' : 'Made from the name when you publish, unless you type one.'}
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="website-description">Description</label>
        <textarea
          id="website-description"
          className="input w-full"
          rows={4}
          maxLength={PUBLIC_DESCRIPTION_MAX}
          value={fields.publicDescription}
          onChange={(e) => set('publicDescription', e.target.value)}
          data-testid="website-description"
        />
        <div className="flex justify-between gap-2 text-xs text-slate-500 mt-1">
          <span>{DESCRIPTION_HINT}</span>
          <span className="shrink-0" data-testid="website-description-count">
            {fields.publicDescription.length}/{PUBLIC_DESCRIPTION_MAX}
          </span>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="website-category">Category</label>
        <select
          id="website-category"
          className="input w-full"
          value={fields.categoryId}
          onChange={(e) => set('categoryId', e.target.value)}
          data-testid="website-category"
        >
          <option value="">Choose a category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.published ? '' : ' (hidden)'}
            </option>
          ))}
        </select>
        {error?.field === 'categoryId' && <p className="text-sm text-rose-700 mt-1">{error.error}</p>}
        {categories.length === 0 && <p className="text-xs text-slate-500 mt-1">Create categories under Website → Categories.</p>}
      </div>

      <fieldset>
        <legend className="label">Price on the website</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="priceDisplay" checked={fields.priceDisplay === 'SHOW_PRICE'} onChange={() => set('priceDisplay', 'SHOW_PRICE')} data-testid="website-price-show" />
            Show price
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="priceDisplay" checked={fields.priceDisplay === 'ASK_FOR_PRICE'} onChange={() => set('priceDisplay', 'ASK_FOR_PRICE')} data-testid="website-price-ask" />
            Ask for price
          </label>
        </div>
        <p className="text-sm text-slate-600 mt-1" data-testid="website-public-price">
          Public price: {fields.priceDisplay === 'SHOW_PRICE' && retailPriceUsd > 0 ? formatUsd(retailPriceUsd) : 'Ask for price'}{' '}
          <span className="text-xs text-slate-500">(from the retail price)</span>
        </p>
        {showPriceWarning && (
          <p className="text-sm text-amber-700 mt-1" data-testid="website-price-warning">
            The retail price is 0, so the website will say “Ask for price” until you set it.
          </p>
        )}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="website-colours">Colours</label>
          <input id="website-colours" className="input w-full" maxLength={200} placeholder="e.g. gold, black" value={fields.colours} onChange={(e) => set('colours', e.target.value)} data-testid="website-colours" />
        </div>
        <div>
          <label className="label" htmlFor="website-sizes">Sizes</label>
          <input id="website-sizes" className="input w-full" maxLength={200} placeholder="e.g. S–XL" value={fields.sizes} onChange={(e) => set('sizes', e.target.value)} data-testid="website-sizes" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={fields.featured} onChange={(e) => set('featured', e.target.checked)} data-testid="website-featured" />
        Featured on the home page
      </label>

      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" className="btn btn-secondary" onClick={preview} data-testid="website-preview">
          {STOREFRONT_PRODUCT_PAGE_READY ? 'Preview on site' : 'Preview (available once the product page ships)'}
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} data-testid="website-save">
          {saving ? 'Saving...' : 'Save website details'}
        </button>
      </div>
    </section>
  );
}
