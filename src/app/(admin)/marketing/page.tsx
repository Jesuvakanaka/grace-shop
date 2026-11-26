'use client';
// ZP-1200: Marketing overview: is live posting on, what is waiting, this week's posts, share bundles ready.
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, ErrorNote, Loading, StatusPill, useHubStatus } from '@/components/marketing/parts';
import { mk, type Post } from '@/components/marketing/api';
import { PlanMyWeek, SuggestionsPanel } from '@/components/marketing/ai';
import { channelLabel, liveBlockers, publishedThisWeek, shareBundlesReady, weekBuckets } from '@/lib/marketing/ui';

const dayName = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');

export default function MarketingOverviewPage() {
  const { status } = useHubStatus();
  const [pending, setPending] = useState<Post[]>([]);
  const [approved, setApproved] = useState<Post[]>([]);
  const [scheduled, setScheduled] = useState<Post[]>([]);
  const [week, setWeek] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [now] = useState(() => new Date());

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();
    Promise.all([
      mk<{ posts: Post[] }>('/api/marketing/posts?status=PENDING_APPROVAL'),
      mk<{ posts: Post[] }>('/api/marketing/posts?status=APPROVED'),
      mk<{ posts: Post[] }>('/api/marketing/posts?status=SCHEDULED'),
      mk<{ posts: Post[] }>(`/api/marketing/posts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    ])
      .then(([a, b, c, d]) => {
        setPending(a.posts);
        setApproved(b.posts);
        setScheduled(c.posts);
        setWeek(d.posts);
        setReady(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [now, reloadKey]);

  const blockers = status ? liveBlockers(status.live) : [];
  const days = useMemo(() => weekBuckets(week, new Date(now.getFullYear(), now.getMonth(), now.getDate()), 7), [week, now]);
  const bundles = useMemo(() => shareBundlesReady(approved), [approved]);
  const sentThisWeek = publishedThisWeek(week, now);

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      {status ? (
        <div
          className={`rounded-xl border px-4 py-4 ${blockers.length === 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}
          data-testid="live-banner"
        >
          <p className="font-semibold text-slate-900">
            {blockers.length === 0 ? 'Live posting is ON. Approved posts can go out.' : 'Live posting is OFF. Nothing is posted or sent from here yet.'}
          </p>
          {blockers.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-600 space-y-1">
              {blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          ) : null}
          <p className="mt-2 text-sm text-slate-500">You can still write, approve and prepare posts. Channels you post to by hand always work.</p>
        </div>
      ) : null}

      {!ready && !error ? <Loading /> : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="marketing-counts">
        <Link href="/marketing/approvals" className="card block" data-testid="count-pending"><p className="text-sm text-slate-500">Waiting for approval</p><p className="text-3xl font-semibold text-slate-900">{pending.length}</p></Link>
        <div className="card" data-testid="count-scheduled"><p className="text-sm text-slate-500">Scheduled</p><p className="text-3xl font-semibold text-slate-900">{scheduled.length}</p></div>
        <div className="card" data-testid="count-published"><p className="text-sm text-slate-500">Published this week</p><p className="text-3xl font-semibold text-slate-900">{sentThisWeek}</p></div>
      </div>

      <PlanMyWeek onApplied={() => setReloadKey((k) => k + 1)} />

      <SuggestionsPanel />

      <Card>
        <h2 className="font-serif text-xl font-semibold text-slate-900 mb-3">Share bundles ready</h2>
        {bundles.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing is waiting for you to post by hand.</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="bundles-ready">
            {bundles.map((p) => (
              <li key={p.id}>
                <Link href={`/marketing/content/${p.contentId}#post-${p.id}`} className="flex items-center justify-between gap-3 py-3 min-h-12">
                  <span className="text-sm"><strong>{channelLabel(p.channelKind)}</strong> <span className="text-slate-500">{p.text.slice(0, 60)}</span></span>
                  <span className="text-sm text-brand-olive-700 shrink-0">Open</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="font-serif text-xl font-semibold text-slate-900 mb-3">This week</h2>
        <ul className="space-y-3" data-testid="week-list">
          {days.map((d) => (
            <li key={d.key}>
              <p className="text-sm font-medium text-slate-700">{dayName(d.date)}</p>
              {d.posts.length === 0 ? (
                <p className="text-sm text-slate-400">Nothing planned</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {d.posts.map((p) => (
                    <li key={p.id}>
                      <Link href={`/marketing/content/${p.contentId}#post-${p.id}`} className="flex flex-wrap items-center gap-2 text-sm min-h-10">
                        <span className="text-slate-500">{timeOf(p.status === 'PUBLISHED' || p.status === 'SHARED' ? p.publishedAt : p.scheduledFor)}</span>
                        <span>{channelLabel(p.channelKind)}</span>
                        <StatusPill status={p.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link href="/marketing/content/new" className="btn btn-primary">New content</Link>
        <Link href="/marketing/campaigns" className="btn btn-secondary">Campaigns</Link>
        <Link href="/marketing/approvals" className="btn btn-secondary">Approvals</Link>
        <Link href="/marketing/channels" className="btn btn-secondary">Channels</Link>
        <Link href="/marketing/settings" className="btn btn-secondary">Settings</Link>
      </div>
    </div>
  );
}
