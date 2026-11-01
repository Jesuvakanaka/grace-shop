'use client';

// ZP-486: VYRA site settings (OWNER only). Contacts, opening hours, socials,
// about copy, home hero, SEO defaults and availability. Saves through
// PUT /api/website/settings, which revalidates the storefront caches.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { ProductPicture } from '@/components/ProductPicture';
import { useToast } from '@/components/Toast';
import {
  DAYS,
  DAY_LABELS,
  FEW_LEFT_MAX,
  FEW_LEFT_MIN,
  MAX_LENGTH,
  SITE_SETTINGS_DEFAULTS,
  type Day,
  type OpeningHours,
  type SiteSettingsData,
} from '@/lib/site-settings/schema';
import { normalizeE164, validateSiteSettingsInput, type FieldErrors } from '@/lib/site-settings/validate';
import { buildWhatsAppLink } from '@/lib/site-settings/whatsapp';
import { changedSettings } from '@/lib/site-settings/diff';
import { imageUrlForKey, isValidImageKey, PRODUCT_IMAGE_PREFIX, IMAGE_URL_PREFIX } from '@/lib/storage/keys';

type DayForm = { closed: boolean; open: string; close: string };
type ImageField = 'aboutImageKey' | 'heroImageKeyDesktop' | 'heroImageKeyMobile' | 'seoShareImageKey';

/** Form state: the settings with text inputs for numbers and an always-complete week. */
type FormState = Omit<SiteSettingsData, 'openingHours' | 'latitude' | 'longitude' | 'fewLeftThreshold'> & {
  hoursSet: boolean;
  hours: Record<Day, DayForm>;
  latitude: string;
  longitude: string;
  fewLeftThreshold: string;
};

const DEFAULT_DAY: DayForm = { closed: false, open: '09:00', close: '17:00' };

function toForm(s: SiteSettingsData): FormState {
  const hours = {} as Record<Day, DayForm>;
  for (const d of DAYS) {
    const h = s.openingHours?.[d];
    hours[d] = !h ? { ...DEFAULT_DAY } : h.closed ? { ...DEFAULT_DAY, closed: true } : { closed: false, open: h.open, close: h.close };
  }
  const { openingHours, latitude, longitude, fewLeftThreshold, ...rest } = s;
  return {
    ...rest,
    hoursSet: openingHours !== null,
    hours,
    latitude: latitude === null ? '' : String(latitude),
    longitude: longitude === null ? '' : String(longitude),
    fewLeftThreshold: String(fewLeftThreshold),
  };
}

function toPayload(f: FormState): Record<string, unknown> {
  const { hoursSet, hours, latitude, longitude, fewLeftThreshold, ...rest } = f;
  const openingHours: OpeningHours | null = hoursSet
    ? (Object.fromEntries(
        DAYS.map((d) => [d, hours[d].closed ? { closed: true } : { closed: false, open: hours[d].open, close: hours[d].close }]),
      ) as OpeningHours)
    : null;
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  return {
    ...rest,
    openingHours,
    latitude: num(latitude),
    longitude: num(longitude),
    fewLeftThreshold: fewLeftThreshold.trim() === '' ? null : Number(fewLeftThreshold),
  };
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-4" aria-labelledby={`${id}-title`} data-testid={`settings-section-${id}`}>
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        {hint && <p className="text-sm text-slate-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 w-full min-w-0">
      <label htmlFor={`f-${name}`} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && <span className="text-xs text-slate-500">{hint}</span>}
      {error && (
        <span className="text-xs text-rose-700" role="alert" data-testid={`error-${name}`}>
          {error}
        </span>
      )}
    </div>
  );
}

