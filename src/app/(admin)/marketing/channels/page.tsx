'use client';
// ZP-1200: every channel the hub knows, read only. Connecting comes in a later update.
import React, { useEffect, useState } from 'react';
import { mk, type ChannelItem } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';
import { groupByFamily, modeLabel } from '@/lib/marketing/ui';

function statusText(c: ChannelItem): string {
  if (c.mode === 'manual') return 'No connection needed';
  if (c.effectiveStatus === 'CONNECTED') return c.channel?.tokenHint ? `Connected, ends ...${c.channel.tokenHint}` : 'Connected';
  if (c.effectiveStatus === 'ERROR') return `Problem: ${c.channel?.lastError ?? 'unknown'}`;
  return 'Not connected';
}

export default function ChannelsPage() {
  const [items, setItems] = useState<ChannelItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mk<{ channels: ChannelItem[] }>('/api/marketing/channels').then((d) => setItems(d.channels)).catch((e) => setError(e.message));
  }, []);
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
                  {c.mode === 'api' ? (
                    <button type="button" className="btn btn-secondary btn-sm ml-auto" disabled title="Coming soon">Connect (coming soon)</button>
                  ) : null}
                </div>
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
