'use client';
// ZP-1200: Meta and Google ads. Make a draft from a content idea, approve it, create it on the platform (paused), start, pause.
// Money safety is enforced by the server (go-live gate and monthly cap); this page only shows its plain messages.
import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { mk, type ChannelItem, type Content } from '@/components/marketing/api';
import { Card, ErrorNote, Loading, useHubStatus } from '@/components/marketing/parts';
import { AD_OBJECTIVE_LABELS, AD_PLATFORM_NAMES, AD_STATUS_CLASSES, adBlockNote, adStatusLabel, adButtons, capPercent, usd } from '@/lib/marketing/ui';

interface Ad {
  id: number; channelKind: string; contentId: number | null; audienceId: number | null; objective: string; headline: string; primaryText: string;
  dailyBudgetCents: number; startsAt: string; endsAt: string | null; status: string; spendCents: number; error: string | null;
  approvedBy: string | null; lastSyncedAt: string | null;
}
interface Audience { id: number; name: string; kind: string }
interface Budget { month: string; capCents: number; committedCents: number; remainingCents: number; recordedSpendCents: number }

const today = () => new Date().toISOString().slice(0, 10);
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString() : 'no end date');

export default function AdsPage() {
  const { status: hub } = useHubStatus();
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [content, setContent] = useState<Content[]>([]);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [pickedPlatform, setPickedPlatform] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [f, setF] = useState({ contentId: '', audienceId: '', objective: 'TRAFFIC', headline: '', primaryText: '', budget: '5', startsAt: today(), endsAt: '' });

  const load = useCallback(() => {
    mk<{ ads: Ad[] }>('/api/marketing/ads').then((d) => setAds(d.ads)).catch((e) => setError(e instanceof Error ? e.message : 'Could not load ads.'));
    mk<{ budget: Budget }>('/api/marketing/budget').then((d) => setBudget(d.budget)).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    mk<{ content: Content[] }>('/api/marketing/content').then((d) => setContent(d.content)).catch(() => undefined);
    mk<{ channels: ChannelItem[] }>('/api/marketing/channels').then((d) => setConnected(d.channels.filter((c) => (c.kind === 'META_ADS' || c.kind === 'GOOGLE_ADS') && c.effectiveStatus === 'CONNECTED').map((c) => c.kind))).catch(() => undefined);
    mk<{ audiences: Audience[] }>('/api/marketing/audiences').then((d) => setAudiences(d.audiences.filter((a) => a.kind === 'AD_TARGETING'))).catch(() => undefined);
  }, [load]);

  const pickContent = (id: string) => {
    const c = content.find((x) => String(x.id) === id);
    setF((p) => ({ ...p, contentId: id, headline: p.headline || (c?.title ?? '').slice(0, 80), primaryText: p.primaryText || (c?.brief ?? '').slice(0, 500) }));
  };

  // Meta by default; the owner can choose Google only when it is connected (and Meta too, or Meta is not).
  const bothConnected = connected.includes('META_ADS') && connected.includes('GOOGLE_ADS');
  const platform = bothConnected && pickedPlatform ? pickedPlatform : connected.includes('GOOGLE_ADS') && !connected.includes('META_ADS') ? 'GOOGLE_ADS' : 'META_ADS';
  const google = platform === 'GOOGLE_ADS';

  const adBody = (headline: string, primaryText: string) => ({
    channelKind: platform,
    contentId: f.contentId ? Number(f.contentId) : null,
    audienceId: f.audienceId ? Number(f.audienceId) : null,
    objective: google ? 'TRAFFIC' : f.objective, headline, primaryText,
    dailyBudgetCents: Math.round(Number(f.budget) * 100),
    startsAt: new Date(`${f.startsAt}T00:00:00+02:00`).toISOString(),
    ...(f.endsAt ? { endsAt: new Date(`${f.endsAt}T00:00:00+02:00`).toISOString() } : {}),
  });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create'); setError(null); setNote(null);
    try {
      await mk('/api/marketing/ads', { method: 'POST', body: adBody(f.headline, f.primaryText) });
      setF((p) => ({ ...p, headline: '', primaryText: '' }));
      load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not make the ad.'); }
    setBusy(null);
  };

  // Saves a draft from the chosen content idea, then asks the AI to write its headline and words (the existing draft route).
  // The AI never writes prices or numbers; the owner still reads and approves the ad.
  const writeWithAi = async () => {
    const c = content.find((x) => String(x.id) === f.contentId);
    if (!c) return;
    setBusy('ai'); setError(null); setNote(null);
    try {
      const made = await mk<{ ad: { id: number } }>('/api/marketing/ads', { method: 'POST', body: adBody((f.headline || c.title).slice(0, 80), (f.primaryText || c.brief || c.title).slice(0, 500)) });
      await mk(`/api/marketing/ads/${made.ad.id}/draft`, { method: 'POST' });
      setNote('The AI wrote the words and saved the ad as a draft below. Read it before you ask for approval.');
      setF((p) => ({ ...p, headline: '', primaryText: '' }));
    } catch (err) { setError(err instanceof Error ? err.message : 'The AI could not write the ad.'); }
    load();
    setBusy(null);
  };

  const act = async (ad: Ad, action: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(`${ad.id}:${action}`);
    setRowErrors((p) => ({ ...p, [ad.id]: '' }));
    try { await mk(`/api/marketing/ads/${ad.id}/transition`, { method: 'POST', body: { action } }); load(); }
    catch (err) { setRowErrors((p) => ({ ...p, [ad.id]: err instanceof Error ? err.message : 'That did not work.' })); load(); }
    setBusy(null);
  };
  const sync = async (ad: Ad) => {
    setBusy(`${ad.id}:sync`);
    setRowErrors((p) => ({ ...p, [ad.id]: '' }));
    try { await mk(`/api/marketing/ads/${ad.id}/sync`, { method: 'POST' }); load(); }
    catch (err) { setRowErrors((p) => ({ ...p, [ad.id]: err instanceof Error ? err.message : 'Could not update.' })); }
    setBusy(null);
  };

  const block = adBlockNote(hub?.live ?? null, budget?.capCents ?? 0);
  const pct = budget ? capPercent(budget.recordedSpendCents, budget.capCents) : 0;

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      <Card>
        <h2 className="font-semibold text-slate-900">Ad budget this month{budget ? ` (${budget.month})` : ''}</h2>
        {!budget ? <Loading /> : (
          <div className="mt-2 space-y-2" data-testid="ads-budget">
            <p className="text-sm text-slate-700">
              Monthly limit <strong>{usd(budget.capCents)}</strong> · spent so far <strong>{usd(budget.recordedSpendCents)}</strong> · promised to running and approved ads <strong>{usd(budget.committedCents)}</strong> · still free <strong>{usd(budget.remainingCents)}</strong>
            </p>
            <div className="h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Spent of the monthly limit">
              <div className={`h-2 rounded-full ${pct >= 90 ? 'bg-rose-500' : 'bg-brand-olive'}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-slate-500">Ads are always made paused on the platform and only start when you press Start. No ad can pass the monthly limit. Change the limit in Settings.</p>
          </div>
        )}
        {block ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="ads-block-note">{block}</p> : null}
      </Card>

      <Card>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2" data-testid="ad-form">
          <h2 className="sm:col-span-2 font-semibold text-slate-900">New ad</h2>
          {bothConnected ? (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="ad-platform">Where it runs</label>
              <select id="ad-platform" className="select" value={platform} onChange={(e) => setPickedPlatform(e.target.value)} data-testid="ad-platform">
                <option value="META_ADS">Facebook and Instagram (Meta)</option>
                <option value="GOOGLE_ADS">Google search</option>
              </select>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ad-content">Content idea</label>
            <select id="ad-content" className="select" value={f.contentId} onChange={(e) => pickContent(e.target.value)} data-testid="ad-content">
              <option value="">Choose one (its photo is used)</option>
              {content.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ad-aud">Who should see it</label>
            <select id="ad-aud" className="select" value={f.audienceId} onChange={(e) => setF({ ...f, audienceId: e.target.value })}>
              <option value="">Harare, 25 km, ages 18 to 65</option>
              {audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ad-obj">What for</label>
            <select id="ad-obj" className="select" value={google ? 'TRAFFIC' : f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} disabled={google}>
              {Object.entries(AD_OBJECTIVE_LABELS).filter(([k]) => !google || k === 'TRAFFIC').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ad-head">Headline</label>
            <input id="ad-head" className="input" value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} maxLength={80} required data-testid="ad-headline" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ad-text">Words</label>
            <textarea id="ad-text" className="input" rows={3} value={f.primaryText} onChange={(e) => setF({ ...f, primaryText: e.target.value })} maxLength={500} required data-testid="ad-text" />
          </div>
          <div>
            <label className="label" htmlFor="ad-budget">Daily budget (US$)</label>
            <input id="ad-budget" className="input" type="number" min={1} step="0.5" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} required data-testid="ad-budget" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ad-start">Starts</label>
              <input id="ad-start" className="input" type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="ad-end">Ends (optional)</label>
              <input id="ad-end" className="input" type="date" value={f.endsAt} min={f.startsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
            </div>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={busy !== null || !f.headline.trim() || !f.primaryText.trim()} data-testid="ad-create">Save as draft</button>
            <button type="button" className="btn btn-secondary ml-2" onClick={writeWithAi} disabled={busy !== null || !f.contentId} title="Choose a content idea first" data-testid="ad-write-ai">
              {busy === 'ai' ? 'Writing…' : 'Write with AI'}
            </button>
            {note ? <p className="mt-2 text-sm text-emerald-700" role="status" data-testid="ad-ai-note">{note}</p> : null}
            <p className="mt-2 text-xs text-slate-500">{google ? 'Google search ads are text only: your headline and words are cut to fit Google\'s limits (30 and 90 characters). ' : ''}"Write with AI" saves a draft with the words written for you. It never writes prices or sizes.</p>
          </div>
        </form>
      </Card>

      {!ads && !error ? <Loading /> : null}
      {ads && ads.length === 0 ? <EmptyState icon="📢" title="No ads yet" description="Make a draft above. Nothing is spent until you create it on the platform and press Start." /> : null}
      <ul className="space-y-3" data-testid="ad-list">
        {ads?.map((ad) => {
          const onPlatform = ['PAUSED_ON_PLATFORM', 'ACTIVE', 'COMPLETED'].includes(ad.status);
          return (
            <li key={ad.id} className="card" data-testid="ad-item">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{ad.headline}</p>
                  <p className="text-sm text-slate-500">{AD_PLATFORM_NAMES[ad.channelKind] ?? 'Meta'} · {AD_OBJECTIVE_LABELS[ad.objective] ?? ad.objective} · {usd(ad.dailyBudgetCents)} a day · {day(ad.startsAt)} to {day(ad.endsAt)}</p>
                </div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${AD_STATUS_CLASSES[ad.status] ?? ''}`} data-testid="ad-status">{adStatusLabel(ad.status, AD_PLATFORM_NAMES[ad.channelKind] ?? 'Meta')}</span>
              </div>
              <p className="mt-2 text-sm text-slate-700">{ad.primaryText}</p>
              <p className="mt-2 text-sm text-slate-600" data-testid="ad-spend">
                Spent {usd(ad.spendCents)}{budget && budget.capCents > 0 ? ` of the ${usd(budget.capCents)} monthly limit (all ads this month: ${usd(budget.recordedSpendCents)})` : ' · the monthly limit is $0.00, so this ad cannot be started'}
              </p>
              {ad.error ? <p className="mt-2 text-sm text-rose-700">{AD_PLATFORM_NAMES[ad.channelKind] ?? 'Meta'} said: {ad.error}</p> : null}
              {rowErrors[ad.id] ? <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert" data-testid="ad-blocked">{rowErrors[ad.id]}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {adButtons(ad.status, ad.dailyBudgetCents, AD_PLATFORM_NAMES[ad.channelKind] ?? 'Meta').map((b) => (
                  <button key={b.action} type="button" className={`btn btn-${b.tone}`} disabled={busy !== null} onClick={() => act(ad, b.action, b.confirm)} data-testid={`ad-${b.action}-${ad.id}`}>
                    {busy === `${ad.id}:${b.action}` ? 'Working…' : b.label}
                  </button>
                ))}
                {onPlatform ? <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => sync(ad)} data-testid={`ad-sync-${ad.id}`}>Update results</button> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
