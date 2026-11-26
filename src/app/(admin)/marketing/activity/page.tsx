'use client';
// ZP-1200: the audit log: who changed what.
import React, { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { mk } from '@/components/marketing/api';
import { ErrorNote, Loading } from '@/components/marketing/parts';

interface Entry { id: number; actor: string; action: string; entity: string; entityId: number | null; detail: unknown; createdAt: string }

export default function ActivityPage() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mk<{ entries: Entry[] }>('/api/marketing/audit?limit=100').then((d) => setRows(d.entries)).catch((e) => setError(e.message));
  }, []);
  if (!rows) return error ? <ErrorNote message={error} /> : <Loading />;
  if (rows.length === 0) return <EmptyState icon="🗒️" title="No activity yet" description="Every change in Marketing is written down here." />;
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" data-testid="activity-list">
      {rows.map((r) => (
        <li key={r.id} className="p-3 text-sm">
          <p><strong>{r.actor}</strong> <span className="text-slate-700">{r.action}</span> <span className="text-slate-500">{r.entity}{r.entityId ? ` #${r.entityId}` : ''}</span></p>
          <p className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</p>
          {r.detail ? <p className="mt-1 break-words text-xs text-slate-500">{JSON.stringify(r.detail)}</p> : null}
        </li>
      ))}
    </ul>
  );
}
