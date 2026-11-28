'use client';
// ZP-1200: one campaign: edit, pick products, see its content.
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { mk, type Campaign, type Content, type PickerProduct } from '@/components/marketing/api';
import { Card, ErrorNote, Loading, ProductSearch, StatusPill } from '@/components/marketing/parts';
import { centsToUsd, channelLabel, toLocalInput, usdToCents } from '@/lib/marketing/ui';

const OBJECTIVES: Record<string, string> = { AWARENESS: 'Get seen', VISITS: 'Get visits to the website', ENQUIRIES: 'Get enquiries' };
const STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'];
const dateOnly = (iso: string | null) => (iso ? toLocalInput(iso).slice(0, 10) : '');

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [c, setC] = useState<Campaign | null>(null);
  const [form, setForm] = useState({ name: '', goal: '', objective: 'AWARENESS', status: 'DRAFT', startsAt: '', endsAt: '', budget: '', notes: '' });
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [productIds, setProductIds] = useState<number[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const apply = (camp: Campaign) => {
    setC(camp);
    setProductIds(camp.productIds);
    setForm({ name: camp.name, goal: camp.goal ?? '', objective: camp.objective, status: camp.status, startsAt: dateOnly(camp.startsAt), endsAt: dateOnly(camp.endsAt), budget: centsToUsd(camp.budgetCents), notes: camp.notes ?? '' });
  };

  useEffect(() => {
    mk<{ campaign: Campaign }>(`/api/marketing/campaigns/${id}`).then((d) => apply(d.campaign)).catch((e) => setError(e.message));
    mk<{ content: Content[] }>(`/api/marketing/content?campaignId=${id}`).then((d) => setContent(d.content)).catch(() => {});
  }, [id]);

  // Names of the chosen products (kept listed even if no longer published).
  const idsKey = productIds.join(',');
  useEffect(() => {
    if (!idsKey) return;
    mk<{ products: PickerProduct[] }>(`/api/marketing/products?ids=${idsKey}`).then((d) => setProducts(d.products)).catch(() => {});
  }, [idsKey]);

  const save = async () => {
    setError(null);
    const budgetCents = usdToCents(form.budget);
    if (budgetCents === undefined) return setError('The budget must be an amount like 50 or 49.99.');
    setBusy(true);
    try {
      const body = {
        name: form.name,
        goal: form.goal || null,
        objective: form.objective,
        status: form.status,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        budgetCents,
        notes: form.notes || null,
        productIds,
      };
      apply((await mk<{ campaign: Campaign }>(`/api/marketing/campaigns/${id}`, { method: 'PATCH', body })).campaign);
      toast.success('Campaign saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    try {
      await mk(`/api/marketing/campaigns/${id}`, { method: 'DELETE' });
      router.push('/marketing/campaigns');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not archive.');
    }
  };

  if (!c) return error ? <ErrorNote message={error} /> : <Loading />;
  // ZP-1124: an archived campaign is read-only: the form is disabled and there is no Save.
  const readOnly = c.status === 'ARCHIVED';
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-6 max-w-3xl">
      <ErrorNote message={error} />
      {c.status === 'ARCHIVED' ? <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="campaign-archived">This campaign is archived. It is kept for the record and can no longer be changed.</p> : null}
      <fieldset disabled={readOnly} className="space-y-6">
      <Card className="space-y-4">
        <div><label className="label" htmlFor="f-name">Name</label><input id="f-name" className="input" value={form.name} onChange={set('name')} maxLength={120} data-testid="campaign-edit-name" /></div>
        <div><label className="label" htmlFor="f-goal">Goal, in plain words</label><input id="f-goal" className="input" value={form.goal} onChange={set('goal')} maxLength={500} placeholder="For example: sell the new school range before term starts" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="f-obj">Aim</label><select id="f-obj" className="select" value={form.objective} onChange={set('objective')}>{Object.entries(OBJECTIVES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="label" htmlFor="f-status">Status</label><select id="f-status" className="select" value={form.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></div>
          <div><label className="label" htmlFor="f-start">Starts</label><input id="f-start" type="date" className="input" value={form.startsAt} onChange={set('startsAt')} /></div>
          <div><label className="label" htmlFor="f-end">Ends</label><input id="f-end" type="date" className="input" value={form.endsAt} onChange={set('endsAt')} /></div>
          <div><label className="label" htmlFor="f-budget">Budget (USD)</label><input id="f-budget" inputMode="decimal" className="input" value={form.budget} onChange={set('budget')} placeholder="0.00" /></div>
        </div>
        <div><label className="label" htmlFor="f-notes">Notes</label><textarea id="f-notes" className="input min-h-24" value={form.notes} onChange={set('notes')} maxLength={2000} /></div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-serif text-xl font-semibold">Products</h2>
        {products.length === 0 ? <p className="text-sm text-slate-500">No products chosen yet.</p> : (
          <ul className="flex flex-wrap gap-2" data-testid="campaign-products">
            {products.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white pl-3 pr-1 py-1 text-sm">
                {p.name}
                <button type="button" className="h-8 w-8 rounded-full hover:bg-slate-100" aria-label={`Remove ${p.name}`} onClick={() => setProductIds(productIds.filter((x) => x !== p.id))}>×</button>
              </li>
            ))}
          </ul>
        )}
        {readOnly ? null : <ProductSearch onPick={(p) => !productIds.includes(p.id) && setProductIds([...productIds, p.id])} extraIds={productIds} pickedIds={productIds} label="Add a product" />}
      </Card>
      </fieldset>

      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || form.name.trim() === ''} data-testid="campaign-save">Save campaign</button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)} data-testid="campaign-archive">Archive</button>
        </div>
      )}

      <Card className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-serif text-xl font-semibold">Content</h2>{readOnly ? null : <Link className="btn btn-secondary btn-sm" href={`/marketing/content/new?campaignId=${id}`}>New content</Link>}</div>
        {content.length === 0 ? <p className="text-sm text-slate-500">No content in this campaign yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {content.map((k) => (
              <li key={k.id}>
                <Link href={`/marketing/content/${k.id}`} className="block py-3">
                  <p className="font-medium text-slate-900">{k.title}</p>
                  <ul className="mt-1 flex flex-wrap gap-2">{(k.posts ?? []).map((p) => <li key={p.id} className="flex items-center gap-1 text-xs text-slate-600">{channelLabel(p.channelKind)} <StatusPill status={p.status} /></li>)}</ul>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog open={confirmDelete} title="Archive this campaign?" message="The campaign, its content and its results are kept for the record. Posts that have not gone out are withdrawn and no more posts from it go out. A campaign with an ad running on Meta or Google cannot be archived: pause the ad first." confirmText="Archive" variant="danger" onCancel={() => setConfirmDelete(false)} onConfirm={remove} />
    </div>
  );
}
