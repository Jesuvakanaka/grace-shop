'use client';
// ZP-1200: influencers, resellers and ambassadors. Each has a code that tags their links, so you can see what they bring in.
// The hub pays nobody: it only shows visits and enquiries.
import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { SharePhotos } from '@/components/SharePhotos';
import { useToast } from '@/components/Toast';
import { mk, type PickerProduct } from '@/components/marketing/api';
import { Card, ErrorNote, Loading, ProductSearch } from '@/components/marketing/parts';
import { imageUrlForKey, isValidImageKey } from '@/lib/storage/keys';

interface Results { days: number; visits: number; enquiries: number }
interface Partner { id: number; name: string; kind: string; phone: string | null; handle: string | null; code: string; commissionPercent: number | null; notes: string | null; status: string; results?: Results }
interface Kit { link: string | null; text: string; imageKeys: string[]; productName: string | null }
const KINDS: Record<string, string> = { INFLUENCER: 'Influencer', RESELLER: 'Reseller', AMBASSADOR: 'Ambassador' };

function KitPanel({ partner }: { partner: Partner }) {
  const toast = useToast();
  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [kit, setKit] = useState<Kit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const productId = product?.id;
  useEffect(() => {
    let cancelled = false;
    mk<{ kit: Kit }>(`/api/marketing/partners/${partner.id}/kit${productId ? `?productId=${productId}` : ''}`)
      .then((d) => !cancelled && (setKit(d.kit), setError(null)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not make the kit.'));
    return () => { cancelled = true; };
  }, [partner.id, productId]);
  const copy = (value: string, what: string) => navigator.clipboard.writeText(value).then(() => toast.success(`${what} copied`)).catch(() => toast.error('Could not copy'));
  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3" data-testid={`partner-kit-${partner.id}`}>
      <ErrorNote message={error} />
      <ProductSearch onPick={(p) => setProduct(p)} pickedIds={product ? [product.id] : []} label="Share one product (or leave empty to share the shop)" />
      {kit ? (
        <div className="rounded-lg border border-brand-olive-200 bg-brand-olive-50 p-4 space-y-3">
          <h4 className="font-semibold text-slate-900">Share kit{kit.productName ? `: ${kit.productName}` : ''}</h4>
          <p className="text-sm text-slate-600">Their link (it carries the code <strong>{partner.code}</strong>, so visits and message taps show up here):</p>
          <p className="break-all text-sm font-mono" data-testid="kit-link">{kit.link ?? 'The shop address is not set yet.'}</p>
          <pre className="whitespace-pre-wrap rounded bg-white border border-slate-200 p-3 text-sm" data-testid="kit-text">{kit.text}</pre>
          <div className="flex flex-wrap gap-2">
            {kit.link ? <button type="button" className="btn btn-secondary min-h-12" onClick={() => copy(kit.link as string, 'Link')}>Copy link</button> : null}
            <button type="button" className="btn btn-secondary min-h-12" onClick={() => copy(kit.text, 'Words')}>Copy words</button>
          </div>
          <SharePhotos urls={kit.imageKeys.filter(isValidImageKey).map(imageUrlForKey)} title={kit.productName ?? 'VYRA'} text={kit.text} />
        </div>
      ) : null}
    </div>
  );
}

export default function PartnersPage() {
  const [items, setItems] = useState<Partner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [f, setF] = useState({ name: '', kind: 'INFLUENCER', phone: '', handle: '', code: '', commission: '', notes: '' });

  const load = useCallback(() => {
    mk<{ partners: Partner[] }>('/api/marketing/partners').then((d) => setItems(d.partners)).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await mk('/api/marketing/partners', {
        method: 'POST',
        body: { name: f.name, kind: f.kind, phone: f.phone || null, handle: f.handle || null, code: f.code || undefined, commissionPercent: f.commission === '' ? null : Number(f.commission), notes: f.notes || null },
      });
      setF({ name: '', kind: 'INFLUENCER', phone: '', handle: '', code: '', commission: '', notes: '' });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    setBusy(false);
  };
  const toggle = async (p: Partner) => {
    setError(null);
    try { await mk(`/api/marketing/partners/${p.id}`, { method: 'PATCH', body: { status: p.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } }); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
  };

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      <Card>
        <p className="text-sm text-slate-600 mb-3">Give each influencer or reseller their own link. You see the visits and message taps it brings. VYRA does not pay anyone: the commission is only a reminder of what you agreed.</p>
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2" data-testid="partner-form">
          <div><label className="label" htmlFor="p-name">Name</label><input id="p-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} required data-testid="partner-name" /></div>
          <div>
            <label className="label" htmlFor="p-kind">Kind</label>
            <select id="p-kind" className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          <div><label className="label" htmlFor="p-phone">Phone (optional)</label><input id="p-phone" className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div><label className="label" htmlFor="p-handle">Instagram or TikTok name (optional)</label><input id="p-handle" className="input" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} maxLength={80} /></div>
          <div><label className="label" htmlFor="p-code">Code for the link (leave empty to make one)</label><input id="p-code" className="input" placeholder="tendai-23" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} maxLength={32} data-testid="partner-code" /></div>
          <div><label className="label" htmlFor="p-comm">Commission agreed, % (optional)</label><input id="p-comm" className="input" type="number" min={0} max={100} value={f.commission} onChange={(e) => setF({ ...f, commission: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="p-notes">Note (optional)</label><input id="p-notes" className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={1000} /></div>
          <div className="sm:col-span-2"><button type="submit" className="btn btn-primary" disabled={busy || f.name.trim() === ''} data-testid="partner-add">Add partner</button></div>
        </form>
      </Card>

      {!items && !error ? <Loading /> : null}
      {items && items.length === 0 ? <EmptyState icon="🤝" title="No partners yet" description="Add an influencer or a reseller to give them their own tracked link." /> : null}
      <ul className="space-y-3" data-testid="partner-list">
        {items?.map((p) => (
          <li key={p.id} className="card" data-testid={`partner-${p.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{p.name} <span className="text-sm font-normal text-slate-500">· {KINDS[p.kind]}{p.handle ? ` · ${p.handle}` : ''}{p.status === 'PAUSED' ? ' · paused' : ''}</span></p>
                <p className="text-sm text-slate-500">Code <span className="font-mono">{p.code}</span>{p.commissionPercent !== null ? ` · ${p.commissionPercent}% agreed` : ''}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => toggle(p)}>{p.status === 'ACTIVE' ? 'Pause' : 'Make active'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>{open === p.id ? 'Close' : 'Link and kit'}</button>
              </div>
            </div>
            <p className="mt-2 text-sm" data-testid={`partner-results-${p.id}`}>Last {p.results?.days ?? 30} days: <strong>{p.results?.visits ?? 0}</strong> visits, <strong>{p.results?.enquiries ?? 0}</strong> visits that tapped to message you on WhatsApp (a tap, not a confirmed conversation).</p>
            {open === p.id ? <KitPanel partner={p} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
