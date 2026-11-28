'use client';
// ZP-1200: campaigns: list and create.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { mk, type Campaign } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';

const OBJECTIVE_LABELS: Record<string, string> = { AWARENESS: 'Get seen', VISITS: 'Get visits to the website', ENQUIRIES: 'Get enquiries' };

export default function CampaignsPage() {
  const router = useRouter();
  // ZP-1124: archived campaigns are kept for the record and listed on their own (?archived=1).
  const [archived, setArchived] = useState<boolean | null>(null);
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('AWARENESS');
  const [busy, setBusy] = useState(false);

  const load = useCallback((on: boolean) => {
    mk<{ campaigns: Campaign[] }>(on ? '/api/marketing/campaigns?status=ARCHIVED' : '/api/marketing/campaigns')
      .then((d) => {
        setArchived(on);
        setItems(d.campaigns);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load(new URLSearchParams(window.location.search).get('archived') === '1');
  }, [load]);
  const showArchived = (on: boolean) => {
    window.history.replaceState(null, '', on ? '/marketing/campaigns?archived=1' : '/marketing/campaigns');
    setItems(null);
    load(on);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await mk<{ campaign: Campaign }>('/api/marketing/campaigns', { method: 'POST', body: { name, objective } });
      router.push(`/marketing/campaigns/${d.campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create.');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      {archived ? (
        <p className="text-sm text-slate-600" data-testid="campaigns-archived-heading">Archived campaigns, kept for the record. <button type="button" className="link" onClick={() => showArchived(false)}>Back to campaigns</button></p>
      ) : (
      <Card>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <label className="label" htmlFor="camp-name">New campaign</label>
            <input id="camp-name" className="input" placeholder="For example: Back to school" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required data-testid="campaign-name" />
          </div>
          <div>
            <label className="label" htmlFor="camp-obj">Aim</label>
            <select id="camp-obj" className="select" value={objective} onChange={(e) => setObjective(e.target.value)}>
              {Object.entries(OBJECTIVE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || name.trim() === ''} data-testid="campaign-create">Create</button>
        </form>
      </Card>
      )}
      {!items && !error ? <Loading /> : null}
      {items && items.length === 0 ? (archived ? <p className="text-sm text-slate-500">No archived campaigns.</p> : <EmptyState icon="🎯" title="No campaigns yet" description="A campaign groups products and posts around one goal." />) : null}
      <ul className="space-y-3">
        {items?.map((c) => (
          <li key={c.id}>
            <Link href={`/marketing/campaigns/${c.id}`} className="card flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{c.name}</span>
              <span className="text-sm text-slate-500">{OBJECTIVE_LABELS[c.objective] ?? c.objective} · {c.status.toLowerCase()} · {c.productIds.length} product{c.productIds.length === 1 ? '' : 's'}</span>
            </Link>
          </li>
        ))}
      </ul>
      {archived === false ? <p className="text-sm"><button type="button" className="link" onClick={() => showArchived(true)} data-testid="campaigns-show-archived">Show archived campaigns</button></p> : null}
    </div>
  );
}