export default function WebsiteSettingsPage() {
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  // The settings as last loaded or saved, to send only the changed fields.
  const [baseline, setBaseline] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<ImageField | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/website/settings');
      if (res.status === 403 || res.status === 401) {
        setStatus('forbidden');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the settings');
      const loaded = toForm(data.settings);
      setForm(loaded);
      setBaseline(toPayload(loaded));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setErrors((e) => {
      if (!e[key as string]) return e;
      const next = { ...e };
      delete next[key as string];
      return next;
    });
  };

  const setDay = (day: Day, patch: Partial<DayForm>) => {
    setForm((f) => (f ? { ...f, hoursSet: true, hours: { ...f.hours, [day]: { ...f.hours[day], ...patch } } } : f));
    setErrors((e) => {
      const next = { ...e };
      delete next[`openingHours.${day}`];
      delete next.openingHours;
      return next;
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    // Validate the whole form (so every problem shows), send only what changed.
    const full = toPayload(form);
    const check = validateSiteSettingsInput(full);
    if (!check.ok) {
      setErrors(check.errors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    const payload = baseline ? changedSettings(full, baseline) : full;
    if (Object.keys(payload).length === 0) {
      toast.info('No changes to save');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/website/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(data.fieldErrors || {});
        toast.error(data.error || 'Could not save the settings');
        return;
      }
      setErrors({});
      const saved = toForm(data.settings);
      setForm(saved);
      setBaseline(toPayload(saved));
      toast.success('Saved');
    } catch {
      toast.error('Could not save the settings');
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="p-4 md:p-6">
        <PageHeader title="Website settings" />
        <p className="text-slate-500">Loading settings…</p>
      </div>
    );
  }
  if (status === 'forbidden') {
    return (
      <div className="p-4 md:p-6" data-testid="settings-forbidden">
        <PageHeader title="Website settings" />
        <div className="card max-w-lg">
          <p className="font-semibold text-slate-900">403 · Owners only</p>
          <p className="text-sm text-slate-600 mt-1">Only the owner can change the website settings.</p>
        </div>
      </div>
    );
  }
  if (status === 'error' || !form) {
    return (
      <div className="p-4 md:p-6">
        <PageHeader title="Website settings" />
        <div className="card max-w-lg text-rose-700">Could not load the settings. Refresh to try again.</div>
      </div>
    );
  }

  const input = (name: keyof FormState, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={`f-${name}`}
      name={name}
      className={errors[name] ? 'input-error' : 'input'}
      value={(form[name] as string | null) ?? ''}
      onChange={(e) => set(name, e.target.value as FormState[typeof name])}
      aria-invalid={!!errors[name]}
      data-testid={`input-${name}`}
      {...extra}
    />
  );
  const textarea = (name: keyof FormState, rows: number, maxLength?: number) => (
    <textarea
      id={`f-${name}`}
      name={name}
      rows={rows}
      maxLength={maxLength}
      className={errors[name] ? 'input-error' : 'input'}
      value={(form[name] as string | null) ?? ''}
      onChange={(e) => set(name, e.target.value as FormState[typeof name])}
      aria-invalid={!!errors[name]}
      data-testid={`input-${name}`}
    />
  );

  // Preview only for a number that would pass validation.
  const previewNumber = form.whatsappNumber ? normalizeE164(form.whatsappNumber) : null;
  const preview = buildWhatsAppLink(
    { contacts: { whatsappNumber: previewNumber, enquiryTemplate: form.enquiryTemplate, generalEnquiryMessage: form.generalEnquiryMessage } },
    { product: 'Silk Wrap Dress', url: 'https://vyra.example/p/silk-wrap-dress', ref: 'V-0099' },
  );

  return (
    <form onSubmit={onSubmit} noValidate className="p-4 md:p-6 space-y-5 max-w-4xl" data-testid="website-settings-form">
      <PageHeader
        title="Website settings"
        subtitle="Contacts, opening hours and words on the VYRA website."
        actions={
          <button type="submit" className="btn btn-primary" disabled={saving || uploading !== null} data-testid="settings-save-top">
            {saving ? 'Saving…' : 'Save'}
          </button>
        }
      />

      <Section id="contacts" title="Contacts" hint="How customers reach you from the website.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="WhatsApp number" name="whatsappNumber" error={errors.whatsappNumber} hint="International format, e.g. +263 77 123 4567">
            {input('whatsappNumber', { type: 'tel', inputMode: 'tel', placeholder: '+263 77 123 4567', autoComplete: 'off' })}
          </Field>
          <Field label="Phone" name="phone" error={errors.phone}>
            {input('phone', { type: 'tel', inputMode: 'tel', placeholder: '+263 242 123 456' })}
          </Field>
          <Field label="Email" name="email" error={errors.email}>
            {input('email', { type: 'email', inputMode: 'email', placeholder: 'hello@example.com' })}
          </Field>
        </div>
        <Field
          label="Product enquiry message"
          name="enquiryTemplate"
          error={errors.enquiryTemplate}
          hint="Use {product} and {url}; {colour}, {size} and {ref} are optional. The piece's reference (ref V-0099) is added at the end unless you place {ref}."
        >
          {input('enquiryTemplate', { maxLength: MAX_LENGTH.enquiryTemplate })}
        </Field>
        <Field label="General enquiry message" name="generalEnquiryMessage" error={errors.generalEnquiryMessage}>
          {input('generalEnquiryMessage', { maxLength: MAX_LENGTH.generalEnquiryMessage })}
        </Field>
        <p className="text-xs text-slate-500 break-all" data-testid="whatsapp-preview">
          {preview ? (
            <>
              Preview:{' '}
              <a href={preview} target="_blank" rel="noopener noreferrer" className="text-brand-olive-700 underline">
                {preview}
              </a>
            </>
          ) : (
            'Add a valid WhatsApp number to enable the enquiry buttons.'
          )}
        </p>
      </Section>

      <Section id="visit" title="Visit us" hint="Your shop address and opening hours.">
        <Field label="Address" name="address" error={errors.address}>
          {textarea('address', 3, MAX_LENGTH.address)}
        </Field>

        <fieldset className="space-y-2" data-testid="opening-hours">
          <legend className="text-sm font-medium text-slate-700 mb-1">Opening hours</legend>
          {!form.hoursSet && <p className="text-xs text-slate-500">Not shown on the website yet. Change any day to set the hours.</p>}
          {errors.openingHours && (
            <p className="text-xs text-rose-700" role="alert">
              {errors.openingHours}
            </p>
          )}
          {DAYS.map((d) => {
            const h = form.hours[d];
            const err = errors[`openingHours.${d}`];
            return (
              <div key={d} className="border-b border-slate-100 pb-2 last:border-0" data-testid={`hours-${d}`}>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <span className="w-24 text-sm font-medium text-slate-800">{DAY_LABELS[d]}</span>
                  <label className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={h.closed}
                      onChange={(e) => setDay(d, { closed: e.target.checked })}
                      data-testid={`hours-${d}-closed`}
                    />
                    Closed
                  </label>
                  {!h.closed && (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label={`${DAY_LABELS[d]} opens`}
                        className={err ? 'input-error' : 'input'}
                        style={{ width: '8.5rem' }}
                        value={h.open}
                        onChange={(e) => setDay(d, { open: e.target.value })}
                        data-testid={`hours-${d}-open`}
                      />
                      <span className="text-slate-500">–</span>
                      <input
                        type="time"
                        aria-label={`${DAY_LABELS[d]} closes`}
                        className={err ? 'input-error' : 'input'}
                        style={{ width: '8.5rem' }}
                        value={h.close}
                        onChange={(e) => setDay(d, { close: e.target.value })}
                        data-testid={`hours-${d}-close`}
                      />
                    </div>
                  )}
                </div>
                {err && (
                  <p className="text-xs text-rose-700 mt-1" role="alert" data-testid={`error-hours-${d}`}>
                    {err}
                  </p>
                )}
              </div>
            );
          })}
          {form.hoursSet && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('hoursSet', false)} data-testid="hours-clear">
              Hide opening hours
            </button>
          )}
        </fieldset>

        <Field label="Holiday note" name="holidayNote" error={errors.holidayNote} hint="e.g. Closed on public holidays.">
          {input('holidayNote', { maxLength: MAX_LENGTH.holidayNote })}
        </Field>
        <Field label="Map link" name="mapUrl" error={errors.mapUrl} hint="A Google Maps share link (https://…)">
          {input('mapUrl', { type: 'url', inputMode: 'url', placeholder: 'https://maps.app.goo.gl/…' })}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Latitude (optional)" name="latitude" error={errors.latitude}>
            {input('latitude', { inputMode: 'decimal', placeholder: '-17.8292' })}
          </Field>
          <Field label="Longitude (optional)" name="longitude" error={errors.longitude}>
            {input('longitude', { inputMode: 'decimal', placeholder: '31.0522' })}
          </Field>
        </div>
      </Section>

      <Section id="social" title="Social">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Instagram" name="instagramUrl" error={errors.instagramUrl}>
            {input('instagramUrl', { type: 'url', inputMode: 'url', placeholder: 'https://instagram.com/…' })}
          </Field>
          <Field label="Facebook" name="facebookUrl" error={errors.facebookUrl}>
            {input('facebookUrl', { type: 'url', inputMode: 'url', placeholder: 'https://facebook.com/…' })}
          </Field>
          <Field label="TikTok" name="tiktokUrl" error={errors.tiktokUrl}>
            {input('tiktokUrl', { type: 'url', inputMode: 'url', placeholder: 'https://tiktok.com/@…' })}
          </Field>
        </div>
      </Section>

      <Section id="reviews" title="Reviews" hint="After a customer sends a review, the thank-you screen can ask for a Google review too.">
        <Field
          label="Google review link"
          name="googleReviewUrl"
          error={errors.googleReviewUrl}
          hint="Your Google Business “Ask for reviews” link (https://g.page/r/… or search.google.com/…). Leave empty to hide the button."
        >
          {input('googleReviewUrl', { type: 'url', inputMode: 'url', placeholder: 'https://g.page/r/…/review' })}
        </Field>
      </Section>

      <Section id="about" title="About">
        <Field label="Headline" name="aboutHeadline" error={errors.aboutHeadline}>
          {input('aboutHeadline', { maxLength: MAX_LENGTH.aboutHeadline })}
        </Field>
        <Field
          label="Our story"
          name="aboutStory"
          error={errors.aboutStory}
          hint={`${(form.aboutStory ?? '').length} / ${MAX_LENGTH.aboutStory} characters. Plain text.`}
        >
          {textarea('aboutStory', 8, MAX_LENGTH.aboutStory)}
        </Field>
        <ImagePicker field="aboutImageKey" label="About picture (optional)" form={form} errors={errors} set={set} uploading={uploading} setUploading={setUploading} />
      </Section>

      <Section id="home" title="Home page">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Hero headline" name="heroHeadline" error={errors.heroHeadline}>
            {input('heroHeadline', { maxLength: MAX_LENGTH.heroHeadline, placeholder: SITE_SETTINGS_DEFAULTS.heroHeadline })}
          </Field>
          <Field label="Hero sub-line" name="heroSubline" error={errors.heroSubline}>
            {input('heroSubline', { maxLength: MAX_LENGTH.heroSubline, placeholder: SITE_SETTINGS_DEFAULTS.heroSubline })}
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ImagePicker field="heroImageKeyDesktop" label="Hero picture (desktop)" form={form} errors={errors} set={set} uploading={uploading} setUploading={setUploading} />
          <ImagePicker field="heroImageKeyMobile" label="Hero picture (mobile)" form={form} errors={errors} set={set} uploading={uploading} setUploading={setUploading} />
        </div>
        <Field label="Colour-block statement" name="statement" error={errors.statement}>
          {input('statement', { maxLength: MAX_LENGTH.statement })}
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(['trustLabel1', 'trustLabel2', 'trustLabel3'] as const).map((k, i) => (
            <Field key={k} label={`Trust strip ${i + 1}`} name={k} error={errors[k]}>
              {input(k, { maxLength: MAX_LENGTH.trustLabel })}
            </Field>
          ))}
        </div>
      </Section>

      <Section id="seo" title="Search and sharing" hint="Defaults for pages that do not set their own.">
        <Field label="Site title" name="seoTitle" error={errors.seoTitle}>
          {input('seoTitle', { maxLength: MAX_LENGTH.seoTitle })}
        </Field>
        <Field label="Meta description" name="seoDescription" error={errors.seoDescription}>
          {input('seoDescription', { maxLength: MAX_LENGTH.seoDescription })}
        </Field>
        <ImagePicker field="seoShareImageKey" label="Default share picture" form={form} errors={errors} set={set} uploading={uploading} setUploading={setUploading} />
      </Section>

      <Section id="availability" title="Availability and product details">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <Field
            label="“Few left” threshold"
            name="fewLeftThreshold"
            error={errors.fewLeftThreshold}
            hint={`Show “few left” at this many pieces or fewer (${FEW_LEFT_MIN}–${FEW_LEFT_MAX}).`}
          >
            {input('fewLeftThreshold', { type: 'number', inputMode: 'numeric', min: FEW_LEFT_MIN, max: FEW_LEFT_MAX, step: 1 })}
          </Field>
          <label className="flex items-start gap-3 pt-7 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.showItemNumber}
              onChange={(e) => set('showItemNumber', e.target.checked)}
              data-testid="input-showItemNumber"
            />
            <span>
              Show the internal item number publicly
              <span className="block text-xs text-slate-500">e.g. “Ref AUG-45” on product pages.</span>
            </span>
          </label>
        </div>
      </Section>

      <Section
        id="feed-order"
        title="Feed order"
        hint="How the looks are ordered on the landing page. Sold-out pieces are always last."
      >
        <fieldset className="space-y-3" aria-describedby={errors.feedRanking ? 'error-feedRanking' : undefined}>
          <legend className="sr-only">Feed order</legend>
          {(
            [
              {
                value: 'AUTO',
                label: 'Rank automatically',
                hint: 'Popular looks move up, recalculated every night from how people browse. New pieces get a boost for their first week, and the top 6 are Featured automatically.',
              },
              {
                value: 'NEWEST',
                label: 'Newest first',
                hint: 'Emergency fallback: newest pieces first. Featured is then set by hand in each product.',
              },
            ] as const
          ).map((o) => (
            <label key={o.value} className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="radio"
                name="feedRanking"
                value={o.value}
                checked={form.feedRanking === o.value}
                onChange={() => set('feedRanking', o.value)}
                data-testid={`input-feedRanking-${o.value}`}
              />
              <span>
                {o.label}
                <span className="block text-xs text-slate-500">{o.hint}</span>
              </span>
            </label>
          ))}
          {errors.feedRanking && (
            <span id="error-feedRanking" className="text-xs text-rose-700" role="alert" data-testid="error-feedRanking">
              {errors.feedRanking}
            </span>
          )}
        </fieldset>
      </Section>

      <div className="flex justify-end pb-nav lg:pb-0">
        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={saving || uploading !== null} data-testid="settings-save">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

/** Upload through the existing /api/upload pipeline; store the object key. */
function ImagePicker({
  field,
  label,
  form,
  errors,
  set,
  uploading,
  setUploading,
}: {
  field: ImageField;
  label: string;
  form: FormState;
  errors: FieldErrors;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  uploading: ImageField | null;
  setUploading: (f: ImageField | null) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const key = form[field];

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(field);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const url = String(data.url ?? '');
      const newKey = url.startsWith(IMAGE_URL_PREFIX) ? `${PRODUCT_IMAGE_PREFIX}${url.slice(IMAGE_URL_PREFIX.length)}` : '';
      if (!isValidImageKey(newKey)) throw new Error('Upload failed');
      set(field, newKey);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Field label={label} name={field} error={errors[field]}>
      <div className="flex items-center gap-3" data-testid={`picker-${field}`}>
        {key && isValidImageKey(key) ? (
          <ProductPicture src={imageUrlForKey(key)} alt="" size={64} className="rounded-md border" testId={`preview-${field}`} />
        ) : (
          <div className="w-16 h-16 rounded-md border border-dashed border-slate-300 bg-brand-cream-50" aria-hidden />
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading !== null}>
            {uploading === field ? 'Uploading…' : key ? 'Replace' : 'Upload'}
          </button>
          {key && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(field, null)}>
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          id={`f-${field}`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
    </Field>
  );
}
