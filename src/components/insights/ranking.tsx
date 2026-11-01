'use client';
// ZP-506: popularity ranking on the Insights page: the ranking status note,
// the "why it ranks there" breakdown of a look's score, and the one-click
// "Use as first photo" for a suggested cover (reuses the gallery reorder API).
import React, { useState } from 'react';
import { coverFirstOrder } from '@/lib/ranking/featured';
import { SCORE_WEIGHTS } from '@/lib/ranking/score';
import type { LookRow, RankingStatus } from '@/lib/insights/types';
import { fmt } from './parts';

const times = (i: number) => `×${i.toFixed(2)}`;

export function RankingNote({ status }: { status: RankingStatus | null | undefined }) {
  let text: string;
  if (!status) text = 'Score: not calculated yet. The nightly job ranks the looks after the analytics rollup.';
  else if (status.mode === 'NEWEST') text = 'The feed is set to “Newest first” (Website settings). Scores are still calculated every night.';
  else if (!status.ranked) text = 'Too few views in the last 28 days to rank yet: the feed shows the newest looks first for now.';
  else text = 'The feed is ranked by Score every night; the top 6 are Featured automatically.';
  return (
    <p className="mb-3 text-sm text-slate-600" data-testid="ranking-note">
      {text}
      {status ? <span className="text-slate-500"> Last calculated {new Date(status.computedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.</span> : null}{' '}
      Score: 100 = an average look, from the last 28 days (recent days count more), not the range above.
    </p>
  );
}

/** "Why it ranks there": the parts of one look's score. */
export function ScoreBreakdown({ row }: { row: LookRow }) {
  const p = row.scoreParts;
  if (!p) return <p className="text-sm text-slate-500">Not scored yet (it was not on the website at the last nightly run).</p>;
  const s = p.signals;
  const items: { label: string; weight: number; index: number; detail: string }[] = [
    { label: 'Attention', weight: SCORE_WEIGHTS.attention, index: p.attention, detail: `mean dwell ${fmt.secs(s.dwell.raw)}` },
    {
      label: 'Curiosity',
      weight: SCORE_WEIGHTS.curiosity,
      index: p.curiosity,
      detail: `swiped ${fmt.pct(s.photoSwipe.raw)}, details ${fmt.pct(s.details.raw)}, opened ${fmt.pct(s.open.raw)} per view`,
    },
    {
      label: 'Intent',
      weight: SCORE_WEIGHTS.intent,
      index: p.intent,
      detail: `WhatsApp ${fmt.pct(s.enquiries.raw)}, restock ${fmt.pct(s.restocks.raw)}, shares ${fmt.pct(s.shares.raw)}, hearts ${fmt.pct(s.loves.raw)} per view${s.stars.raw !== null ? `, ${fmt.dec(s.stars.raw)}★ reviews` : ''}`,
    },
  ];
  return (
    <div className="text-sm text-slate-700 space-y-1" data-testid="score-parts">
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.label}>
            <span className="font-medium">{i.label}</span> {times(i.index)} <span className="text-slate-500">({Math.round(i.weight * 100)}%)</span>
            <span className="text-slate-500"> – {i.detail}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        ×1.00 = the catalogue average. {Math.round(p.evidence * 100)}% from its own numbers, the rest from the average (fewer than 50 recent views
        counts less).
        {row.rank ? ` #${row.rank} in today's feed.` : ''}
        {row.coldStart ? ' New piece: boosted for its first week.' : ''}
        {row.autoFeatured ? ' Featured automatically.' : ''}
      </p>
    </div>
  );
}

/** One-click "Use as first photo": GET the gallery, move the photo to the front, PUT the order. */
export function UseAsCoverButton({ productId, imageId, index }: { productId: number; imageId: number; index: number }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const run = async () => {
    setState('busy');
    try {
      const res = await fetch(`/api/website/products/${productId}`);
      const product = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(product.error || 'Could not load the photos');
      const order = coverFirstOrder(
        (product.images as { id: number }[]).map((i) => i.id),
        imageId,
      );
      if (!order) throw new Error('That photo is no longer in the gallery');
      const put = await fetch(`/api/website/products/${productId}/images`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      const body = await put.json().catch(() => ({}));
      if (!put.ok) throw new Error(body.error || 'Could not reorder the photos');
      setState('done');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong');
      setState('error');
    }
  };
  if (state === 'done') {
    return (
      <span className="ml-1 font-medium" role="status" data-testid="use-cover-done">
        Done: photo {index} is now the first photo.
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        className="ml-1 underline font-medium disabled:opacity-60"
        onClick={run}
        disabled={state === 'busy'}
        data-testid="use-cover"
      >
        {state === 'busy' ? 'Saving…' : 'Use as first photo'}
      </button>
      {state === 'error' ? (
        <span className="block text-rose-700" role="alert">
          {message}
        </span>
      ) : null}
    </>
  );
}
