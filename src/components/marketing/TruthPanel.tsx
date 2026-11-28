'use client';
// ZP-1119 (MM-14): the results with what each number means. Unknown is never shown as 0, a rate over nothing is
// "not available", reach is summed reported reach, and nothing is called profit. Advice can become a draft only.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { mk } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';

interface Metric { value: number | null; state: 'KNOWN' | 'UNKNOWN' | 'NOT_AVAILABLE'; label: string; note?: string }
interface Truth {
  from: string; to: string; currency: string; syncedAt: string | null;
  report: {
    reach: Metric; impressions: Metric; clicks: Metric; visits: Metric; taps: Metric; tapRate: Metric;
    conversations: { ownerRecorded: Metric; providerObserved: Metric; note: string };
    sales: { allShopNet: Metric; allShopCount: Metric; creditedNet: Metric; creditedCount: Metric };
    costs: { items: Metric[]; total: Metric; scope: string };
    roas: Metric; costPerCreditedSale: Metric; contribution: Metric & { missing: string[] };
    notes: string[];
  };
  records: { creditedSaleIds: number[]; creditedSales: { id: number; saleDate: string; total: number; customerName: string | null }[]; adIds: number[]; postIds: number[]; broadcastIds: number[] };
}
interface Advice { key: string; kind: 'MARKETING' | 'NOT_MARKETING' | 'TOO_EARLY'; title: string; evidence: string[]; draft: { name: string; productIds: number[] } | null }

const MONEY = new Set(['All-shop takings', 'Takings credited to campaigns', 'Marketing cost', 'Marketing cost per credited sale', 'Contribution after costs']);
const KIND_LABEL: Record<Advice['kind'], string> = { MARKETING: 'Marketing', NOT_MARKETING: 'Not a marketing problem', TOO_EARLY: 'Too early to tell' };

function show(m: Metric, money = false): string {
  if (m.state === 'UNKNOWN') return 'Unknown';
  if (m.state === 'NOT_AVAILABLE') return 'Not available';
  if (money || MONEY.has(m.label) || /spend|Messages sent \(estimated\)/.test(m.label)) return `US$${(m.value ?? 0).toFixed(2)}`;
  if (/tapped/.test(m.label)) return `${m.value}%`;
  if (/per dollar/.test(m.label)) return `US$${(m.value ?? 0).toFixed(2)}`;
  return String(m.value);
}

function Tile({ m, testId }: { m: Metric; testId?: string }) {
  return (
    <div className="card" data-testid={testId} data-state={m.state}>
      <p className="text-xs uppercase text-slate-500">{m.label}</p>
      <p className={`text-2xl font-semibold ${m.state === 'KNOWN' ? 'text-slate-900' : 'text-slate-400'}`}>{show(m)}</p>
      {m.note ? <p className="mt-1 text-xs text-slate-500">{m.note}</p> : null}
    </div>
  );
}

