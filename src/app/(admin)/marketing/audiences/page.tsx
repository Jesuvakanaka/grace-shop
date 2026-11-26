'use client';
// ZP-1200: ad audiences: a simple list and form (area around Harare, ages, who).
import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { mk } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';

interface Targeting { geo?: { radiusKm: number }; ageMin?: number; ageMax?: number; genders?: string[] }
interface Audience { id: number; name: string; description: string | null; kind: string; targeting: Targeting | null }

const who = (g: string[] | undefined) => (!g || g.length !== 1 ? 'Everyone' : g[0] === 'FEMALE' ? 'Women' : 'Men');

export default function AudiencesPage() {
  const [items, setItems] = useState<Audience[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', description: '', radiusKm: '25', ageMin: '18', ageMax: '65', gender: 'ALL' });

  const load = useCallback(() => {
    mk<{ audiences: Audience[] }>('/api/marketing/audiences')
      .then((d) => setItems(d.audiences.filter((a) => a.kind === 'AD_TARGETING')))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load audiences.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await mk('/api/marketing/audiences', {
        method: 'POST',
        body: {
          name: f.name, description: f.description.trim() || null, kind: 'AD_TARGETING',
          targeting: { geo: { radiusKm: Number(f.radiusKm) }, ageMin: Number(f.ageMin), ageMax: Number(f.ageMax), genders: f.gender === 'ALL' ? [] : [f.gender] },
        },
      });
      setF({ ...f, name: '', description: '' });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    setBusy(false);
  };
  const remove = async (a: Audience) => {
    if (!window.confirm(`Delete the audience "${a.name}"? Ads that use it keep running without it.`)) return;
    setError(null);
    try { await mk(`/api/marketing/audiences/${a.id}`, { method: 'DELETE' }); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete.'); }
  };

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      <Card>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2" data-testid="audience-form">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="aud-name">New audience</label>
            <input id="aud-name" className="input" placeholder="For example: Mums in Harare" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} required data-testid="audience-name" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="aud-desc">Note (optional)</label>
            <input id="aud-desc" className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} />
          </div>
          <div>
            <label className="label" htmlFor="aud-radius">Distance from Harare centre (km)</label>
            <input id="aud-radius" className="input" type="number" min={1} max={80} value={f.radiusKm} onChange={(e) => setF({ ...f, radiusKm: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="aud-gender">Who</label>
            <select id="aud-gender" className="select" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
              <option value="ALL">Everyone</option><option value="FEMALE">Women</option><option value="MALE">Men</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="aud-min">Youngest age</label>
            <input id="aud-min" className="input" type="number" min={13} max={65} value={f.ageMin} onChange={(e) => setF({ ...f, ageMin: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="aud-max">Oldest age</label>
            <input id="aud-max" className="input" type="number" min={13} max={65} value={f.ageMax} onChange={(e) => setF({ ...f, ageMax: e.target.value })} required />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={busy || f.name.trim() === ''} data-testid="audience-create">Save audience</button>
          </div>
        </form>
      </Card>
      {!items && !error ? <Loading /> : null}
      {items && items.length === 0 ? <EmptyState icon="👥" title="No audiences yet" description="An audience says who should see an ad. Without one, ads use Harare, 25 km, ages 18 to 65." /> : null}
      <ul className="space-y-3" data-testid="audience-list">
        {items?.map((a) => (
          <li key={a.id} className="card flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-900">{a.name}</p>
              <p className="text-sm text-slate-500">{who(a.targeting?.genders)}, ages {a.targeting?.ageMin ?? 18} to {a.targeting?.ageMax ?? 65}, within {a.targeting?.geo?.radiusKm ?? 25} km of Harare{a.description ? ` · ${a.description}` : ''}</p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => remove(a)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
