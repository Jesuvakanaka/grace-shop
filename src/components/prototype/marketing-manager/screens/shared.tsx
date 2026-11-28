'use client';
// Pieces shared by several prototype screens.
import React from 'react';
import { FORMATS, channelById, type DemoConnection, type FormatId } from '../catalog';
import { fmtDay, money, r2, relDay } from '../dates';
import { SHOWN_LABEL, activeCampaign, reducer, shownState, type ShownState } from '../engine';
import { STAGES, STAGE_INFO } from '../plan';
import { useDemo } from '../store';
import type { Campaign, Material, Stage } from '../types';
import { Icon, Pill, STATE_TONE } from '../ui';

/** One material's overall state, from its placements. */
export function materialSummary(states: ShownState[]): ShownState {
  const order: ShownState[] = ['failed', 'awaiting', 'spend', 'manual', 'paused', 'ready', 'scheduled', 'published'];
  for (const st of order) if (states.includes(st)) return st;
  return 'scheduled';
}

/** A campaign's items grouped into its five steps. Each step can hold one item per channel format. */
export function stageGroups(materials: Material[]): { stage: Stage; items: Material[] }[] {
  return STAGES.map((stage) => ({ stage, items: materials.filter((m) => m.stage === stage) })).filter((g) => g.items.length);
}

