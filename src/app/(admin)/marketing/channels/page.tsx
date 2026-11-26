'use client';
// ZP-1200: every channel the hub knows. Channels with a Connect box can be connected here (the rest say coming soon).
import React, { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { mk, type ChannelItem } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';
import { connectFieldsError } from '@/lib/marketing/channels';
import { connectedAsText, groupByFamily, modeLabel } from '@/lib/marketing/ui';

function statusText(c: ChannelItem): string {
  if (c.mode === 'manual') return 'No connection needed';
  if (c.effectiveStatus === 'CONNECTED') return c.channel?.tokenHint ? `Connected, ends ...${c.channel.tokenHint}` : 'Connected';
  if (c.effectiveStatus === 'ERROR') return `Problem: ${c.channel?.lastError ?? 'unknown'}`;
  return 'Not connected';
}

function ConnectPanel({ c, onDone }: { c: ChannelItem; onDone: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const connected = c.effectiveStatus === 'CONNECTED' && c.channel;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = connectFieldsError(c.connectFields, values);
    if (bad) { setError(bad); return; }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { kind: c.kind };
      for (const f of c.connectFields) body[f.name] = (values[f.name] ?? '').trim();
      await mk('/api/marketing/channels/connect', { method: 'POST', body });
      setValues({});
      toast.success('Connected. Posting is still off until you switch it on in Settings.');
      onDone();
    } catch (err) {
      setValues((v) => Object.fromEntries(Object.entries(v).filter(([k]) => c.connectFields.find((f) => f.name === k)?.kind !== 'secret')));
      setError(err instanceof Error ? err.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setConfirm(false);
    if (!c.channel) return;
    setBusy(true);
    setError(null);
    try {
      await mk(`/api/marketing/channels/${c.channel.id}/disconnect`, { method: 'POST' });
      toast.success('Disconnected. The saved token was wiped.');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  };

  const sync = async (mode: 'products' | 'register-feed') => {
    if (!c.channel) return;
    setBusy(true);
    setError(null);
    try {
      const d = await mk<{ result: { mode: string; sent?: number; skipped?: number; failed?: number; firstError?: string | null } }>(`/api/marketing/channels/${c.channel.id}/sync-products`, { method: 'POST', body: { mode } });
      const r = d.result;
      if (r.mode === 'products') toast.success(`Sent ${r.sent} products to Google${r.skipped ? `, ${r.skipped} skipped (no price or photo)` : ''}${r.failed ? `, ${r.failed} refused` : ''}.`);
      else toast.success('Google will now fetch your product feed every day.');
      if (r.firstError) setError(r.firstError);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send products.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4" data-testid={`connect-panel-${c.kind}`}>
      {connected && c.channel ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-700" data-testid={`connected-as-${c.kind}`}>{connectedAsText(c.channel)}</p>
          <button type="button" className="btn btn-danger btn-sm ml-auto" disabled={busy} onClick={() => setConfirm(true)} data-testid={`disconnect-${c.kind}`}>Disconnect</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3" noValidate>
          {c.effectiveStatus === 'ERROR' && c.channel?.lastError ? <p className="text-sm text-rose-700" data-testid={`last-error-${c.kind}`}>Last problem: {c.channel.lastError}</p> : null}
          <div>
            <p className="text-sm font-medium text-slate-900 mb-1">Before you connect</p>
            <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-600">{c.setupSteps.map((n) => <li key={n}>{n}</li>)}</ol>
          </div>
          <p className="text-sm rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">Connecting does not switch posting on. Nothing is posted until live posting is on in Settings and you approve each post.</p>
          {c.connectFields.map((f) => (
            <div key={f.name}>
              <label className="label" htmlFor={`f-${c.kind}-${f.name}`}>{f.label}</label>
              <input
                id={`f-${c.kind}-${f.name}`} className="input max-w-sm" autoComplete={f.kind === 'secret' ? 'new-password' : 'off'}
                type={f.kind === 'secret' ? 'password' : 'text'} inputMode={f.kind === 'digits' ? 'numeric' : undefined}
                value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                data-testid={f.name === 'pageId' ? `page-id-${c.kind}` : f.name === 'accessToken' ? `token-${c.kind}` : `field-${c.kind}-${f.name}`}
              />
              {f.help ? <p className="text-xs text-slate-500 mt-1">{f.help}</p> : null}
            </div>
          ))}
          <ErrorNote message={error} />
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid={`connect-${c.kind}`}>{busy ? (c.family === 'google' ? 'Checking with Google…' : 'Checking…') : 'Connect'}</button>
        </form>
      )}
      {connected && c.kind === 'GOOGLE_MERCHANT' ? (
        <div className="flex flex-wrap gap-2" data-testid="merchant-sync">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => sync('products')} data-testid="sync-products">Send products to Google</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => sync('register-feed')} data-testid="register-feed">Register my product feed with Google</button>
          <p className="basis-full text-xs text-slate-500">Needs live posting on in Settings and &quot;Product feed&quot; switched on. Products without a price are skipped.</p>
        </div>
      ) : null}
      {connected ? <ErrorNote message={error} /> : null}
      <ConfirmDialog open={confirm} title={`Disconnect ${c.label}?`} message="The saved token is wiped. Posts for this channel cannot go out until you connect it again." confirmText="Disconnect" variant="danger" onCancel={() => setConfirm(false)} onConfirm={disconnect} />
    </div>
  );
}

export default function ChannelsPage() {
  const [items, setItems] = useState<ChannelItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    mk<{ channels: ChannelItem[] }>('/api/marketing/channels').then((d) => setItems(d.channels)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!items) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-600">Every place the hub can help you sell. Channels marked &quot;You post it&quot; need no keys: the hub prepares the words and photos and you post them yourself.</p>
      {groupByFamily(items).map((g) => (
        <section key={g.family}>
          <h2 className="font-serif text-xl font-semibold mb-3">{g.label}</h2>
          <div className="space-y-3">
            {g.items.map((c) => (
              <Card key={c.kind}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="font-semibold text-slate-900">{c.label}</h3>
                  <span className="text-xs rounded-full border border-slate-200 px-2 py-0.5 text-slate-600">{modeLabel(c)}</span>
                  <span className={`text-xs ${c.effectiveStatus === 'CONNECTED' ? 'text-brand-olive-700' : 'text-slate-500'}`} data-testid={`channel-status-${c.kind}`}>{statusText(c)}</span>
                  {c.mode === 'api' && !c.connector ? (
                    <button type="button" className="btn btn-secondary btn-sm ml-auto" disabled title="Coming soon">Connect (coming soon)</button>
                  ) : null}
                </div>
                {c.mode === 'api' && c.connector ? <ConnectPanel c={c} onDone={load} /> : null}
                <details className="mt-3 group" data-testid={`channel-details-${c.kind}`}>
                  <summary className="cursor-pointer text-sm text-brand-olive-700 min-h-10 flex items-center">What it can and cannot do, and how to set it up</summary>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2 text-sm">
                    <div>
                      <h4 className="font-medium text-slate-900 mb-1">What it cannot do</h4>
                      <ul className="list-disc pl-5 space-y-1 text-slate-600">{c.apiNotes.map((n) => <li key={n}>{n}</li>)}</ul>
                    </div>
                    <div>
                      <h4 className="font-medium text-slate-900 mb-1">How to set it up</h4>
                      <ol className="list-decimal pl-5 space-y-1 text-slate-600">{c.setupSteps.map((n) => <li key={n}>{n}</li>)}</ol>
                    </div>
                  </div>
                </details>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
