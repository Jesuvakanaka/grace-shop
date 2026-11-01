'use client';
// ZP-505: Insights (OWNER only). How the VYRA storefront is used: visits,
// looks, photos, videos, funnel, feed depth, demand, sources and health.
// Reads GET /api/insights (rollups; today live). See docs/admin/insights.md.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import type { InsightsReport } from '@/lib/insights/types';
import { fmt } from '@/components/insights/parts';
import {
  DemandReport,
  DepthReport,
  FunnelReport,
  HealthReport,
  LooksReport,
  OverviewReport,
  PhotosReport,
  ReviewsReport,
  SourcesReport,
  VideosReport,
} from '@/components/insights/reports';

type Preset = 'today' | '7d' | '30d' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'custom', label: 'Custom' },
];
const SECTIONS = [
  ['overview', 'Overview'],
  ['looks', 'Looks'],
  ['photos', 'Photos'],
  ['videos', 'Videos'],
  ['funnel', 'Funnel'],
  ['depth', 'Feed depth'],
  ['demand', 'Demand'],
  ['sources', 'Sources'],
  ['health', 'Health'],
  ['reviews', 'Reviews'],
] as const;

/** Today in Harare (the analytics day), for the date pickers. */
function harareToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default function InsightsPage() {
  const { isOwner, loading: authLoading } = useAuth();
  const [preset, setPreset] = useState<Preset>('7d');
  const [custom, setCustom] = useState<{ from: string; to: string }>(() => ({ from: '', to: '' }));
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [report, setReport] = useState<InsightsReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const query = useMemo(() => {
    if (preset !== 'custom') return `range=${preset}`;
    return applied ? `range=custom&from=${applied.from}&to=${applied.to}` : null;
  }, [preset, applied]);

  useEffect(() => {
    if (!isOwner || !query) return;
    const ctrl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch when the range changes
    setLoading(true);
    setError('');
    fetch(`/api/insights?${query}`, { signal: ctrl.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load the insights');
        setReport(data as InsightsReport);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Could not load the insights');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [isOwner, query]);

  if (authLoading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (!isOwner) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-2">Insights</h1>
        <p className="text-slate-600">Only the owner can see the website insights.</p>
      </div>
    );
  }

  const csv = (name: string) => `/api/insights?${query ?? 'range=7d'}&csv=${name}`;
  const today = harareToday();
  const r = report;
  const noData = r && r.overview.visits === 0 && r.looks.rows.length === 0 && r.health.byDetail.length === 0;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto min-w-0" data-testid="insights-page">
      <PageHeader title="Insights" subtitle="How people use the VYRA website. Anonymous totals only." />

      <div className="card p-3 md:p-4 space-y-3">
        <div role="group" aria-label="Date range" className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              onClick={() => {
                setPreset(p.key);
                if (p.key === 'custom' && !custom.from) setCustom({ from: r?.range.from ?? today, to: r?.range.to ?? today });
              }}
              className={`px-3 py-2 rounded-lg text-sm font-medium border min-h-[40px] ${
                preset === p.key ? 'bg-brand-olive border-brand-olive text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
              data-testid={`range-${p.key}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.from && custom.to) setApplied({ ...custom });
            }}
          >
            <label className="text-xs text-slate-600">
              From
              <input type="date" className="input text-sm mt-1" value={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} data-testid="range-from" />
            </label>
            <label className="text-xs text-slate-600">
              To
              <input type="date" className="input text-sm mt-1" value={custom.to} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} data-testid="range-to" />
            </label>
            <button type="submit" className="btn btn-primary min-h-[40px]" data-testid="range-apply">
              Show
            </button>
          </form>
        )}
        {r && (
          <p className="text-xs text-slate-500" data-testid="range-note">
            {fmt.day(r.range.from)}
            {r.range.from !== r.range.to ? ` – ${fmt.day(r.range.to)}` : ''} (Harare days). Updated nightly
            {r.range.liveDays.length > 0 ? `; ${r.range.liveDays.map(fmt.day).join(' and ')} counted live (up to a minute old)` : ''}.
          </p>
        )}
        {r && r.range.liveUnavailable.length > 0 && (
          <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2" role="status" data-testid="live-unavailable">
            {r.range.liveUnavailable.map(fmt.day).join(' and ')} could not be counted just now and is left out. Try again in a minute.
          </p>
        )}
      </div>

      <nav aria-label="Reports" className="flex gap-2 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-1 no-print">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            {label}
          </a>
        ))}
      </nav>

      {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm" role="alert">{error}</div>}
      {loading && !r && <div className="p-8 text-center text-slate-500">Loading insights…</div>}
      {preset === 'custom' && !applied && !r && <p className="text-sm text-slate-500">Choose the dates and press Show.</p>}

      {r && (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {noData && (
            <EmptyState
              icon="📈"
              title="No visits in this range yet"
              description="Visits to the website are counted anonymously and added up every night. Try a longer range, or check back tomorrow."
            />
          )}
          <OverviewReport r={r} csv={csv} />
          <LooksReport r={r} csv={csv} />
          <PhotosReport r={r} csv={csv} />
          <VideosReport r={r} csv={csv} />
          <FunnelReport r={r} csv={csv} />
          <DepthReport r={r} csv={csv} />
          <DemandReport r={r} csv={csv} />
          <SourcesReport r={r} csv={csv} />
          <HealthReport r={r} csv={csv} />
          <ReviewsReport r={r} csv={csv} />
        </div>
      )}
    </div>
  );
}
