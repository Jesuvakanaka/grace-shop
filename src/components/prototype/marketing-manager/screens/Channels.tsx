'use client';
// Channels (secondary screen): the breadth of channels, grouped by purpose, with what
// each helps with, what it needs, how the prototype depicts it and its demo connection.
import React, { useState } from 'react';
import { CHANNELS, GROUP_LABEL, type ChannelGroup, type ChannelInfo } from '../catalog';
import { activeCampaign } from '../engine';
import { useDemo } from '../store';
import { Dialog, Note, PageTitle, Pill } from '../ui';

const GROUPS: ChannelGroup[] = ['discovery', 'direct', 'search', 'partners'];

const DEPICTION = {
  automatic: { label: 'Posted for you (depicted)', tone: 'sky' as const },
  manual: { label: 'You share it yourself', tone: 'violet' as const },
  future: { label: 'Future idea', tone: 'slate' as const },
};

export function ChannelsScreen() {
  const { state } = useDemo();
  const [only, setOnly] = useState(false);
  const c = activeCampaign(state);
  const inPlan = new Set(c?.plan.channels.map((x) => x.id) ?? []);
  const [connect, setConnect] = useState<ChannelInfo | null>(null);

  return (
    <div>
      <PageTitle eyebrow="Channels" title="Where your marketing can appear" hint="You do not need all of these. Your plan picks the few that suit each goal." />
      <Note tone="warn" className="mb-5">Nothing here is connected for real. &ldquo;Connected in demo&rdquo; is pretend, and no channel has been tested with a real shop account yet. Automatic posting is shown only where the platform allows it.</Note>

      {c ? (
        <label className="mb-5 inline-flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-olive-600" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only show channels in my current plan
        </label>
      ) : null}

      <div className="space-y-8">
        {GROUPS.map((g) => {
          const list = CHANNELS.filter((x) => x.group === g && (!only || inPlan.has(x.id)));
          if (!list.length) return null;
          return (
            <section key={g} aria-labelledby={`g-${g}`}>
              <h2 id={`g-${g}`} className="font-serif text-2xl">{GROUP_LABEL[g].title}</h2>
              <p className="mb-3 text-sm text-slate-600">{GROUP_LABEL[g].hint}</p>
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((ch) => <ChannelCard key={ch.id} ch={ch} inPlan={inPlan.has(ch.id)} onConnect={() => setConnect(ch)} />)}
              </ul>
            </section>
          );
        })}
      </div>

      <ConnectDialog ch={connect} onClose={() => setConnect(null)} />
    </div>
  );
}

function ChannelCard({ ch, inPlan, onConnect }: { ch: ChannelInfo; inPlan: boolean; onConnect: () => void }) {
  const { state, dispatch, toast } = useDemo();
  const conn = state.connections[ch.id];
  const d = DEPICTION[ch.depiction];
  return (
    <li className="card flex flex-col !p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-slate-900">{ch.name}</p>
        <div className="flex flex-wrap gap-1.5">{inPlan ? <Pill tone="lime">In your plan</Pill> : null}<Pill tone={d.tone}>{d.label}</Pill></div>
      </div>
      <dl className="mt-2 flex-1 space-y-1.5 text-sm">
        <div><dt className="inline font-medium text-slate-800">Helps you: </dt><dd className="inline text-slate-700">{ch.helps}</dd></div>
        <div><dt className="inline font-medium text-slate-800">Needs: </dt><dd className="inline text-slate-700">{ch.needs}</dd></div>
        {ch.caution ? <div className="text-slate-600"><dt className="sr-only">Good to know</dt><dd>{ch.caution}</dd></div> : null}
      </dl>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="text-sm">
          {ch.depiction === 'future' ? <span className="text-slate-500">Not available in this prototype</span>
            : conn === 'manual' ? <span className="text-slate-600">No connection needed</span>
            : conn === 'connected' ? <span className="font-medium text-brand-olive-700">Connected in demo</span>
            : conn === 'expired' ? <span className="font-medium text-rose-700">Connection expired (demo)</span>
            : <span className="text-slate-600">Not connected</span>}
        </span>
        {ch.depiction === 'automatic' ? (
          conn === 'connected'
            ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { dispatch({ type: 'connection/set', channel: ch.id, status: 'not_connected' }); toast(`${ch.name} disconnected in the demo.`, 'info'); }}>Disconnect</button>
            : <button type="button" className="btn btn-secondary btn-sm" onClick={onConnect}>{conn === 'expired' ? 'Reconnect (pretend)' : 'Connect (pretend)'}</button>
        ) : null}
      </div>
    </li>
  );
}

function ConnectDialog({ ch, onClose }: { ch: ChannelInfo | null; onClose: () => void }) {
  const { dispatch, toast } = useDemo();
  return (
    <Dialog open={!!ch} onClose={onClose} title={`Connect ${ch?.name ?? ''}`}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => { if (ch) dispatch({ type: 'connection/set', channel: ch.id, status: 'connected' }); onClose(); toast(`${ch?.name} connected in the demo only.`); }}>Pretend to connect</button></>}>
      <Note tone="warn" className="mb-3">This is a pretend connection for the demo. No account is contacted and nothing is connected for real.</Note>
      <p className="text-slate-700">In a real launch you would sign in to {ch?.name} and give permission. Some platforms also review the shop first, which can take days.</p>
    </Dialog>
  );
}
