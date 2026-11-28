'use client';
// ZP-1200: results (visits, enquiries, reach, clicks, ad spend per channel, post, product and campaign) and the weekly advice.
import React, { useCallback, useEffect, useState } from 'react';
import { mk } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';
import { TruthPanel } from '@/components/marketing/TruthPanel';
import { getChannel } from '@/lib/marketing/channels';
import { defaultRange, enquiryRate, REC_STATUS_LABELS, usd } from '@/lib/marketing/ui';

interface Row { key: string; label: string; posts: number; ads: number; impressions: number; reach: number; clicks: number; visits: number; enquiries: number; spendCents: number; reportedDays: number }
interface Report {
  from: string; to: string;
  totals: Omit<Row, 'key' | 'label' | 'posts' | 'ads'>;
  perPost: (Row & { postId: number; channelKind: string })[];
  perChannel: Row[]; perCampaign: Row[]; perProduct: Row[];
  perAd: (Row & { adId: number })[];
  spendCents: number;
}
interface Rec { id: number; weekOf: string; kind: string; title: string; body: string; status: string }

const channelName = (k: string) => getChannel(k)?.label ?? k;

/** A platform number is known only when a platform reported it for this row; otherwise it is unknown, never 0. */
function Platform({ r, n }: { r: Row; n: number }) {
  return r.reportedDays > 0 ? <>{n}</> : <span className="text-slate-400" data-state="UNKNOWN">Unknown</span>;
}

