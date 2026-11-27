'use client';
// ZP-1200: Marketing settings. The live switch, spend cap, weekly target, brand voice, pixel and feed (stored for later).
import React, { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { mk } from '@/components/marketing/api';
import { Card, ErrorNote, Loading, useHubStatus } from '@/components/marketing/parts';
import { DEFAULT_SHOP_DESCRIPTION, SHOP_NAME } from '@/lib/marketing/ai/shop';
import { centsToUsd, usdToCents } from '@/lib/marketing/ui';

interface Settings { liveEnabled: boolean; monthlySpendCapCents: number; metaPixelId: string | null; productFeedEnabled: boolean; weeklyPostTarget: number; brandVoice: string | null; shopDescription: string | null; policyDelivery: string | null; policyReturns: string | null; policyOrdering: string | null }

export default function SettingsPage() {
  const toast = useToast();
  const { reload } = useHubStatus();
  const [s, setS] = useState<Settings | null>(null);
  const [envOn, setEnvOn] = useState(false);
  const [cap, setCap] = useState('');
  const [target, setTarget] = useState('7');
  const [voice, setVoice] = useState('');
  const [about, setAbout] = useState('');
  const [delivery, setDelivery] = useState('');
  const [returns, setReturns] = useState('');
  const [ordering, setOrdering] = useState('');
  const [pixel, setPixel] = useState('');
  const [feed, setFeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);

  const apply = (d: { settings: Settings; liveAllowedByEnv: boolean }) => {
    setS(d.settings);
    setEnvOn(d.liveAllowedByEnv);
    setCap(centsToUsd(d.settings.monthlySpendCapCents));
    setTarget(String(d.settings.weeklyPostTarget));
    setVoice(d.settings.brandVoice ?? '');
    setAbout(d.settings.shopDescription ?? '');
    setDelivery(d.settings.policyDelivery ?? '');
    setReturns(d.settings.policyReturns ?? '');
    setOrdering(d.settings.policyOrdering ?? '');
    setPixel(d.settings.metaPixelId ?? '');
    setFeed(d.settings.productFeedEnabled);
  };
  useEffect(() => {
    mk<{ settings: Settings; liveAllowedByEnv: boolean }>('/api/marketing/settings').then(apply).catch((e) => setError(e.message));
  }, []);

  const put = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      apply(await mk('/api/marketing/settings', { method: 'PUT', body }));
      reload();
      toast.success(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const capCents = usdToCents(cap);
    if (capCents === undefined || capCents === null) return setError('The monthly spend cap must be an amount like 100 or 49.99 (use 0 for no spending).');
    const t = Number(target);
    if (!Number.isInteger(t) || t < 0 || t > 100) return setError('The weekly post target must be a whole number from 0 to 100.');
    void put({ monthlySpendCapCents: capCents, weeklyPostTarget: t, brandVoice: voice || null, shopDescription: about || null, policyDelivery: delivery || null, policyReturns: returns || null, policyOrdering: ordering || null, metaPixelId: pixel || null, productFeedEnabled: feed }, 'Settings saved.');
  };

  if (!s) return error ? <ErrorNote message={error} /> : <Loading />;

  return (
    <div className="space-y-6 max-w-2xl">
      <ErrorNote message={error} />
      <Card className="space-y-3">
        <h2 className="font-serif text-xl font-semibold">Live posting</h2>
        <p className="text-sm text-slate-600">When this is on, approved posts can go out through connected channels. It only works when the server switch is also on.</p>
        <p className="text-sm" data-testid="server-switch">Server switch: <strong>{envOn ? 'on' : 'off'}</strong>{envOn ? '' : ' (nothing can go live until it is turned on on the server)'}</p>
        <label className="flex items-center gap-3 min-h-12">
          <input type="checkbox" className="h-6 w-6" checked={s.liveEnabled} disabled={busy} onChange={() => (s.liveEnabled ? void put({ liveEnabled: false }, 'Live posting is off.') : setConfirmLive(true))} data-testid="live-toggle" />
          <span className="font-medium">Live posting is {s.liveEnabled ? 'ON' : 'OFF'}</span>
        </label>
      </Card>

      <form onSubmit={save} className="space-y-6">
        <Card className="space-y-4">
          <div>
            <label className="label" htmlFor="s-cap">Monthly spend cap for ads (USD)</label>
            <input id="s-cap" className="input" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} data-testid="spend-cap" />
            <p className="text-xs text-slate-500 mt-1">Ads can never push the month above this. 0 means no ad can be created.</p>
          </div>
          <div>
            <label className="label" htmlFor="s-target">Posts you aim to share each week</label>
            <input id="s-target" className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="weekly-target" />
          </div>
          <div>
            <label className="label" htmlFor="s-voice">Brand voice notes</label>
            <textarea id="s-voice" className="input min-h-28" value={voice} onChange={(e) => setVoice(e.target.value)} maxLength={1000} placeholder="For example: warm, plain words, never pushy." data-testid="brand-voice" />
            <p className="text-xs text-slate-500 mt-1">Guidance for the AI writer on how the shop sounds.</p>
          </div>
        </Card>
        <Card className="space-y-4">
          <h2 className="font-serif text-xl font-semibold">What the AI knows about the shop</h2>
          <p className="text-sm text-slate-600">The AI only says what it is told here and on each product. Anything you leave empty it will not mention, and it will ask you instead of guessing.</p>
          <div>
            <label className="label" htmlFor="s-about">The shop in one line</label>
            <input id="s-about" className="input" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={200} placeholder={DEFAULT_SHOP_DESCRIPTION} data-testid="shop-description" />
            <p className="text-xs text-slate-500 mt-1">Every AI request opens with &quot;{SHOP_NAME}, {about.trim().replace(/\.+$/, '') || DEFAULT_SHOP_DESCRIPTION}&quot;.</p>
          </div>
          <div>
            <label className="label" htmlFor="s-delivery">Delivery</label>
            <textarea id="s-delivery" className="input min-h-20" value={delivery} onChange={(e) => setDelivery(e.target.value)} maxLength={500} placeholder="For example: where you deliver and how long it takes." data-testid="policy-delivery" />
          </div>
          <div>
            <label className="label" htmlFor="s-returns">Returns and exchanges</label>
            <textarea id="s-returns" className="input min-h-20" value={returns} onChange={(e) => setReturns(e.target.value)} maxLength={500} placeholder="For example: whether a size can be exchanged, and within how many days." data-testid="policy-returns" />
          </div>
          <div>
            <label className="label" htmlFor="s-ordering">How to order</label>
            <textarea id="s-ordering" className="input min-h-20" value={ordering} onChange={(e) => setOrdering(e.target.value)} maxLength={500} placeholder="For example: message us on WhatsApp, or order on the website." data-testid="policy-ordering" />
          </div>
          <p className="text-xs text-slate-500">Leave amounts of money out of these boxes: the shop adds prices itself, so the AI is not allowed to write them.</p>
        </Card>
        <Card className="space-y-4">
          <h2 className="font-serif text-xl font-semibold">For later</h2>
          <p className="text-sm text-slate-600">These are saved now and used when the matching feature arrives. They change nothing yet.</p>
          <div>
            <label className="label" htmlFor="s-pixel">Meta Pixel ID</label>
            <input id="s-pixel" className="input" inputMode="numeric" value={pixel} onChange={(e) => setPixel(e.target.value)} maxLength={32} data-testid="pixel-id" />
          </div>
          <label className="flex items-center gap-3 min-h-12"><input type="checkbox" className="h-6 w-6" checked={feed} onChange={(e) => setFeed(e.target.checked)} /><span>Product feed for shopping channels</span></label>
        </Card>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="settings-save">Save settings</button>
      </form>

      <ConfirmDialog
        open={confirmLive}
        title="Turn live posting on?"
        message="Approved posts on connected channels will be able to go out for real. This only works while the server switch is on too, and every post still needs your approval first."
        confirmText="Turn on"
        onCancel={() => setConfirmLive(false)}
        onConfirm={() => { setConfirmLive(false); void put({ liveEnabled: true }, 'Live posting is on.'); }}
      />
    </div>
  );
}
