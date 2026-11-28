'use client';
// ZP-1106 (MM-01): "Your business". The shop facts the owner confirms, who confirmed each and when,
// only the questions still open, the contact facts the website settings already hold, and the
// catalogue as marketing sees it (by product id, never copied).
import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import { mk } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';
import {
  CONTACT_ROUTES, CONTACT_ROUTE_LABEL, SALES_MODES, SALES_MODE_LABEL, SUPPORTED_CURRENCIES, SUPPORTED_TIME_ZONES,
  type SetupState, type TruthField, type TruthItem,
} from '@/lib/marketing/shop-truth';

interface CatalogueRow {
  productId: number;
  name: string;
  availability: { kind: string; quantity?: number; shipFrom?: string | null; shipTo?: string | null };
  excluded: string | null;
  wholesale: { text: string } | { reason: string };
  profile: { exists: boolean; aiGenerated: boolean; confirmedBy: string | null; confirmedAt: string | null };
}

const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '');

function Badge({ item }: { item: TruthItem }) {
  if (item.status === 'confirmed') return <span className="text-xs text-emerald-700" data-testid={`truth-status-${item.field}`}>Confirmed by {item.confirmedBy} on {when(item.confirmedAt)}</span>;
  if (item.status === 'unknown') return <span className="text-xs text-slate-600" data-testid={`truth-status-${item.field}`}>Left unknown by {item.confirmedBy} on {when(item.confirmedAt)}. The AI will not mention it.</span>;
  if (item.status === 'unconfirmed') return <span className="text-xs text-amber-700" data-testid={`truth-status-${item.field}`}>Not confirmed yet</span>;
  return <span className="text-xs text-amber-700" data-testid={`truth-status-${item.field}`}>Not answered yet</span>;
}

const availabilityText = (a: CatalogueRow['availability']) => {
  if (a.kind === 'IN_STOCK') return `In stock (${a.quantity})`;
  if (a.kind === 'PRE_ORDER') return a.shipFrom ? `Pre-order, ships from ${when(a.shipFrom)}` : 'Pre-order, no ship date yet';
  if (a.kind === 'SOLD_OUT') return 'Sold out';
  return 'Not on the website';
};

type Form = { market: string; currency: string; timeZone: string; salesMode: string; contactRoute: string; audienceNotes: string };

