'use client';
// "Approvals": every channel format has its own words, picture and approval. Items are
// grouped by campaign step; batch approval lists exactly what it covers. Paid ads need
// a second approval for spending. Visuals and video storyboards are simulated.
import React, { useState } from 'react';
import { FORMATS, PRODUCTS } from '../catalog';
import { relDay } from '../dates';
import { currentVersion, liveCampaigns } from '../engine';
import { REVISION_LABEL, SCENE_TEXT, STAGE_INFO, VIDEO_FORMATS, openingOf, styleFromNote, type RevisionStyle } from '../plan';
import { LOOKS, LookSwatch, Preview } from '../previews';
import { useDemo } from '../store';
import type { Campaign, Look, Material, Scene } from '../types';
import { Dialog, Empty, Icon, Note, PageTitle, Pill, SectionTitle, Simulated } from '../ui';
import { AdSettings, AutoPill, automation, stageGroups } from './shared';

function StatusPill({ m }: { m: Material }) {
  const v = currentVersion(m).n;
  if (m.status === 'approved') return <Pill tone="olive"><Icon name="check" className="h-3.5 w-3.5" /> Approved · version {m.approvedVersion}</Pill>;
  if (m.status === 'changes') return <Pill tone="rose">Sent back for changes</Pill>;
  if (m.reapproval) return <Pill tone="amber">Changed after approval · approve version {v} again</Pill>;
  return <Pill tone="amber">Awaiting approval · version {v}</Pill>;
}

const fmtLabel = (m: Material) => FORMATS[m.formats[0]].label;

export function ApprovalsScreen() {
  const { state, route } = useDemo();
  const live = liveCampaigns(state);
  const id = route[1];
  if (id) {
    const m = state.materials.find((x) => x.id === id);
    if (m) return <ItemDetail m={m} />;
  }
  if (!live.length) {
    return (
      <div>
        <PageTitle eyebrow="Approvals" title="Nothing to approve" />
        <Empty icon="approve" title="No campaign items are waiting" text="When you accept a plan, its posts and messages appear here, one per channel, for you to check, change and approve." action={<a href="#/plan" className="btn btn-primary">{state.draft?.plan ? 'Review the plan' : 'Go to My plan'}</a>} />
      </div>
    );
  }
  return (
    <div className="space-y-10">
      {live.map((c, i) => <ApprovalList key={c.id} c={c} first={i === 0} many={live.length > 1} />)}
    </div>
  );
}

interface Batch { title: string; items: Material[] }

