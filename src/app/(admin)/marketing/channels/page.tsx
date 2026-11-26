'use client';
// ZP-1200: every channel the hub knows. Facebook and Instagram can be connected here (the rest say coming soon).
import React, { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { mk, type ChannelItem } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';
import { connectedAsText, connectFormError, groupByFamily, modeLabel } from '@/lib/marketing/ui';

function statusText(c: ChannelItem): string {
  if (c.mode === 'manual') return 'No connection needed';
  if (c.effectiveStatus === 'CONNECTED') return c.channel?.tokenHint ? `Connected, ends ...${c.channel.tokenHint}` : 'Connected';
  if (c.effectiveStatus === 'ERROR') return `Problem: ${c.channel?.lastError ?? 'unknown'}`;
  return 'Not connected';
}

function ConnectPanel({ c, onDone }: { c: ChannelItem; onDone: () => void }) {
  const toast = useToast();
  const [pageId, setPageId] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const connected = c.effectiveStatus === 'CONNECTED' && c.channel;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = connectFormError(pageId, token);
    if (bad) { setError(bad); return; }
    setBusy(true);
    setError(null);
    try {
      await mk('/api/marketing/channels/connect', { method: 'POST', body: { kind: c.kind, pageId: pageId.trim(), accessToken: token.trim() } });
      setToken('');
      setPageId('');
      toast.success('Connected. Posting is still off until you switch it on in Settings.');
      onDone();
    } catch (err) {
      setToken('');
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
          <div>
            <label className="label" htmlFor={`pid-${c.kind}`}>Facebook Page ID</label>
            <input id={`pid-${c.kind}`} className="input max-w-sm" inputMode="numeric" autoComplete="off" value={pageId} onChange={(e) => setPageId(e.target.value)} data-testid={`page-id-${c.kind}`} />
          </div>
          <div>
            <label className="label" htmlFor={`tok-${c.kind}`}>Access token</label>
            <input id={`tok-${c.kind}`} className="input max-w-sm" type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value)} data-testid={`token-${c.kind}`} />
            <p className="text-xs text-slate-500 mt-1">It is checked with Meta, saved encrypted, and never shown again.</p>
          </div>
          <ErrorNote message={error} />
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid={`connect-${c.kind}`}>{busy ? 'Checking with Meta…' : 'Connect'}</button>
        </form>
      )}
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