export function TruthPanel({ from, to }: { from: string; to: string }) {
  const [d, setD] = useState<{ truth: Truth; advice: Advice[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    mk<{ truth: Truth; advice: Advice[] }>(`/api/marketing/results/truth?from=${from}&to=${to}`).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const accept = async (a: Advice) => {
    setBusy(a.key); setError(null); setNote(null);
    try {
      const { campaign } = await mk<{ campaign: { id: number; name: string } }>('/api/marketing/results/advice', { method: 'POST', body: { key: a.key, from, to } });
      setNote(`Draft campaign "${campaign.name}" made. Nothing is posted or spent until you plan and approve it.`);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not make the draft.'); }
    setBusy(null);
  };

  if (!d) return error ? <ErrorNote message={error} /> : <Loading />;
  const r = d.truth.report;
  const rec = d.truth.records;
  return (
    <div className="space-y-6" data-testid="truth-panel">
      <ErrorNote message={error} />
      {note ? <p className="rounded-lg border border-brand-olive-200 bg-brand-olive-50 px-4 py-3 text-sm text-brand-olive-700" role="status" data-testid="truth-note">{note}</p> : null}
      <p className="text-xs text-slate-500">All money in {d.truth.currency}. Platform numbers last brought in: {d.truth.syncedAt ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Harare' }).format(new Date(d.truth.syncedAt)) : 'never'}.</p>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Seen and visited</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="truth-reach">
          <Tile m={r.reach} testId="truth-reach-tile" /><Tile m={r.impressions} /><Tile m={r.clicks} />
          <Tile m={r.visits} /><Tile m={r.taps} /><Tile m={r.tapRate} testId="truth-tap-rate" />
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Conversations and sales</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="truth-sales">
          <Tile m={r.conversations.ownerRecorded} /><Tile m={r.conversations.providerObserved} />
          <Tile m={r.sales.allShopNet} /><Tile m={r.sales.allShopCount} />
          <Tile m={r.sales.creditedNet} /><Tile m={r.sales.creditedCount} />
        </div>
        <p className="mt-2 text-xs text-slate-500">{r.conversations.note}</p>
        <p className="mt-1 text-xs text-slate-600" data-testid="truth-records">
          Behind these numbers: <Link className="underline" href="/marketing/enquiries">enquiries</Link>
          {rec.postIds.length ? <> · {rec.postIds.length} posts</> : null}
          {rec.adIds.length ? <> · ads {rec.adIds.map((id, i) => <React.Fragment key={id}>{i ? ', ' : ''}<Link className="underline" href="/marketing/ads">{id}</Link></React.Fragment>)}</> : null}
          {rec.broadcastIds.length ? <> · messages {rec.broadcastIds.map((id, i) => <React.Fragment key={id}>{i ? ', ' : ''}<Link className="underline" href={`/marketing/messages/${id}`}>{id}</Link></React.Fragment>)}</> : null}
        </p>
        <details className="mt-2" data-testid="truth-credited-sales">
          <summary className="cursor-pointer text-sm text-slate-700">Credited sales ({rec.creditedSales.length})</summary>
          {rec.creditedSales.length === 0 ? <p className="mt-1 text-sm text-slate-500">None in these dates.</p> : (
            <ul className="mt-1 divide-y divide-slate-100 text-sm">
              {rec.creditedSales.map((s) => <li key={s.id} className="py-1">Sale {s.id} · {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Africa/Harare' }).format(new Date(s.saleDate))} · US${s.total.toFixed(2)}{s.customerName ? ` · ${s.customerName}` : ''}</li>)}
            </ul>
          )}
        </details>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Costs and what they bought</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="truth-costs">
          {r.costs.items.map((m) => <Tile key={m.label} m={m} />)}
          <Tile m={r.costs.total} />
          <Tile m={r.roas} testId="truth-roas" /><Tile m={r.costPerCreditedSale} /><Tile m={r.contribution} testId="truth-contribution" />
        </div>
        <p className="mt-2 text-xs text-slate-500">{r.costs.scope}</p>
        <ul className="mt-2 list-disc pl-5 text-xs text-slate-500">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </section>

      <Card>
        <h2 className="font-semibold text-slate-900 mb-1">What to do next</h2>
        <p className="text-xs text-slate-500 mb-3">From your campaigns, stock, waiting customers and budget. Advice never changes your shop. Making a draft only creates a campaign for you to plan.</p>
        {d.advice.length === 0 ? <p className="text-sm text-slate-500">Nothing stands out right now.</p> : null}
        <ul className="space-y-3" data-testid="truth-advice">
          {d.advice.map((a) => (
            <li key={a.key} className="rounded-lg border border-slate-200 p-3" data-testid={`truth-advice-${a.kind}`}>
              <p className="text-xs uppercase text-slate-500">{KIND_LABEL[a.kind]}</p>
              <p className="font-medium text-slate-900">{a.title}</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">{a.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
              {a.draft ? <button type="button" className="btn btn-primary mt-3 min-h-12" disabled={busy !== null} onClick={() => accept(a)} data-testid="truth-make-draft">{busy === a.key ? 'Making…' : 'Make a draft campaign'}</button> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
