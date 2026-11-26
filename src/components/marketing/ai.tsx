'use client';
// ZP-1200: AI pieces of the Marketing screens: write with AI, worth promoting, plan my week.
import React, { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import {
  channelLabel, draftSummary, groupPlanByDay, newContentHref, planApplyBody, planResultText,
  type DraftOutcomeDto, type PlanItemDto, type PlanResultDto,
} from '@/lib/marketing/ui';
import { mk, type PickerProduct, type Post } from './api';
import { Card, ErrorNote } from './parts';

export type DraftOutcome = DraftOutcomeDto & { posts: Post[] };

/** Ask the AI to write the draft posts of a content idea (all, or only `channels`). Throws with the server's plain message. */
export const writeWithAi = (contentId: number, channels?: string[]) =>
  mk<DraftOutcome>(`/api/marketing/content/${contentId}/draft`, { method: 'POST', body: channels ? { channels } : {} });

/** What the AI did: a sentence, the per-channel failures and the cost. */
export function DraftReport({ outcome, onClose }: { outcome: DraftOutcome; onClose?: () => void }) {
  const s = draftSummary(outcome);
  return (
    <div className="rounded-lg border border-brand-olive-200 bg-brand-olive-50 px-4 py-3 text-sm space-y-1" role="status" data-testid="draft-report">
      <p className="text-slate-900">{s.message}</p>
      {s.failures.length > 0 ? (
        <ul className="list-disc pl-5 text-rose-700" data-testid="draft-failures">
          {s.failures.map((f) => <li key={f}>{f}</li>)}
        </ul>
      ) : null}
      {s.cost ? <p className="text-slate-600" data-testid="draft-cost">{s.cost}</p> : null}
      {onClose ? <button type="button" className="text-xs text-slate-500 underline" onClick={onClose}>Dismiss</button> : null}
    </div>
  );
}

export function AiTag() {
  return <span className="text-xs rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-700" data-testid="ai-tag">AI wrote this</span>;
}

interface Suggestion { productId: number; name: string; reason: string }

/** "Worth promoting this week": products ranked from the shop's own data. */
export function SuggestionsPanel({ limit = 4 }: { limit?: number }) {
  const [items, setItems] = useState<(Suggestion & { photo: string | null })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const s = await mk<{ suggestions: Suggestion[] }>(`/api/marketing/suggestions?limit=${limit}`);
      const ids = s.suggestions.map((x) => x.productId);
      const photos = new Map<number, string>();
      if (ids.length > 0) {
        const p = await mk<{ products: PickerProduct[] }>(`/api/marketing/products?ids=${ids.join(',')}`).catch(() => ({ products: [] as PickerProduct[] }));
        for (const x of p.products) if (x.photos[0]) photos.set(x.id, x.photos[0].url);
      }
      if (live) setItems(s.suggestions.map((x) => ({ ...x, photo: photos.get(x.productId) ?? null })));
    })().catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load suggestions.'));
    return () => { live = false; };
  }, [limit]);

  return (
    <Card>
      <h2 className="font-serif text-xl font-semibold text-slate-900 mb-3">Worth promoting this week</h2>
      <ErrorNote message={error} />
      {!items && !error ? <p className="text-sm text-slate-500" role="status">Looking at your products…</p> : null}
      {items && items.length === 0 ? <p className="text-sm text-slate-500" data-testid="suggestions-empty">Nothing stands out yet. Publish some products and check back.</p> : null}
      {items && items.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="suggestions">
          {items.map((s) => (
            <li key={s.productId} className="flex gap-3 rounded-lg border border-slate-200 p-3" data-testid={`suggestion-${s.productId}`}>
              {s.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- private same-origin picture
                <img src={s.photo} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
              ) : <span className="h-16 w-16 shrink-0 rounded bg-slate-100" />}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 truncate">{s.name}</p>
                <p className="text-xs text-slate-500">{s.reason}</p>
                {/* A full page load so the new-content screen always reads the product from the link. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href={newContentHref(s.productId)} className="btn btn-secondary btn-sm mt-2 inline-flex" data-testid={`make-post-${s.productId}`}>Make a post</a>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

interface PlanDto { weekStart: string; items: PlanItemDto[]; unplaced: number[] }
const dayName = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** "Plan my week": propose, let the owner untick, then schedule. */
export function PlanMyWeek({ onApplied }: { onApplied?: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState<PlanDto | null>(null);
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<PlanResultDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propose = async () => {
    setBusy(true); setError(null); setResults(null); setUnticked(new Set());
    try {
      const now = new Date();
      const d = await mk<{ plan: PlanDto }>('/api/marketing/plan', { method: 'POST', body: { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() } });
      setPlan(d.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not plan the week.');
    } finally { setBusy(false); }
  };

  const apply = async () => {
    if (!plan) return;
    const items = planApplyBody(plan.items, unticked);
    if (items.length === 0) { setError('Tick at least one post.'); return; }
    setBusy(true); setError(null);
    try {
      const d = await mk<{ results: PlanResultDto[] }>('/api/marketing/plan/apply', { method: 'POST', body: { items } });
      setResults(d.results);
      setPlan(null);
      toast.success('Plan applied.');
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not schedule these.');
    } finally { setBusy(false); }
  };

  const toggle = (id: number) => setUnticked((u) => { const n = new Set(u); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const days = plan ? groupPlanByDay(plan.items) : [];
  const ticked = plan ? plan.items.filter((i) => !unticked.has(i.postId)).length : 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-slate-900">Plan my week</h2>
          <p className="text-sm text-slate-500">Spreads your approved posts over the next 7 days at good times. Nothing is saved until you press &quot;Schedule these&quot;.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={propose} disabled={busy} data-testid="plan-my-week">{busy && !plan ? 'Planning…' : 'Plan my week'}</button>
      </div>
      <div className="mt-3"><ErrorNote message={error} /></div>

      {plan && plan.items.length === 0 ? <p className="mt-3 text-sm text-slate-600" data-testid="plan-empty">There are no approved posts waiting to be scheduled. Approve some posts first.</p> : null}
      {plan && plan.items.length > 0 ? (
        <div className="mt-4 space-y-4" data-testid="plan-proposal">
          {days.map((g) => (
            <div key={g.key}>
              <p className="text-sm font-medium text-slate-700">{dayName(g.date)}</p>
              <ul className="mt-1 space-y-1">
                {g.items.map((i) => (
                  <li key={i.postId}>
                    <label className="flex items-center gap-3 min-h-10 text-sm cursor-pointer">
                      <input type="checkbox" className="h-5 w-5" checked={!unticked.has(i.postId)} onChange={() => toggle(i.postId)} data-testid={`plan-item-${i.postId}`} />
                      <span className="font-medium">{channelLabel(i.channelKind)}</span>
                      {i.mode === 'api' && i.scheduledFor ? <span className="text-slate-500">at {timeOf(i.scheduledFor)}</span> : <span className="text-slate-500">suggested day (you post it by hand)</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {plan.unplaced.length > 0 ? <p className="text-xs text-slate-500">{plan.unplaced.length} post{plan.unplaced.length === 1 ? '' : 's'} did not fit this week (your weekly target is reached).</p> : null}
          <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || ticked === 0} data-testid="plan-apply">{busy ? 'Scheduling…' : `Schedule these (${ticked})`}</button>
        </div>
      ) : null}

      {results ? (
        <ul className="mt-4 space-y-1 text-sm" data-testid="plan-results">
          {results.map((r) => (
            <li key={r.postId} className={r.result === 'failed' ? 'text-rose-700' : 'text-slate-700'}>Post {r.postId}: {planResultText(r)}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

