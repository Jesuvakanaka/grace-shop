'use client';
// ZP-1116 (MM-11): enquiries. Write one down, see who to follow up today, and keep taps apart from conversations.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { mk } from '@/components/marketing/api';
import { Card, ErrorNote, Loading, ProductSearch } from '@/components/marketing/parts';
import { ENQUIRY_CHANNEL_LABELS, ENQUIRY_STATUS_CLASSES, ENQUIRY_STATUS_LABELS, followUpLine } from '@/lib/marketing/enquiries-ui';

interface Row { id: number; contactName: string | null; customerName: string | null; customerPhone: string | null; channelKind: string; conversation: string; status: string; nextFollowUpAt: string | null; needsContactReview: boolean; message: string | null; createdAt: string }
interface Counts { taps: number; ownerRecorded: number; providerObserved: number; won: number }
const FILTERS = [['OPEN', 'Open'], ['DUE', 'Follow up today'], ['WON', 'Won'], ['LOST', 'Lost'], ['', 'All']] as const;

export default function EnquiriesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [filter, setFilter] = useState<string>('OPEN');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [products, setProducts] = useState<{ id: number; name: string }[]>([]);
  const [f, setF] = useState({ customerName: '', customerPhone: '', channelKind: 'WHATSAPP', message: '', sourceEvidence: '', trackingTag: '', nextFollowUpAt: '' });

  const load = useCallback(() => {
    const q = filter === 'DUE' ? 'due=1' : filter ? `status=${filter}` : '';
    mk<{ enquiries: Row[]; counts: Counts }>(`/api/marketing/enquiries?${q}`)
      .then((d) => { setRows(d.enquiries); setCounts(d.counts); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { enquiry } = await mk<{ enquiry: { id: number } }>('/api/marketing/enquiries', {
        method: 'POST',
        body: {
          channelKind: f.channelKind,
          ...(f.customerName.trim() ? { customerName: f.customerName } : {}),
          ...(f.customerPhone.trim() ? { customerPhone: f.customerPhone } : {}),
          ...(f.message.trim() ? { message: f.message } : {}),
          ...(f.sourceEvidence.trim() ? { sourceEvidence: f.sourceEvidence } : {}),
          ...(f.trackingTag.trim() ? { trackingTag: f.trackingTag.trim() } : {}),
          ...(f.nextFollowUpAt ? { nextFollowUpAt: new Date(f.nextFollowUpAt).toISOString() } : {}),
          productIds: products.map((p) => p.id),
        },
      });
      router.push(`/marketing/enquiries/${enquiry.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      {counts ? (
        <Card data-testid="enquiry-counts">
          <h3 className="font-semibold text-slate-900 mb-2">Last 30 days</h3>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Taps on &ldquo;Message us&rdquo;</dt><dd className="text-2xl font-semibold" data-testid="count-taps">{counts.taps}</dd></div>
            <div><dt className="text-xs text-slate-500">Conversations you wrote down</dt><dd className="text-2xl font-semibold" data-testid="count-recorded">{counts.ownerRecorded}</dd></div>
            <div><dt className="text-xs text-slate-500">Seen in a connected inbox</dt><dd className="text-2xl font-semibold" data-testid="count-observed">{counts.providerObserved}</dd></div>
            <div><dt className="text-xs text-slate-500">Became a recorded sale</dt><dd className="text-2xl font-semibold" data-testid="count-won">{counts.won}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-slate-500">A tap opens WhatsApp on the customer&apos;s phone. It does not mean they sent a message, so taps are never counted as conversations. No inbox is connected yet.</p>
        </Card>
      ) : null}

      <Card>
        <h3 className="font-semibold text-slate-900 mb-1">Write down an enquiry</h3>
        <p className="text-sm text-slate-600 mb-3">Someone asked about a piece? Note it here so you can follow up. This never signs them up for offers.</p>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2" data-testid="enquiry-form">
          <div><label className="label" htmlFor="q-name">Name</label><input id="q-name" className="input" value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} maxLength={200} data-testid="enquiry-name" /></div>
          <div><label className="label" htmlFor="q-phone">Phone</label><input id="q-phone" className="input" inputMode="tel" value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} maxLength={40} data-testid="enquiry-phone" /></div>
          <div>
            <label className="label" htmlFor="q-channel">Where they asked</label>
            <select id="q-channel" className="select" value={f.channelKind} onChange={(e) => setF({ ...f, channelKind: e.target.value })} data-testid="enquiry-channel">
              {Object.entries(ENQUIRY_CHANNEL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="q-follow">Follow up on</label><input id="q-follow" className="input" type="datetime-local" value={f.nextFollowUpAt} onChange={(e) => setF({ ...f, nextFollowUpAt: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="q-msg">What they asked</label><textarea id="q-msg" className="input min-h-20" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} maxLength={4000} data-testid="enquiry-message" /></div>
          <div><label className="label" htmlFor="q-evidence">How they found you (optional)</label><input id="q-evidence" className="input" placeholder="Said they saw the reel" value={f.sourceEvidence} onChange={(e) => setF({ ...f, sourceEvidence: e.target.value })} maxLength={500} /></div>
          <div><label className="label" htmlFor="q-tag">Tracking tag from their message (optional)</label><input id="q-tag" className="input" value={f.trackingTag} onChange={(e) => setF({ ...f, trackingTag: e.target.value })} maxLength={64} /></div>
          <div className="sm:col-span-2">
            <ProductSearch label="Pieces they asked about" pickedIds={products.map((p) => p.id)} onPick={(p) => setProducts(products.some((x) => x.id === p.id) ? products.filter((x) => x.id !== p.id) : [...products, { id: p.id, name: p.name }])} />
            {products.length ? <p className="mt-1 text-sm text-slate-600" data-testid="enquiry-products">Chosen: {products.map((p) => p.name).join(', ')}</p> : null}
          </div>
          <div className="sm:col-span-2"><button type="submit" className="btn btn-primary min-h-12" disabled={busy || (!f.customerName.trim() && !f.customerPhone.trim())} data-testid="enquiry-create">Save enquiry</button></div>
        </form>
      </Card>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Which enquiries">
        {FILTERS.map(([k, l]) => (
          <button key={k || 'all'} type="button" role="tab" aria-selected={filter === k} className={`rounded-full px-4 py-2 text-sm min-h-10 border ${filter === k ? 'bg-brand-olive-50 text-brand-olive-700 border-brand-olive-200 font-medium' : 'border-slate-200 text-slate-600'}`} onClick={() => { setRows(null); setFilter(k); }} data-testid={`enquiry-filter-${k || 'all'}`}>{l}</button>
        ))}
      </div>

      {!rows && !error ? <Loading /> : null}
      {rows && rows.length === 0 ? <EmptyState icon="💬" title="No enquiries here" description="Write one down above when someone asks about a piece." /> : null}
      <ul className="space-y-3" data-testid="enquiry-list">
        {rows?.map((r) => (
          <li key={r.id}>
            <Link href={`/marketing/enquiries/${r.id}`} className="card flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50" data-testid={`enquiry-${r.id}`}>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{r.contactName ?? r.customerName ?? r.customerPhone ?? 'Someone'}{r.needsContactReview ? <span className="ml-2 text-xs font-normal text-amber-800">check who this is</span> : null}</p>
                <p className="text-sm text-slate-500">{ENQUIRY_CHANNEL_LABELS[r.channelKind] ?? r.channelKind} · {followUpLine(r.nextFollowUpAt, r.status)}</p>
                {r.message ? <p className="text-sm text-slate-600 truncate max-w-prose">{r.message}</p> : null}
              </div>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${ENQUIRY_STATUS_CLASSES[r.status] ?? ''}`}>{ENQUIRY_STATUS_LABELS[r.status] ?? r.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