function Table({ title, rows, labelOf, testId }: { title: string; rows: Row[]; labelOf?: (r: Row) => string; testId: string }) {
  return (
    <Card>
      <h2 className="font-semibold text-slate-900 mb-3">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-slate-500">Nothing in these dates yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid={testId}>
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium text-right">Summed reported reach</th>
                <th className="py-2 pr-3 font-medium text-right">Times shown (reported)</th>
                <th className="py-2 pr-3 font-medium text-right">Clicks (reported)</th>
                <th className="py-2 pr-3 font-medium text-right">Visits</th>
                <th className="py-2 pr-3 font-medium text-right">Message taps</th>
                <th className="py-2 pr-3 font-medium text-right">Tap rate</th>
                <th className="py-2 font-medium text-right">Ad spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="py-2 pr-3 text-slate-900">{labelOf ? labelOf(r) : r.label}</td>
                  <td className="py-2 pr-3 text-right"><Platform r={r} n={r.reach} /></td>
                  <td className="py-2 pr-3 text-right"><Platform r={r} n={r.impressions} /></td>
                  <td className="py-2 pr-3 text-right"><Platform r={r} n={r.clicks} /></td>
                  <td className="py-2 pr-3 text-right">{r.visits}</td>
                  <td className="py-2 pr-3 text-right">{r.enquiries}</td>
                  <td className="py-2 pr-3 text-right">{enquiryRate(r.visits, r.enquiries)}</td>
                  <td className="py-2 text-right">{r.spendCents ? usd(r.spendCents) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function ResultsPage() {
  const [range, setRange] = useState(() => defaultRange());
  const [report, setReport] = useState<Report | null>(null);
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<'sync' | 'advice' | null>(null);

  const loadReport = useCallback((r: { from: string; to: string }) => {
    mk<{ report: Report }>(`/api/marketing/results?from=${r.from}&to=${r.to}`)
      .then((d) => { setReport(d.report); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load results.'));
  }, []);
  const loadRecs = useCallback(() => {
    mk<{ recommendations: Rec[] }>('/api/marketing/recommendations')
      .then((d) => setRecs(d.recommendations))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load advice.'));
  }, []);

  useEffect(() => { loadReport(range); }, [range, loadReport]);
  useEffect(() => { loadRecs(); }, [loadRecs]);

  const sync = async () => {
    setBusy('sync'); setNote(null); setError(null);
    try {
      const d = await mk<{ summary: { posts: number; ads: number; postInsightsFailed: unknown[]; adsFailed: unknown[] } }>('/api/marketing/results/sync', { method: 'POST' });
      const failed = d.summary.postInsightsFailed.length + d.summary.adsFailed.length;
      setNote(`Updated ${d.summary.posts} post${d.summary.posts === 1 ? '' : 's'} and ${d.summary.ads} ad${d.summary.ads === 1 ? '' : 's'}.${failed ? ` ${failed} could not be read from the platform (their visits are still counted).` : ''}`);
      loadReport(range);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update.'); }
    setBusy(null);
  };
  const advice = async () => {
    setBusy('advice'); setNote(null); setError(null);
    try {
      const d = await mk<{ result: { usedAi: boolean; aiError: string | null } }>('/api/marketing/recommendations/generate', { method: 'POST' });
      setNote(d.result.usedAi ? 'This week’s advice is ready.' : `This week’s advice is ready, written from the numbers without AI.${d.result.aiError ? ` (The AI said: ${d.result.aiError})` : ''}`);
      loadRecs();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not get advice.'); }
    setBusy(null);
  };
  const setStatus = async (id: number, status: 'DONE' | 'DISMISSED') => {
    setError(null);
    try { await mk(`/api/marketing/recommendations/${id}`, { method: 'PATCH', body: { status } }); loadRecs(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
  };

  const fresh = recs?.filter((r) => r.status === 'NEW') ?? [];
  const older = recs?.filter((r) => r.status !== 'NEW') ?? [];

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      {note ? <p className="rounded-lg border border-brand-olive-200 bg-brand-olive-50 px-4 py-3 text-sm text-brand-olive-700" role="status" data-testid="results-note">{note}</p> : null}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="res-from">From</label>
            <input id="res-from" type="date" className="input" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} data-testid="results-from" />
          </div>
          <div>
            <label className="label" htmlFor="res-to">To</label>
            <input id="res-to" type="date" className="input" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} data-testid="results-to" />
          </div>
          <button type="button" className="btn btn-secondary" onClick={sync} disabled={busy !== null} data-testid="results-sync">
            {busy === 'sync' ? 'Updating…' : 'Update the numbers'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Visits and message taps come from your own website. A tap opens WhatsApp: it is not a conversation. Conversations are under Enquiries. Reach, times shown and clicks come from Facebook, Instagram and Meta ads once they are connected. Until a platform reports them for a row, they show as Unknown.</p>
      </Card>

      {!report ? <Loading /> : (
        <>
          {/* ZP-1119 (MM-14): totals with their meaning; unknown is never shown as 0. */}
          <TruthPanel from={range.from} to={range.to} />
          <Table title="By channel" rows={report.perChannel} labelOf={(r) => channelName(r.key)} testId="results-channels" />
          <Table title="By post" rows={report.perPost} labelOf={(r) => `${r.label} · ${channelName((r as Report['perPost'][number]).channelKind)}`} testId="results-posts" />
          <Table title="By product" rows={report.perProduct} testId="results-products" />
          <Table title="By campaign" rows={report.perCampaign} testId="results-campaigns" />
          {report.perAd.length > 0 ? <Table title="Ads" rows={report.perAd} testId="results-ads" /> : null}
        </>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-slate-900">Advice for this week</h2>
          <button type="button" className="btn btn-primary" onClick={advice} disabled={busy !== null} data-testid="get-advice">
            {busy === 'advice' ? 'Working it out…' : 'Get this week’s advice'}
          </button>
        </div>
        {recs === null ? <Loading /> : null}
        {recs && fresh.length === 0 ? <p className="text-sm text-slate-500">No new advice. Press the button to work it out from your latest numbers.</p> : null}
        <ul className="space-y-3" data-testid="advice-list">
          {fresh.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-3" data-testid="advice-item">
              <p className="font-medium text-slate-900">{r.title}</p>
              <p className="text-sm text-slate-700 mt-1">{r.body}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn btn-primary" onClick={() => setStatus(r.id, 'DONE')} data-testid={`advice-done-${r.id}`}>Done</button>
                <button type="button" className="btn btn-secondary" onClick={() => setStatus(r.id, 'DISMISSED')} data-testid={`advice-dismiss-${r.id}`}>Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
        {older.length > 0 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-slate-600">Earlier advice ({older.length})</summary>
            <ul className="mt-2 space-y-2">
              {older.map((r) => (
                <li key={r.id} className="text-sm text-slate-600"><span className="text-xs rounded-full border border-slate-200 px-2 py-0.5 mr-2">{REC_STATUS_LABELS[r.status] ?? r.status}</span>{r.title}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>
    </div>
  );
}
