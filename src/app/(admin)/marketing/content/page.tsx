'use client';
// ZP-1200: all content ideas.
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { mk, type Content } from '@/components/marketing/api';
import { ErrorNote, Loading, StatusPill } from '@/components/marketing/parts';
import { channelLabel } from '@/lib/marketing/ui';

export default function ContentListPage() {
  const [items, setItems] = useState<Content[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mk<{ content: Content[] }>('/api/marketing/content').then((d) => setItems(d.content)).catch((e) => setError(e.message));
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Link href="/marketing/content/new" className="btn btn-primary" data-testid="new-content">New content</Link></div>
      <ErrorNote message={error} />
      {!items && !error ? <Loading /> : null}
      {items && items.length === 0 ? <EmptyState icon="✍️" title="No content yet" description="Pick a product and write what you want to say." action={<Link href="/marketing/content/new" className="btn btn-primary">New content</Link>} /> : null}
      <ul className="space-y-3">
        {items?.map((c) => (
          <li key={c.id}>
            <Link href={`/marketing/content/${c.id}`} className="card block">
              <p className="font-semibold text-slate-900">{c.title}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {(c.posts ?? []).map((p) => (
                  <li key={p.id} className="flex items-center gap-1 text-xs text-slate-600">{channelLabel(p.channelKind)} <StatusPill status={p.status} /></li>
                ))}
              </ul>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
