'use client';
// ZP-1200: the approval queue: every post waiting for the owner, across all content.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/Toast';
import { mk, type Content, type Post } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';
import { charCount, channelLabel } from '@/lib/marketing/ui';
import { getChannel } from '@/lib/marketing/channels';

export default function ApprovalsPage() {
  const toast = useToast();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([mk<{ posts: Post[] }>('/api/marketing/posts?status=PENDING_APPROVAL'), mk<{ content: Content[] }>('/api/marketing/content')]);
      setPosts(p.posts);
      setTitles(Object.fromEntries(c.content.map((x) => [x.id, x.title])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const move = async (ids: number[], action: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    let failed = 0;
    for (const id of ids) {
      try {
        await mk(`/api/marketing/posts/${id}/transition`, { method: 'POST', body: { action } });
      } catch (e) {
        failed++;
        setError(e instanceof Error ? e.message : 'That did not work.');
      }
    }
    if (failed < ids.length) toast.success(action === 'approve' ? 'Approved.' : 'Rejected.');
    await load();
    setBusy(false);
  };

  const groups = useMemo(() => {
    const m = new Map<number, Post[]>();
    for (const p of posts ?? []) m.set(p.contentId, [...(m.get(p.contentId) ?? []), p]);
    return [...m.entries()];
  }, [posts]);

  if (!posts) return error ? <ErrorNote message={error} /> : <Loading />;
  if (posts.length === 0) return <EmptyState icon="✅" title="Nothing waiting" description="Posts you submit for approval show up here." />;

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      {groups.map(([contentId, list]) => (
        <Card key={contentId} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">{titles[contentId] ?? `Content ${contentId}`}</h2>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => move(list.map((p) => p.id), 'approve')} data-testid={`approve-all-${contentId}`}>Approve all for this content ({list.length})</button>
          </div>
          <ul className="space-y-4">
            {list.map((p) => {
              const max = getChannel(p.channelKind)?.limits.maxText ?? 0;
              return (
                <li key={p.id} className="rounded-lg border border-slate-200 p-3 space-y-2" data-testid={`approval-${p.id}`}>
                  <p className="text-sm font-medium">{channelLabel(p.channelKind)} <span className="text-xs font-normal text-slate-500">{charCount(p.text, max).count} of {max} characters</span></p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{p.text}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => move([p.id], 'approve')} data-testid={`approve-${p.id}`}>Approve</button>
                    <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => move([p.id], 'reject')} data-testid={`reject-${p.id}`}>Reject</button>
                    <Link href={`/marketing/content/${contentId}#post-${p.id}`} className="btn btn-secondary btn-sm">Edit</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