function ApprovalList({ c, first, many }: { c: Campaign; first: boolean; many: boolean }) {
  const { state, dispatch, toast } = useDemo();
  const mats = state.materials.filter((m) => m.campaignId === c.id);
  const awaiting = mats.filter((m) => m.status === 'awaiting');
  const back = mats.filter((m) => m.status === 'changes');
  const [batch, setBatch] = useState<Batch | null>(null);
  const hasAd = mats.some((m) => m.formats[0] === 'ad') && c.plan.adDaily > 0;
  const starts = c.startDate > state.today ? `Starts ${relDay(c.startDate, state.today).toLowerCase().replace(/^in /, 'in ')}` : 'Running';

  const approveBatch = () => {
    if (!batch) return;
    dispatch({ type: 'material/approveMany', items: batch.items.map((m) => ({ id: m.id, version: currentVersion(m).n })) });
    toast(`${batch.items.length} item${batch.items.length === 1 ? '' : 's'} approved exactly as listed.`);
    setBatch(null);
  };

  return (
    <section aria-label={c.name}>
      <PageTitle eyebrow={many ? `Approvals · ${starts}` : 'Approvals'} title={c.name}
        hint={first ? (awaiting.length || back.length ? 'Each channel has its own version. Open one to see exactly how it will look there. Approval covers only the version you see.' : 'Everything is approved. If you change an item later, it needs your approval again.') : undefined}
        action={awaiting.length ? <button type="button" className="btn btn-primary" onClick={() => setBatch({ title: `All ${awaiting.length} items awaiting approval`, items: awaiting })}><Icon name="check" className="h-4 w-4" /> Review and approve all {awaiting.length}</button> : <a href="#/campaigns" className="btn btn-secondary">Go to campaign</a>} />

      {back.length ? <Note tone="warn" className="mb-4">{back.length} item{back.length === 1 ? ' is' : 's are'} sent back for changes and will not go out until approved.</Note> : null}

      <ol className="space-y-4">
        {stageGroups(mats).map(({ stage, items }, i) => {
          const waiting = items.filter((m) => m.status === 'awaiting');
          return (
            <li key={stage} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Step {i + 1} · {STAGE_INFO[stage].journey} · {relDay(items[0].date, state.today)}</p>
                  <h2 className="mt-0.5 font-serif text-xl text-slate-900">{items[0].title}</h2>
                  <p className="text-sm text-slate-600">{items[0].purpose} {items.length > 1 ? `${items.length} channel versions.` : ''}</p>
                </div>
                {waiting.length > 1 ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBatch({ title: `${items[0].title}: ${waiting.length} versions`, items: waiting })}>Approve this step ({waiting.length})</button> : null}
              </div>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((m) => {
                  const v = currentVersion(m);
                  const f = m.formats[0];
                  return (
                    <li key={m.id}>
                      <a href={`#/approvals/${m.id}`} className="flex h-full gap-3 rounded-lg border border-slate-200 bg-white p-2.5 hover:border-slate-300 hover:bg-slate-50">
                        <span className="relative w-16 shrink-0"><LookSwatch src={VIDEO_FORMATS.includes(f) ? v.scenes?.[0]?.image ?? v.images[0] : v.images[0]} look={v.look} /></span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="text-sm font-medium text-slate-900">{FORMATS[f].label}</span>
                          <span className="line-clamp-2 text-xs text-slate-600">{openingOf(v.caption).replace('{first name}', 'first name')}</span>
                          <span className="mt-auto flex flex-wrap gap-1"><StatusPill m={m} /><AutoPill f={f} /></span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>

      {hasAd ? <div className="mt-4 max-w-2xl"><AdSettings campaign={c} /></div> : null}

      <Dialog open={!!batch} onClose={() => setBatch(null)} title="Approve these exact versions?" wide
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setBatch(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={approveBatch}>Approve {batch?.items.length}</button></>}>
        <p className="mb-3 text-slate-700">{batch?.title}. Each line is one channel version. If any of them changes later, it needs your approval again.</p>
        <ul className="divide-y divide-slate-100 text-sm">
          {batch?.items.map((m) => {
            const v = currentVersion(m);
            const a = automation(state.connections[FORMATS[m.formats[0]].channel], m.formats[0]);
            return (
              <li key={m.id} className="flex gap-3 py-2">
                <span className="w-10 shrink-0"><LookSwatch src={v.scenes?.[0]?.image ?? v.images[0]} look={v.look} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{fmtLabel(m)} · version {v.n}</span>
                  <span className="block truncate text-slate-600">{openingOf(v.caption).replace('{first name}', 'first name')}</span>
                  <span className="block text-xs text-slate-500">{m.title} · {relDay(m.date, state.today)} · {a.short}</span>
                </span>
              </li>
            );
          })}
        </ul>
        {batch?.items.some((m) => m.formats[0] === 'ad') ? <Note className="mt-3">Approving the ad&apos;s content does not start spending. You approve the paid ad settings separately.</Note> : null}
        {back.length ? <p className="mt-3 text-sm text-slate-600">{back.length} sent-back item{back.length === 1 ? ' is' : 's are'} not included.</p> : null}
      </Dialog>
    </section>
  );
}

function ItemDetail({ m }: { m: Material }) {
  const { state, dispatch, toast, go } = useDemo();
  const [revising, setRevising] = useState<string | null>(null);
  const [backOpen, setBackOpen] = useState(false);
  const [note, setNote] = useState('');
  const mats = state.materials.filter((x) => x.campaignId === m.campaignId);
  const siblings = mats.filter((x) => x.stage === m.stage);
  const idx = mats.findIndex((x) => x.id === m.id);
  const v = currentVersion(m);
  const format = m.formats[0];
  const campaign = state.campaigns.find((c) => c.id === m.campaignId)!;
  const readOnly = campaign.status !== 'active';
  const video = VIDEO_FORMATS.includes(format);
  const auto = automation(state.connections[FORMATS[format].channel], format);
  const busy = !!revising;

  const simulate = (label: string, run: () => void, done: string) => {
    setRevising(label);
    window.setTimeout(() => { run(); setRevising(null); toast(done); }, 1500);
  };
  const runRevision = (style: RevisionStyle, why: string) =>
    simulate(REVISION_LABEL[style], () => dispatch({ type: 'material/revise', id: m.id, style, why }), 'A revised version is ready. Check it before approving.');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <a href="#/approvals" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-700 hover:underline"><Icon name="back" className="h-4 w-4" /> All items</a>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={idx <= 0} onClick={() => go(`#/approvals/${mats[idx - 1]?.id}`)}>Previous</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={idx >= mats.length - 1} onClick={() => go(`#/approvals/${mats[idx + 1]?.id}`)}>Next</button>
        </div>
      </div>

      <PageTitle eyebrow={`${STAGE_INFO[m.stage].journey} · ${FORMATS[format].label} · item ${idx + 1} of ${mats.length}`} title={m.title} hint={<>{m.purpose} Planned for {/^(Today|Tomorrow|Yesterday)$/.test(relDay(m.date, state.today)) ? relDay(m.date, state.today).toLowerCase() : relDay(m.date, state.today)}.</>} />
      {readOnly ? <Note className="mb-4">This item belongs to a campaign that has ended. It is shown for reference only.</Note> : null}

      {siblings.length > 1 ? (
        <nav aria-label="Other channel versions of this step" className="mb-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">This step on each channel · each is approved on its own</p>
          <div className="flex flex-wrap gap-1.5">
            {siblings.map((x) => (
              <a key={x.id} href={`#/approvals/${x.id}`} aria-current={x.id === m.id ? 'page' : undefined}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm ${x.id === m.id ? 'border-brand-olive-600 bg-brand-olive-600 font-medium text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                {fmtLabel(x)}{x.status === 'approved' ? <Icon name="check" className="h-3.5 w-3.5" /> : <span className={`h-2 w-2 rounded-full ${x.status === 'changes' ? 'bg-rose-500' : 'bg-amber-500'}`} aria-label="needs approval" />}
              </a>
            ))}
          </div>
        </nav>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section aria-label="Preview" className="space-y-4">
          <div className="rounded-2xl bg-slate-100 p-4 sm:p-6">
            <Preview format={format} caption={v.caption} images={v.images} look={v.look} scenes={v.scenes} shop={state.business.name} />
          </div>
          <p className="flex flex-wrap items-center justify-center gap-2 text-center text-xs text-slate-600"><AutoPill f={format} /> {auto.label}</p>
          {format === 'ad' ? <AdSettings campaign={campaign} /> : null}
        </section>

        <section className="space-y-5" aria-label="Review">
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2"><StatusPill m={m} /><span className="text-sm text-slate-500">Showing version {v.n} · {v.why}</span></div>
            <p className="text-sm text-slate-600">Approving covers this {FORMATS[format].label} only: these words, {video ? 'this storyboard' : 'this picture'} and this look.{format === 'ad' ? ' Spending is approved separately in the ad settings.' : ''}</p>
            {m.reapproval ? <Note tone="warn">You approved an earlier version. This one changed, so it needs your approval again. Until then it will not go out.</Note> : null}
            {m.status === 'changes' ? (
              <Note tone="error">
                <p><strong>You sent this back:</strong> &ldquo;{m.backNote}&rdquo;</p>
                {!readOnly ? <button type="button" className="btn btn-secondary btn-sm mt-2" disabled={busy} onClick={() => runRevision(styleFromNote(m.backNote ?? ''), 'Revised from your note (simulated)')}><Icon name="sparkle" className="h-4 w-4" /> Prepare a revision from my note</button> : null}
              </Note>
            ) : null}
            {!readOnly ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" disabled={m.status === 'approved' || busy} onClick={() => { dispatch({ type: 'material/approve', id: m.id, version: v.n }); toast(`Approved version ${v.n} for ${FORMATS[format].label}.`); }}>
                  <Icon name="check" className="h-4 w-4" /> {m.status === 'approved' ? `Version ${v.n} approved` : `Approve version ${v.n}`}
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setBackOpen(true)}>Send back for changes</button>
              </div>
            ) : null}
            {revising ? <p className="flex items-center gap-2 text-sm text-slate-700" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-olive-200 border-t-brand-olive-600" /> Preparing: {revising.toLowerCase()}…</p> : null}
          </div>

          {!readOnly ? <CaptionEditor key={`cap-${m.id}-${v.n}`} m={m} disabled={busy} /> : null}

          {!readOnly ? (
            <div className="card">
              <SectionTitle title="Choose a different opening" hint="The first line is what most people read." />
              <div className="space-y-2" role="radiogroup" aria-label="Opening line">
                {m.openings.map((o) => {
                  const on = openingOf(v.caption) === o;
                  return (
                    <button key={o} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => { if (!on) { dispatch({ type: 'material/opening', id: m.id, opening: o }); toast('Opening changed. This is now a new version.', 'info'); } }}
                      className={`flex w-full min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${on ? 'border-brand-olive-600 bg-brand-olive-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <span className={`h-4 w-4 shrink-0 rounded-full border ${on ? 'border-[5px] border-brand-olive-600' : 'border-slate-400'}`} />{o.replace('{first name}', 'Nyasha')}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!readOnly ? (video
            ? <StoryboardEditor key={`sb-${m.id}-${v.n}`} m={m} busy={busy} simulate={simulate} />
            : <VisualPicker m={m} busy={busy} simulate={simulate} />) : null}

          {!readOnly ? (
            <div className="card">
              <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="font-serif text-xl">Ask for a revision of the words</h2><Simulated>Simulated revision</Simulated></div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(REVISION_LABEL) as RevisionStyle[]).map((st) => (
                  <button key={st} type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => runRevision(st, `Simulated revision: ${REVISION_LABEL[st].toLowerCase()}`)}>{REVISION_LABEL[st]}</button>
                ))}
              </div>
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

type Simulate = (label: string, run: () => void, done: string) => void;

const LOOK_ORDER: Look[] = ['original', 'warm', 'studio', 'headline'];

/** Choose the photo and a simulated look. Each change is a new version that needs approval. */
function VisualPicker({ m, busy, simulate }: { m: Material; busy: boolean; simulate: Simulate }) {
  const { dispatch, toast } = useDemo();
  const v = currentVersion(m);
  const set = (patch: { images?: string[]; look?: Look }, why: string) => { dispatch({ type: 'material/visual', id: m.id, patch, why }); toast(`${why}. Saved as version ${v.n + 1}.`, 'info'); };
  const requestNew = () => {
    const nextLook = LOOK_ORDER[(LOOK_ORDER.indexOf(v.look) + 1) % LOOK_ORDER.length];
    const pool = PRODUCTS.map((p) => p.image);
    const nextImg = pool[(pool.indexOf(v.images[0]) + 1) % pool.length];
    simulate('a new visual', () => dispatch({ type: 'material/visual', id: m.id, by: 'revision', patch: { images: [nextImg], look: nextLook }, why: 'New visual prepared (simulated)' }), 'A new visual is ready. Check it before approving.');
  };
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-xl">Picture</h2><Simulated>Simulated visuals</Simulated></div>
      <div>
        <p className="label">Photo</p>
        <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Photo">
          {PRODUCTS.map((p) => {
            const on = v.images[0] === p.image;
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} aria-label={p.name} disabled={busy} onClick={() => { if (!on) set({ images: [p.image] }, `You chose the ${p.name.toLowerCase()} photo`); }}
                className={`overflow-hidden rounded-lg border-2 ${on ? 'border-brand-olive-600' : 'border-transparent hover:border-slate-300'}`}>
                <LookSwatch src={p.image} look="original" />
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="label">Look</p>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Look">
          {LOOK_ORDER.map((l) => {
            const on = v.look === l;
            return (
              <button key={l} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => { if (!on) set({ look: l }, `You chose the ${LOOKS[l].label.toLowerCase()} look`); }}
                className={`rounded-lg border-2 p-1 text-left ${on ? 'border-brand-olive-600 bg-brand-olive-50' : 'border-transparent hover:border-slate-300'}`} title={LOOKS[l].hint}>
                <LookSwatch src={v.images[0]} look={l} />
                <span className="mt-1 block text-[11px] leading-tight text-slate-700">{LOOKS[l].label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={requestNew}><Icon name="sparkle" className="h-4 w-4" /> Request a new visual</button>
        <p className="text-xs text-slate-500">Simulated: it picks another sample photo and look. No image is generated.</p>
      </div>
    </div>
  );
}

/** Edit the video's scenes (picture, words on screen, length). Saving makes a new version. */
function StoryboardEditor({ m, busy, simulate }: { m: Material; busy: boolean; simulate: Simulate }) {
  const { dispatch, toast } = useDemo();
  const v = currentVersion(m);
  const [scenes, setScenes] = useState<Scene[]>(v.scenes ?? []);
  const dirty = JSON.stringify(scenes) !== JSON.stringify(v.scenes ?? []);
  const patch = (i: number, p: Partial<Scene>) => setScenes((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const total = scenes.reduce((a, b) => a + b.secs, 0);
  const regenerate = () => {
    const pool = PRODUCTS.map((p) => p.image);
    const shift = (v.n % (pool.length - 1)) + 1;
    const alt = ['Morning wedding: with block heels', 'Sunday service: with flats and a scarf', 'Evening out: with a cropped jacket'];
    const next = (v.scenes ?? []).map((sc, i) => ({ image: pool[(pool.indexOf(sc.image) + shift) % pool.length], text: sc.text === alt[i] ? SCENE_TEXT[i] : alt[i] ?? sc.text, secs: sc.secs }));
    simulate('a new storyboard', () => dispatch({ type: 'material/visual', id: m.id, by: 'revision', patch: { scenes: next }, why: 'New storyboard prepared (simulated)' }), 'A new storyboard is ready. Check it before approving.');
  };
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-xl">Video storyboard</h2><Simulated>Simulated storyboard</Simulated></div>
      <p className="text-sm text-slate-600">The scenes you or a video helper would film. {scenes.length} scenes, {total} seconds in total. No video is made in the prototype.</p>
      <ol className="space-y-3">
        {scenes.map((sc, i) => (
          <li key={i} className="grid grid-cols-[3.5rem_1fr] gap-3 rounded-lg border border-slate-200 p-2.5">
            <LookSwatch src={sc.image} look="original" />
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Scene ${i + 1} photo`}>
                {PRODUCTS.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={sc.image === p.image} aria-label={`Scene ${i + 1}: ${p.name}`} disabled={busy} onClick={() => patch(i, { image: p.image })}
                    className={`h-9 w-7 overflow-hidden rounded border-2 ${sc.image === p.image ? 'border-brand-olive-600' : 'border-transparent'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- fixed local lookbook file */}
                    <img src={p.image} alt="" className="h-full w-full object-cover object-top" />
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <label className="sr-only" htmlFor={`sc-${i}`}>Scene {i + 1} words on screen</label>
                <input id={`sc-${i}`} className="input !py-1.5 text-sm" value={sc.text} disabled={busy} onChange={(e) => patch(i, { text: e.target.value })} />
                <label className="sr-only" htmlFor={`scs-${i}`}>Scene {i + 1} seconds</label>
                <select id={`scs-${i}`} className="select !w-20 !py-1.5 text-sm" value={sc.secs} disabled={busy} onChange={(e) => patch(i, { secs: Number(e.target.value) })}>
                  {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}s</option>)}
                </select>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {dirty && m.status === 'approved' ? <p className="text-sm text-amber-800">Saving creates version {v.n + 1}, which needs approval again.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy || scenes.some((x) => !x.text.trim())} onClick={() => { dispatch({ type: 'material/visual', id: m.id, patch: { scenes }, why: 'You edited the storyboard' }); toast(`Storyboard saved as version ${v.n + 1}.`); }}>Save as version {v.n + 1}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty} onClick={() => setScenes(v.scenes ?? [])}>Undo changes</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || dirty} onClick={regenerate}><Icon name="sparkle" className="h-4 w-4" /> Regenerate storyboard</button>
      </div>
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
      <SectionTitle title={`Edit the words for this ${FORMATS[m.formats[0]].label}`} hint="Only this channel version changes." />
      <label htmlFor="cap" className="sr-only">Caption</label>
      <textarea id="cap" rows={7} className="input font-[inherit] text-[15px] leading-relaxed" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
      {dirty && m.status === 'approved' ? <p className="mt-2 text-sm text-amber-800">Saving creates version {v.n + 1}. You approved version {v.n}, so the new one needs approval again.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || !text.trim()} onClick={() => { dispatch({ type: 'material/caption', id: m.id, caption: text.trim(), why: 'You edited the caption' }); toast(`Saved as version ${v.n + 1}.`); }}>Save as version {v.n + 1}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty} onClick={() => setText(v.caption)}>Undo changes</button>
      </div>
    </div>
  );
}