export function BusinessTruth({ onSaved }: { onSaved?: () => void }) {
  const toast = useToast();
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [form, setForm] = useState<Form>({ market: '', currency: '', timeZone: '', salesMode: '', contactRoute: '', audienceNotes: '' });
  const [products, setProducts] = useState<CatalogueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((d: { setup: SetupState }) => {
    setSetup(d.setup);
    const v = (f: TruthField) => d.setup.items.find((i) => i.field === f)?.value;
    setForm({
      market: (v('market') as string | null) ?? '',
      currency: (v('currency') as string | null) ?? '',
      timeZone: (v('timeZone') as string | null) ?? '',
      salesMode: (v('salesMode') as string | null) ?? '',
      contactRoute: (v('contactRoute') as string | null) ?? '',
      audienceNotes: ((v('audienceNotes') as string[] | null) ?? []).join('\n'),
    });
  }, []);

  useEffect(() => {
    mk<{ setup: SetupState }>('/api/marketing/settings').then(apply).catch((e) => setError(e.message));
    mk<{ products: CatalogueRow[] }>('/api/marketing/catalogue').then((d) => setProducts(d.products)).catch(() => setProducts([]));
  }, [apply]);

  const put = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      apply(await mk<{ setup: SetupState }>('/api/marketing/settings', { method: 'PUT', body }));
      onSaved?.();
      toast.success(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void put({
      market: form.market || null,
      currency: form.currency || null,
      timeZone: form.timeZone || null,
      salesMode: form.salesMode || null,
      contactRoute: form.contactRoute || null,
      audienceNotes: form.audienceNotes.split('\n').map((l) => l.trim()).filter(Boolean),
    }, 'Your business is saved.');
  };

  if (!setup) return error ? <ErrorNote message={error} /> : <Loading />;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const item = (f: TruthField) => setup.items.find((i) => i.field === f) as TruthItem;
  const confirmable = setup.items.filter((i) => i.status === 'unconfirmed' || (i.status === 'missing' && ['policyDelivery', 'policyReturns', 'policyOrdering', 'audienceNotes'].includes(i.field)));
  const site = setup.site;

  return (
    <div className="space-y-6" data-testid="business-truth">
      <ErrorNote message={error} />
      <Card className="space-y-3">
        <h2 className="font-serif text-xl font-semibold">Your business</h2>
        <p className="text-sm text-slate-600">The marketing manager only says what you confirm here and on each product. Nothing is guessed from photos or phone numbers.</p>
        {setup.complete ? (
          <p className="text-sm text-emerald-700" data-testid="truth-complete">Everything is confirmed.</p>
        ) : (
          <div data-testid="truth-to-ask">
            <p className="text-sm font-medium text-slate-900">Still to answer ({setup.toAsk.length})</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
              {setup.toAsk.map((f) => <li key={f}>{item(f).question}</li>)}
            </ul>
          </div>
        )}
        {setup.warnings.map((w) => <p key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{w}</p>)}
      </Card>

      <form onSubmit={save}>
        <Card className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="t-market">Where you sell</label>
              <input id="t-market" className="input" value={form.market} onChange={set('market')} maxLength={120} placeholder="For example: Harare and Bulawayo" data-testid="truth-market" />
              <Badge item={item('market')} />
            </div>
            <div>
              <label className="label" htmlFor="t-mode">Retail or wholesale</label>
              <select id="t-mode" className="select" value={form.salesMode} onChange={set('salesMode')} data-testid="truth-sales-mode">
                <option value="">Choose</option>
                {SALES_MODES.map((m) => <option key={m} value={m}>{SALES_MODE_LABEL[m]}</option>)}
              </select>
              <Badge item={item('salesMode')} />
            </div>
            <div>
              <label className="label" htmlFor="t-currency">Currency</label>
              <select id="t-currency" className="select" value={form.currency} onChange={set('currency')} data-testid="truth-currency">
                <option value="">Choose</option>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>US dollars ({c})</option>)}
              </select>
              <Badge item={item('currency')} />
            </div>
            <div>
              <label className="label" htmlFor="t-tz">Time zone</label>
              <select id="t-tz" className="select" value={form.timeZone} onChange={set('timeZone')} data-testid="truth-time-zone">
                <option value="">Choose</option>
                {SUPPORTED_TIME_ZONES.map((z) => <option key={z} value={z}>Harare time ({z})</option>)}
              </select>
              <Badge item={item('timeZone')} />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="t-route">How customers reach you first</label>
              <select id="t-route" className="select" value={form.contactRoute} onChange={set('contactRoute')} data-testid="truth-contact-route">
                <option value="">Choose</option>
                {CONTACT_ROUTES.map((r) => <option key={r} value={r}>{CONTACT_ROUTE_LABEL[r]}</option>)}
              </select>
              <Badge item={item('contactRoute')} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="t-audience">Who you think buys (one guess per line)</label>
            <textarea id="t-audience" className="input min-h-24" value={form.audienceNotes} onChange={set('audienceNotes')} placeholder="For example: mothers of girls aged 2 to 8, shopping for parties" data-testid="truth-audience" />
            <p className="mt-1 text-xs text-slate-500">These stay guesses. Plans show them as guesses until results back them up.</p>
            <Badge item={item('audienceNotes')} />
          </div>
          <p className="text-xs text-slate-500">Only US dollars and Harare time work for now. Changing a fact here confirms it in your name.</p>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="truth-save">Save your business</button>
        </Card>
      </form>

      {confirmable.length > 0 ? (
        <Card className="space-y-3" data-testid="truth-confirm">
          <h3 className="font-semibold text-slate-900">Is this right?</h3>
          <p className="text-sm text-slate-600">These were filled in before, or left empty. Confirm them as they are, or change them below and save.</p>
          <ul className="divide-y divide-slate-100">
            {confirmable.map((i) => (
              <li key={i.field} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm">
                  <span className="font-medium">{i.label}:</span>{' '}
                  {i.value === null || (Array.isArray(i.value) && i.value.length === 0) || i.value === ''
                    ? <em className="text-slate-500">empty (the AI will not mention it)</em>
                    : i.field === 'monthlySpendCapCents' ? `$${(Number(i.value) / 100).toFixed(2)}` : Array.isArray(i.value) ? i.value.join('; ') : String(i.value)}
                </span>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void put({ confirm: [i.field] }, `${i.label} confirmed.`)} data-testid={`truth-confirm-${i.field}`}>
                  {i.value === null || i.value === '' || (Array.isArray(i.value) && i.value.length === 0) ? 'Keep it unknown' : 'This is right'}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="space-y-2" data-testid="truth-site">
        <h3 className="font-semibold text-slate-900">From your website settings</h3>
        <p className="text-sm text-slate-600">Used as they are. Change them under Website &gt; Settings.</p>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-slate-500">WhatsApp</dt><dd>{site.whatsappNumber ?? <em className="text-slate-500">not set</em>}</dd>
          <dt className="text-slate-500">Phone</dt><dd>{site.phone ?? <em className="text-slate-500">not set</em>}</dd>
          <dt className="text-slate-500">Email</dt><dd>{site.email ?? <em className="text-slate-500">not set</em>}</dd>
          <dt className="text-slate-500">Address</dt><dd>{site.address ?? <em className="text-slate-500">not set</em>}</dd>
          <dt className="text-slate-500">Opening hours</dt><dd>{site.openingHoursSet ? 'set' : <em className="text-slate-500">not set</em>}</dd>
          <dt className="text-slate-500">Payment</dt><dd>{site.paymentMethods ?? <em className="text-slate-500">not set</em>}</dd>
        </dl>
      </Card>

      <Card className="space-y-2" data-testid="truth-catalogue">
        <h3 className="font-semibold text-slate-900">Your products, as marketing sees them</h3>
        <p className="text-sm text-slate-600">Straight from the catalogue. Sold-out pieces and pieces taken off the website are never marketed.</p>
        {!products ? <Loading /> : products.length === 0 ? <p className="text-sm text-slate-500">No products on the website yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {products.map((p) => (
              <li key={p.productId} className="py-2 text-sm" data-testid={`truth-product-${p.productId}`}>
                <p className="font-medium text-slate-900">{p.name}</p>
                <p className="text-slate-600">
                  {availabilityText(p.availability)}
                  {' · '}{'text' in p.wholesale ? `Wholesale: ${p.wholesale.text}` : 'No wholesale offer'}
                  {' · '}{p.profile.exists ? (p.profile.confirmedBy ? `Selling profile confirmed by ${p.profile.confirmedBy}` : 'Selling profile not confirmed yet') : 'No selling profile yet'}
                </p>
                {p.excluded ? <p className="text-amber-700">{p.excluded}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