export function CampaignJourney({ campaign, compact = false }: { campaign: Campaign; compact?: boolean }) {
  const { state } = useDemo();
  const groups = stageGroups(state.materials.filter((m) => m.campaignId === campaign.id));
  return (
    <ol className={`grid gap-2 ${compact ? 'grid-cols-5' : 'grid-cols-1 sm:grid-cols-5'}`}>
      {groups.map(({ stage, items }, i) => {
        const ids = new Set(items.map((m) => m.id));
        const pls = state.placements.filter((p) => ids.has(p.materialId));
        const st = materialSummary(pls.map((p) => shownState(state, p)));
        const done = st === 'published';
        return (
          <li key={stage} className={`relative rounded-lg border px-2.5 py-2 ${done ? 'border-brand-olive-200 bg-brand-olive-50' : st === 'failed' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${done ? 'bg-brand-olive-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{done ? <Icon name="check" className="h-3 w-3" /> : i + 1}</span>
              {STAGE_INFO[stage].journey}
            </div>
            {!compact ? <p className="mt-1 text-sm font-medium leading-snug text-slate-900">{items[0].title}</p> : null}
            {!compact ? <p className="mt-0.5 text-xs text-slate-500">{items.length} format{items.length === 1 ? '' : 's'}</p> : null}
            <p className={`mt-1 text-xs ${compact ? 'sr-only sm:not-sr-only' : ''} text-slate-600`}>{SHOWN_LABEL[st]}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function StatePill({ st }: { st: ShownState }) {
  return <Pill tone={STATE_TONE[st]}>{SHOWN_LABEL[st]}</Pill>;
}

export function formatsLine(m: Material) {
  return m.formats.map((f) => FORMATS[f].label).join(' · ');
}

export function DueLine({ date }: { date: string }) {
  const { state } = useDemo();
  return <span>{relDay(date, state.today)}</span>;
}

export function DemoClock({ className = '' }: { className?: string }) {
  const { state, dispatch, toast } = useDemo();
  const c = activeCampaign(state);
  const advance = () => {
    // Work out what the day brings (the reducer is pure), so the toast can say it.
    const next = reducer(state, { type: 'day/advance' });
    const fresh = next.log.filter((l) => !state.log.some((o) => o.id === l.id));
    const arrived = next.enquiries.length - state.enquiries.length;
    dispatch({ type: 'day/advance' });
    const parts = [`It is now ${fmtDay(next.today)} in the demo.`];
    if (fresh.length) parts.push(`${fresh.length} thing${fresh.length === 1 ? '' : 's'} happened: see the campaign.`);
    if (arrived > 0) parts.push(`${arrived} new enquir${arrived === 1 ? 'y' : 'ies'} arrived.`);
    if (!fresh.length && !arrived) parts.push('Nothing was due today.');
    toast(parts.join(' '), next.placements.some((p) => p.state === 'failed' && !state.placements.some((o) => o.id === p.id && o.state === 'failed')) ? 'warn' : 'info');
  };
  return (
    <div className={`rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm ${className}`}>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><Icon name="calendar" className="h-4 w-4" /> Demo date</p>
      <p className="mt-0.5 font-medium text-slate-900">{fmtDay(state.today)}</p>
      <p className="mt-1 text-xs text-slate-500">{c?.scheduled ? 'Move time forward to see what would happen next.' : 'Time only matters once a campaign is scheduled.'}</p>
      <button type="button" onClick={advance} className="btn btn-secondary btn-sm mt-2 w-full !normal-case !tracking-normal !text-sm">
        <Icon name="forward" className="h-4 w-4" /> Move forward a day
      </button>
    </div>
  );
}

/**
 * How a format goes out, said the same way on the plan, approvals and schedule. It depends on the
 * format (reels and statuses are always shared by hand) and on the channel's demo connection.
 */
export function automation(conn: DemoConnection | undefined, f: FormatId): { label: string; short: string; tone: 'olive' | 'violet' | 'amber' } {
  const info = FORMATS[f];
  if (!info.auto) return { label: 'You share it yourself. A share pack with the words and picture will be ready.', short: 'You share it', tone: 'violet' };
  const name = channelById(info.channel).name;
  if (f === 'ad' && conn === 'connected') return { label: 'Runs for you once you approve both the ad and its spending. The ad account is connected in the demo.', short: 'Posted for you', tone: 'olive' };
  if (conn === 'connected') return { label: `Posted for you in the demo, because ${name} is connected.`, short: 'Posted for you', tone: 'olive' };
  return { label: `Posted for you once ${name} is ${conn === 'expired' ? 'reconnected' : 'connected'}. Until then it would fail.`, short: conn === 'expired' ? 'Needs reconnecting' : 'Needs connecting', tone: 'amber' };
}

export function AutoPill({ f }: { f: FormatId }) {
  const { state } = useDemo();
  const a = automation(state.connections[FORMATS[f].channel], f);
  return <span title={a.label}><Pill tone={a.tone}>{a.tone === 'violet' ? <Icon name="send" className="h-3 w-3" /> : null}{a.short}</Pill></span>;
}

/** Everything the owner approves before paid ads run, shown beside the ad itself. */
export function AdSettings({ campaign }: { campaign: Campaign }) {
  const { state, dispatch, toast } = useDemo();
  const ad = state.materials.find((m) => m.campaignId === campaign.id && m.formats[0] === 'ad');
  if (!ad || campaign.plan.adDaily <= 0) return null;
  const p = campaign.plan;
  const total = r2(p.adDaily * p.days);
  const contentOk = ad.status === 'approved';
  const live = campaign.status === 'active';
  const rows: [string, React.ReactNode][] = [
    ['Who sees it', p.audience],
    ['Where', `${state.business.areas || 'Your delivery area'} only`],
    ['Dates', `${fmtDay(ad.date)} to ${fmtDay(campaign.endDate)} (up to ${p.days} days)`],
    ['Daily amount', `${money(p.adDaily)} a day`],
    ['Total limit', `${money(total)}. It never spends more than this.`],
    ['Where a tap goes', `A WhatsApp chat with ${state.business.name || 'your shop'} ("Send message" button)`],
  ];
  return (
    <div className="card space-y-3" aria-label="Paid ad settings">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl">Paid ad settings</h2>
        {campaign.adApproved ? <Pill tone="olive"><Icon name="check" className="h-3.5 w-3.5" /> Spending approved</Pill> : <Pill tone="amber">Spending not approved</Pill>}
      </div>
      <dl className="divide-y divide-slate-100 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900">{v}</dd></div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">Approving the ad&apos;s words and picture does not start spending. Paid ads need this second approval. Pretend spending only: no money is spent in the prototype.</p>
      {live ? (
        campaign.adApproved ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { dispatch({ type: 'campaign/approveAds', id: campaign.id, approved: false }); toast('Paid ads stopped. No more ad spending.', 'info'); }}>Stop paid ads</button>
        ) : (
          <div className="space-y-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={!contentOk} onClick={() => { dispatch({ type: 'campaign/approveAds', id: campaign.id, approved: true }); toast(`Paid ads approved: up to ${money(p.adDaily)} a day, ${money(total)} in total.`); }}>
              Approve paid ads, up to {money(total)}
            </button>
            {!contentOk ? <p className="text-xs text-amber-800">Approve the ad&apos;s content first. Then approve the spending.</p> : null}
          </div>
        )
      ) : null}
    </div>
  );
}
