'use client';
// "Approvals": the campaign sequence, each item's previews per channel, editing,
// alternative openings, simulated revisions, and approval of the exact version shown.
import React, { useState } from 'react';
import { FORMATS, type FormatId } from '../catalog';
import { relDay } from '../dates';
import { activeCampaign, currentVersion } from '../engine';
import { REVISION_LABEL, STAGE_INFO, openingOf, styleFromNote, type RevisionStyle } from '../plan';
import { Preview } from '../previews';
import { useDemo } from '../store';
import type { Material } from '../types';
import { Dialog, Empty, Icon, Note, PageTitle, Pill, SectionTitle, Simulated } from '../ui';
import { formatsLine } from './shared';

function StatusPill({ m }: { m: Material }) {
  const v = currentVersion(m).n;
  if (m.status === 'approved') return <Pill tone="olive"><Icon name="check" className="h-3.5 w-3.5" /> Approved · version {m.approvedVersion}</Pill>;
  if (m.status === 'changes') return <Pill tone="rose">Sent back for changes</Pill>;
  if (m.reapproval) return <Pill tone="amber">Changed after approval · approve version {v} again</Pill>;
  return <Pill tone="amber">Awaiting approval · version {v}</Pill>;
}

export function ApprovalsScreen() {
  const { state, route } = useDemo();
  const c = activeCampaign(state);
  const id = route[1];
  if (id) {
    const m = state.materials.find((x) => x.id === id);
    if (m) return <ItemDetail m={m} />;
  }
  if (!c) {
    return (
      <div>
        <PageTitle eyebrow="Approvals" title="Nothing to approve" />
        <Empty icon="approve" title="No campaign items are waiting" text="When you accept a plan, its posts and messages appear here for you to check, change and approve." action={<a href="#/plan" className="btn btn-primary">Set a goal</a>} />
      </div>
    );
  }
  return <ApprovalList />;
}

function ApprovalList() {
  const { state, dispatch, toast } = useDemo();
  const c = activeCampaign(state)!;
  const mats = state.materials.filter((m) => m.campaignId === c.id);
  const awaiting = mats.filter((m) => m.status === 'awaiting');
  const back = mats.filter((m) => m.status === 'changes');
  const [confirm, setConfirm] = useState(false);

  return (
    <div>
      <PageTitle eyebrow="Approvals" title={c.name}
        hint={awaiting.length || back.length ? 'Open each item to see it as it will look on every channel. Approval covers exactly the version you see.' : 'Everything is approved. If you change an item later, it needs your approval again.'}
        action={awaiting.length ? <button type="button" className="btn btn-primary" onClick={() => setConfirm(true)}><Icon name="check" className="h-4 w-4" /> Approve all {awaiting.length} as shown</button> : <a href="#/campaigns" className="btn btn-secondary">Go to campaign</a>} />

      {back.length ? <Note tone="warn" className="mb-4">{back.length} item{back.length === 1 ? ' is' : 's are'} sent back for changes and will not go out until approved.</Note> : null}

      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {mats.map((m, i) => (
          <li key={m.id}>
            <a href={`#/approvals/${m.id}`} className="card-hover flex h-full flex-col !p-0 overflow-hidden">
              <div className="relative aspect-[4/3] bg-brand-cream-100">
                {/* eslint-disable-next-line @next/next/no-img-element -- fixed local lookbook file */}
                <img src={m.images[0]} alt="" className="h-full w-full object-cover object-top" />
                <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-800">{i + 1}. {STAGE_INFO[m.stage].journey}</span>
                <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white">Demo material</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <p className="text-xs text-slate-500">{STAGE_INFO[m.stage].label} · {relDay(m.date, state.today)}</p>
                <p className="font-medium text-slate-900">{m.title}</p>
                <p className="line-clamp-2 text-sm text-slate-600">{openingOf(currentVersion(m).caption)}</p>
                <p className="text-xs text-slate-500">{formatsLine(m)}</p>
                <div className="mt-auto pt-1"><StatusPill m={m} /></div>
              </div>
            </a>
          </li>
        ))}
      </ol>

      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Approve these items as shown?"
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setConfirm(false)}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => { dispatch({ type: 'material/approveAll', campaignId: c.id }); setConfirm(false); toast(`${awaiting.length} items approved. Next, schedule the campaign.`); }}>Approve {awaiting.length}</button></>}>
        <p className="mb-3 text-slate-700">You are approving these exact versions. If anything changes later, it will need your approval again.</p>
        <ul className="space-y-1.5 text-sm">
          {awaiting.map((m) => <li key={m.id} className="flex justify-between gap-3"><span>{m.title}</span><span className="shrink-0 text-slate-500">version {currentVersion(m).n}</span></li>)}
        </ul>
        {back.length ? <p className="mt-3 text-sm text-slate-600">{back.length} sent-back item{back.length === 1 ? ' is' : 's are'} not included.</p> : null}
      </Dialog>
    </div>
  );
}

