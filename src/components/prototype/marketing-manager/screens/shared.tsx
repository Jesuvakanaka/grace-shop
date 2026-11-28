'use client';
// Pieces shared by several prototype screens.
import React from 'react';
import { FORMATS } from '../catalog';
import { fmtDay, relDay } from '../dates';
import { SHOWN_LABEL, activeCampaign, reducer, shownState, type ShownState } from '../engine';
import { STAGE_INFO } from '../plan';
import { useDemo } from '../store';
import type { Campaign, Material } from '../types';
import { Icon, Pill, STATE_TONE } from '../ui';

/** One material's overall state, from its placements. */
export function materialSummary(states: ShownState[]): ShownState {
  const order: ShownState[] = ['failed', 'awaiting', 'manual', 'paused', 'ready', 'scheduled', 'published'];
  for (const st of order) if (states.includes(st)) return st;
  return 'scheduled';
}

export function CampaignJourney({ campaign, compact = false }: { campaign: Campaign; compact?: boolean }) {
  const { state } = useDemo();
  const mats = state.materials.filter((m) => m.campaignId === campaign.id);
  return (
    <ol className={`grid gap-2 ${compact ? 'grid-cols-5' : 'grid-cols-1 sm:grid-cols-5'}`}>
      {mats.map((m, i) => {
        const pls = state.placements.filter((p) => p.materialId === m.id);
        const st = materialSummary(pls.map((p) => shownState(state, p)));
        const done = st === 'published';
        return (
          <li key={m.id} className={`relative rounded-lg border px-2.5 py-2 ${done ? 'border-brand-olive-200 bg-brand-olive-50' : st === 'failed' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${done ? 'bg-brand-olive-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{done ? <Icon name="check" className="h-3 w-3" /> : i + 1}</span>
              {STAGE_INFO[m.stage].journey}
            </div>
            {!compact ? <p className="mt-1 text-sm font-medium leading-snug text-slate-900">{m.title}</p> : null}
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