function ItemDetail({ m }: { m: Material }) {
  const { state, dispatch, toast, go } = useDemo();
  const [fmt, setFmt] = useState<FormatId>(m.formats[0]);
  const [revising, setRevising] = useState<string | null>(null);
  const [backOpen, setBackOpen] = useState(false);
  const [note, setNote] = useState('');
  const mats = state.materials.filter((x) => x.campaignId === m.campaignId);
  const idx = mats.findIndex((x) => x.id === m.id);
  const v = currentVersion(m);
  const campaign = state.campaigns.find((c) => c.id === m.campaignId);
  const readOnly = campaign?.status !== 'active';
  const format = m.formats.includes(fmt) ? fmt : m.formats[0];

  const runRevision = (style: RevisionStyle, why: string) => {
    setRevising(REVISION_LABEL[style]);
    window.setTimeout(() => {
      dispatch({ type: 'material/revise', id: m.id, style, why });
      setRevising(null);
      toast('A revised version is ready. Check it before approving.');
    }, 1600);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <a href="#/approvals" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-700 hover:underline"><Icon name="back" className="h-4 w-4" /> All items</a>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={idx <= 0} onClick={() => go(`#/approvals/${mats[idx - 1]?.id}`)}>Previous</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={idx >= mats.length - 1} onClick={() => go(`#/approvals/${mats[idx + 1]?.id}`)}>Next</button>
        </div>
      </div>

      <PageTitle eyebrow={`Item ${idx + 1} of ${mats.length} · ${STAGE_INFO[m.stage].journey}`} title={m.title} hint={<>{m.purpose} Planned for {/^(Today|Tomorrow|Yesterday)$/.test(relDay(m.date, state.today)) ? relDay(m.date, state.today).toLowerCase() : relDay(m.date, state.today)}.</>} />
      {readOnly ? <Note className="mb-4">This item belongs to a campaign that has ended. It is shown for reference only.</Note> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section aria-label="Preview">
          <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Channel format">
            {m.formats.map((f) => (
              <button key={f} type="button" role="tab" aria-selected={format === f} onClick={() => setFmt(f)} className={`min-h-10 rounded-full border px-3 text-sm ${format === f ? 'border-brand-olive-600 bg-brand-olive-600 font-medium text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                {FORMATS[f].label}
              </button>
            ))}
          </div>
          <div className="rounded-2xl bg-slate-100 p-4 sm:p-6">
            <Preview format={format} caption={v.caption} images={m.images} shop={state.business.name} />
          </div>
          <p className="mt-2 text-center text-xs text-slate-500">{FORMATS[format].auto ? 'In a real launch this would be posted for you once the channel is connected.' : 'This channel needs you to post it yourself. A share pack will be ready.'}</p>
        </section>

        <section className="space-y-5" aria-label="Review">
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2"><StatusPill m={m} /><span className="text-sm text-slate-500">Showing version {v.n} · {v.why}</span></div>
            {m.reapproval ? <Note tone="warn">You approved an earlier version. This one changed, so it needs your approval again. Until then it will not go out.</Note> : null}
            {m.status === 'changes' ? (
              <Note tone="error">
                <p><strong>You sent this back:</strong> &ldquo;{m.backNote}&rdquo;</p>
                {!readOnly ? <button type="button" className="btn btn-secondary btn-sm mt-2" disabled={!!revising} onClick={() => runRevision(styleFromNote(m.backNote ?? ''), 'Revised from your note (simulated)')}><Icon name="sparkle" className="h-4 w-4" /> Prepare a revision from my note</button> : null}
              </Note>
            ) : null}
            {!readOnly ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" disabled={m.status === 'approved' || !!revising} onClick={() => { dispatch({ type: 'material/approve', id: m.id, version: v.n }); toast(`Approved version ${v.n}.`); }}>
                  <Icon name="check" className="h-4 w-4" /> {m.status === 'approved' ? `Version ${v.n} approved` : `Approve version ${v.n}`}
                </button>
                <button type="button" className="btn btn-secondary" disabled={!!revising} onClick={() => setBackOpen(true)}>Send back for changes</button>
              </div>
            ) : null}
          </div>

          {!readOnly ? <CaptionEditor key={`${m.id}-${v.n}`} m={m} disabled={!!revising} /> : null}

          {!readOnly ? (
            <div className="card">
              <SectionTitle title="Choose a different opening" hint="The first line is what most people read." />
              <div className="space-y-2" role="radiogroup" aria-label="Opening line">
                {m.openings.map((o) => {
                  const on = openingOf(v.caption) === o;
                  return (
                    <button key={o} type="button" role="radio" aria-checked={on} disabled={!!revising} onClick={() => { if (!on) { dispatch({ type: 'material/opening', id: m.id, opening: o }); toast('Opening changed. This is now a new version.', 'info'); } }}
                      className={`flex w-full min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${on ? 'border-brand-olive-600 bg-brand-olive-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <span className={`h-4 w-4 shrink-0 rounded-full border ${on ? 'border-[5px] border-brand-olive-600' : 'border-slate-400'}`} />{o.replace('{first name}', 'Nyasha')}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!readOnly ? (
            <div className="card">
              <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="font-serif text-xl">Ask for a revision</h2><Simulated>Simulated revision</Simulated></div>
              {revising ? (
                <p className="flex items-center gap-2 text-sm text-slate-700" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-olive-200 border-t-brand-olive-600" /> Preparing a revision: {revising.toLowerCase()}…</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(REVISION_LABEL) as RevisionStyle[]).map((st) => (
                    <button key={st} type="button" className="btn btn-secondary btn-sm" onClick={() => runRevision(st, `Simulated revision: ${REVISION_LABEL[st].toLowerCase()}`)}>{REVISION_LABEL[st]}</button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div className="card">
            <SectionTitle title="Version history" />
            <ol className="space-y-2 text-sm">
              {[...m.versions].reverse().map((x) => (
                <li key={x.n} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
                  <span><strong>Version {x.n}</strong> · {x.why}</span>
                  {m.approvedVersion === x.n ? <Pill tone="olive">Approved</Pill> : x.n === v.n ? <Pill>Shown</Pill> : null}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      <Dialog open={backOpen} onClose={() => setBackOpen(false)} title="Send back for changes"
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setBackOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={!note.trim()} onClick={() => { dispatch({ type: 'material/sendBack', id: m.id, note: note.trim() }); setBackOpen(false); setNote(''); toast('Sent back. It will not go out until you approve a new version.', 'info'); }}>Send back</button></>}>
        <label htmlFor="back-note" className="label">What should change?</label>
        <textarea id="back-note" rows={3} className="input" value={note} placeholder="For example: too long, make it warmer" onChange={(e) => setNote(e.target.value)} />
        <p className="mt-2 text-xs text-slate-500">Your marketing manager uses your note to prepare a revision (simulated in this prototype).</p>
      </Dialog>
    </div>
  );
}

function CaptionEditor({ m, disabled }: { m: Material; disabled: boolean }) {
  const { dispatch, toast } = useDemo();
  const v = currentVersion(m);
  const [text, setText] = useState(v.caption);
  const dirty = text !== v.caption;
  return (
    <div className="card">
      <SectionTitle title="Edit the caption" />
      <label htmlFor="cap" className="sr-only">Caption</label>
      <textarea id="cap" rows={8} className="input font-[inherit] text-[15px] leading-relaxed" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
      {dirty && m.status === 'approved' ? <p className="mt-2 text-sm text-amber-800">Saving creates version {v.n + 1}. You approved version {v.n}, so the new one needs approval again.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || !text.trim()} onClick={() => { dispatch({ type: 'material/caption', id: m.id, caption: text.trim(), why: 'You edited the caption' }); toast(`Saved as version ${v.n + 1}.`); }}>Save as version {v.n + 1}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty} onClick={() => setText(v.caption)}>Undo changes</button>
      </div>
    </div>
  );
}
