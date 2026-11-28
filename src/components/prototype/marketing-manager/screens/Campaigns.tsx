'use client';
// "Campaigns": what is running. Scheduling, the demo clock, publishing outcomes that
// depend on each channel's demo connection, a recoverable failure, manual share packs,
// pause and resume.
import React, { useState } from 'react';
import { FORMATS, channelById, type FormatId } from '../catalog';
import { fmtDay, fmtShort, money, relDay } from '../dates';
import { SHOWN_LABEL, campaignProgress, currentVersion, liveCampaigns, shownState, totals, type ShownState } from '../engine';
import { GOALS } from '../plan';
import { useDemo } from '../store';
import type { Campaign, Placement } from '../types';
import { Dialog, Empty, Icon, Note, PageTitle, Pill, SectionTitle } from '../ui';
import { LookSwatch } from '../previews';
import { AutoPill, CampaignJourney, DemoClock, StatePill, automation } from './shared';

const SHARE_STEPS: Partial<Record<FormatId, string[]>> = {
  wa_status: ['Save the photo to your phone (press and hold it).', 'Open WhatsApp, go to Updates and add a Status with the photo.', 'Paste the caption and post it.', 'Come back here and mark it as shared.'],
  ig_reel: ['Film the three short scenes in the video plan, or ask your video helper to edit them.', 'Open Instagram, create a Reel and add the video.', 'Paste the caption and post it.', 'Come back here and mark it as shared.'],
  tiktok_video: ['Film or edit the short styling video.', 'Open TikTok and post the video.', 'Paste the caption and post it.', 'Come back here and mark it as shared.'],
  fb_group: ['Open the Facebook Group and check its selling rules.', 'Create a post with the photo and paste the caption.', 'Come back here and mark it as shared.'],
  wa_channel: ['Open your WhatsApp Channel in the Updates tab.', 'Post the photo and paste the caption.', 'Come back here and mark it as shared.'],
};

const FILTERS: ShownState[] = ['awaiting', 'scheduled', 'published', 'manual', 'failed', 'paused'];

export function CampaignsScreen() {
  const { state } = useDemo();
  const live = liveCampaigns(state);
  const [pick, setPick] = useState<string | null>(null);
  const c = live.find((x) => x.id === pick) ?? live[0];
  const ended = state.campaigns.filter((x) => x.status === 'ended').sort((a, b) => b.endDate.localeCompare(a.endDate));
  return (
    <div>
      {live.length > 1 ? (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Live campaigns">
          {live.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === c?.id} onClick={() => setPick(x.id)}
              className={`min-h-10 shrink-0 rounded-full border px-3 text-sm ${x.id === c?.id ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white'}`}>
              {x.name} · {x.startDate > state.today ? `starts ${fmtShort(x.startDate)}` : 'running'}
            </button>
          ))}
        </div>
      ) : null}
      {c ? <ActiveCampaign key={c.id} c={c} /> : (
        <>
          <PageTitle eyebrow="Campaigns" title="Nothing running right now" />
          <Empty icon="megaphone" title="No active campaign" text={state.draft?.plan ? 'A plan is ready for you to review. Accept it and approve its items, then schedule it here.' : 'Accept a plan and approve its items. Then you can schedule it here.'} action={<a href="#/plan" className="btn btn-primary">{state.draft?.plan ? 'Review the plan' : 'Go to My plan'}</a>} />
        </>
      )}
      {ended.length ? (
        <section className="mt-8">
          <SectionTitle title="Earlier campaigns" />
          <ul className="space-y-2">
            {ended.map((e) => {
              const t = totals(state, e.id);
              return (
                <li key={e.id} className="card flex flex-wrap items-center justify-between gap-3 !py-4">
                  <div>
                    <p className="font-medium">{e.name}</p>
                    <p className="text-sm text-slate-600">{fmtShort(e.startDate)} to {fmtShort(e.endDate)} · {GOALS[e.goal].label}</p>
                  </div>
                  <p className="text-sm text-slate-700">{t.enquiries} conversations · {t.sales} recorded sales · {money(t.costs.total)} spent</p>
                  <a href={`#/results/${e.id}`} className="btn btn-secondary btn-sm">Results</a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ActiveCampaign({ c }: { c: Campaign }) {
  const { state, dispatch, toast, go } = useDemo();
  const prog = campaignProgress(state, c);
  const [filter, setFilter] = useState<ShownState | 'all'>('all');
  const [share, setShare] = useState<Placement | null>(null);
  const [connect, setConnect] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const rows = prog.pls
    .map((p) => ({ p, st: shownState(state, p), m: state.materials.find((x) => x.id === p.materialId)! }))
    .sort((a, b) => a.p.date.localeCompare(b.p.date) || a.m.id.localeCompare(b.m.id));
  const waits = (st: ShownState) => st === 'awaiting' || st === 'ready' || st === 'spend';
  const count = (st: ShownState) => rows.filter((r) => (st === 'awaiting' ? waits(r.st) : r.st === st)).length;
  const shown = filter === 'all' ? rows : rows.filter((r) => (filter === 'awaiting' ? waits(r.st) : r.st === filter));
  const status = !c.scheduled ? 'Not scheduled yet' : c.paused ? 'Paused' : state.today < c.startDate ? `Starts ${relDay(c.startDate, state.today).toLowerCase()}` : prog.finished ? 'Finished' : `Running · day ${prog.day} of ${c.plan.days}`;

  const retry = (p: Placement) => {
    setRetrying(p.id);
    window.setTimeout(() => {
      dispatch({ type: 'placement/retry', id: p.id });
      setRetrying(null);
    }, 1400);
  };

  return (
    <div>
      <PageTitle eyebrow="Campaigns" title={c.name} hint={<>{GOALS[c.goal].label} · {fmtShort(c.startDate)} to {fmtShort(c.endDate)}</>}
        action={<Pill tone={c.paused ? 'slate' : c.scheduled ? 'olive' : 'amber'} className="!text-sm">{status}</Pill>} />

      {/* Controls */}
      <section className="card mb-5">
        {!c.scheduled ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{prog.awaiting ? `${prog.awaiting} item${prog.awaiting === 1 ? ' still needs' : 's still need'} approval` : 'Everything is approved'}</p>
              <p className="text-sm text-slate-600">Scheduling sets each approved item to go out on its planned day. {prog.awaiting ? 'Items without approval wait until you approve them.' : ''} {c.plan.content.some((x) => x.cost) ? `The ${money(c.plan.content.reduce((s, x) => s + x.cost, 0))} content cost is counted when you schedule.` : ''}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {prog.awaiting ? <a href="#/approvals" className="btn btn-secondary">Review items</a> : null}
              {c.startDate > state.today && liveCampaigns(state)[0]?.id !== c.id ? <Pill tone="sky" className="self-center">Starts after your current campaign</Pill> : null}
              <button type="button" className="btn btn-primary" disabled={prog.awaiting === prog.mats.length} onClick={() => { dispatch({ type: 'campaign/schedule', id: c.id }); toast('Scheduled. Items go out on their planned days.'); }}>
                <Icon name="calendar" className="h-4 w-4" /> Schedule approved items
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <p className="font-medium">{c.paused ? 'Paused: nothing goes out and the ad stops spending.' : prog.upcoming ? `Next: ${FORMATS[prog.upcoming.format].label} on ${fmtDay(prog.upcoming.date)}` : 'Everything scheduled has been handled.'}</p>
              <p className="text-sm text-slate-600">In a real launch items go out on their own when their day comes. Here, move the demo date forward to see what would happen. Results depend on each channel&apos;s demo connection, not on pressing a button.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {c.paused
                ? <button type="button" className="btn btn-primary" onClick={() => { dispatch({ type: 'campaign/resume', id: c.id }); toast('Resumed.'); }}><Icon name="play" className="h-4 w-4" /> Resume</button>
                : <button type="button" className="btn btn-secondary" onClick={() => { dispatch({ type: 'campaign/pause', id: c.id }); toast('Paused. Nothing new goes out.', 'info'); }}><Icon name="pause" className="h-4 w-4" /> Pause</button>}
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmEnd(true)}>End campaign</button>
            </div>
          </div>
        )}
        {c.scheduled ? <DemoClock className="mt-4 lg:hidden" /> : null}
      </section>

      <section className="mb-5">
        <CampaignJourney campaign={c} />
      </section>

      {/* Status filter */}
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filter by status">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')} className={`min-h-10 shrink-0 rounded-full border px-3 text-sm ${filter === 'all' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white'}`}>All {rows.length}</button>
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`min-h-10 shrink-0 rounded-full border px-3 text-sm ${filter === f ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white'}`}>
            {SHOWN_LABEL[f]} {count(f)}
          </button>
        ))}
      </div>

      {shown.length ? (
        <ul className="space-y-2.5">
          {shown.map(({ p, st, m }) => {
            const ch = channelById(FORMATS[p.format].channel);
            return (
              <li key={p.id} className={`card !p-4 ${st === 'failed' ? 'border-rose-300' : ''}`}>
                <div className="flex gap-3">
                  <span className="w-12 shrink-0"><LookSwatch src={currentVersion(m).scenes?.[0]?.image ?? currentVersion(m).images[0]} look={currentVersion(m).look} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatePill st={st} />
                      <span className="text-sm text-slate-600">{FORMATS[p.format].label} · {relDay(p.date, state.today)}</span>
                      {st !== 'published' ? <AutoPill f={p.format} /> : null}
                    </div>
                    <p className="mt-1 font-medium">{m.title}</p>
                    {st === 'published' ? <p className="text-sm text-slate-600">{p.sharedByOwner ? 'You shared it yourself and marked it in the demo.' : `Published in the demo only. Nothing was posted to ${ch.name}.`} Version {p.publishedVersion ?? currentVersion(m).n}.</p> : null}
                    {st === 'awaiting' ? <p className="text-sm text-slate-600">{m.status === 'changes' ? 'Sent back for changes.' : m.reapproval ? 'Changed after approval.' : 'Waiting for your approval.'} It will not go out until approved.</p> : null}
                    {st === 'spend' ? <p className="text-sm text-slate-600">The ad&apos;s content is approved. It will not run or spend until you approve the paid ad settings.</p> : null}
                    {st === 'ready' ? <p className="text-sm text-slate-600">Approved. Schedule the campaign to set it going.</p> : null}
                    {st === 'scheduled' ? <p className="text-sm text-slate-600">{fmtDay(p.date)}: {automation(state.connections[ch.id], p.format).label}</p> : null}
                    {st === 'paused' ? <p className="text-sm text-slate-600">Paused with the campaign.</p> : null}
                    {st === 'manual' ? <p className="text-sm text-slate-600">{ch.name} needs you to post this yourself. The words and photo are ready.</p> : null}
                    {st === 'failed' ? <p className="text-sm text-rose-800" role="alert">{p.failReason}{(p.failures ?? 0) > 1 ? ` Tried ${p.failures} times.` : ''}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {st === 'awaiting' || st === 'spend' ? <a href={`#/approvals/${m.id}`} className="btn btn-secondary btn-sm">{st === 'spend' ? 'Review ad settings' : 'Review'}</a> : null}
                      {st === 'manual' ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setShare(p)}><Icon name="copy" className="h-4 w-4" /> Open share pack</button> : null}
                      {st === 'failed' ? (
                        <>
                          {state.connections[ch.id] !== 'connected' ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setConnect(ch.id)}>Reconnect {ch.name} (demo)</button> : null}
                          <button type="button" className="btn btn-secondary btn-sm" disabled={retrying === p.id || c.paused} onClick={() => retry(p)}>
                            {retrying === p.id ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" /> Trying…</> : 'Try again now'}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty title={`Nothing is ${filter === 'all' ? 'here' : SHOWN_LABEL[filter as ShownState].toLowerCase()}`} text="Choose another filter to see the rest." />
      )}

      <section className="mt-8">
        <SectionTitle title="What happened" hint="Everything recorded in this demo, newest first." />
        <ul className="space-y-1.5 text-sm">
          {state.log.slice(0, 10).map((l) => <li key={l.id} className="flex gap-3"><span className="w-20 shrink-0 text-slate-500">{fmtShort(l.date)}</span><span className="text-slate-700">{l.text}</span></li>)}
        </ul>
      </section>

      <SharePack placement={share} onClose={() => setShare(null)} />

      <Dialog open={!!connect} onClose={() => setConnect(null)} title={`Reconnect ${connect ? channelById(connect as never).name : ''}`}
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setConnect(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => { if (connect) dispatch({ type: 'connection/set', channel: connect as never, status: 'connected' }); setConnect(null); toast('Connected in the demo. Now try the item again.'); }}>Pretend to reconnect</button></>}>
        <Note tone="warn" className="mb-3">This is a pretend connection. No account is contacted, no password is asked for, and nothing is connected for real.</Note>
        <p className="text-slate-700">In a real launch you would sign in to Facebook here and give permission to post on your Page. Connections can expire, for example when a password changes, which is what happened in this demo.</p>
      </Dialog>

      <Dialog open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End this campaign?"
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setConfirmEnd(false)}>Keep it running</button><button type="button" className="btn btn-primary" onClick={() => { const others = liveCampaigns(state).length > 1; dispatch({ type: 'campaign/end', id: c.id }); setConfirmEnd(false); go(`#/results/${c.id}`); toast(others ? 'Campaign ended. Here are its results.' : 'Campaign ended. Here are its results, and a recommended next plan is ready for you.', 'info'); }}>End campaign</button></>}>
        <p>Items that have not gone out are withdrawn and the ad stops. What already happened stays in your results.</p>
      </Dialog>
    </div>
  );
}

function SharePack({ placement, onClose }: { placement: Placement | null; onClose: () => void }) {
  const { state, dispatch, toast } = useDemo();
  const m = placement ? state.materials.find((x) => x.id === placement.materialId) : null;
  if (!placement || !m) return null;
  const v = currentVersion(m);
  const caption = v.caption.replaceAll('{first name}', '').replace(/^Hi ,\s*/, 'Hi, ');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      toast('Caption copied.');
    } catch {
      const el = document.getElementById('share-caption') as HTMLTextAreaElement | null;
      el?.select();
      toast('Select and copy the caption manually.', 'warn');
    }
  };
  const ch = channelById(FORMATS[placement.format].channel);
  return (
    <Dialog open onClose={onClose} title={`Share pack: ${FORMATS[placement.format].label}`} wide
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Not yet</button><button type="button" className="btn btn-primary" onClick={() => { dispatch({ type: 'placement/shared', id: placement.id }); onClose(); toast('Marked as shared in the demo.'); }}><Icon name="check" className="h-4 w-4" /> I shared it, mark as shared</button></>}>
      <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
        <div>
          {v.scenes ? (
            <ol className="grid grid-cols-3 gap-1.5 sm:grid-cols-1">
              {v.scenes.map((sc, i) => <li key={i}><LookSwatch src={sc.image} look="original" /><p className="mt-0.5 text-[11px] leading-tight text-slate-600">{i + 1}. {sc.text} · {sc.secs}s</p></li>)}
            </ol>
          ) : <LookSwatch src={v.images[0]} look={v.look} />}
          <p className="mt-1 text-center text-xs text-slate-500">{v.scenes ? 'Approved storyboard' : 'Approved picture'} (version {m.approvedVersion ?? v.n})</p>
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between"><label htmlFor="share-caption" className="label !mb-0">Caption</label><button type="button" className="btn btn-secondary btn-sm" onClick={copy}><Icon name="copy" className="h-4 w-4" /> Copy caption</button></div>
            <textarea id="share-caption" readOnly rows={6} className="input text-sm" value={caption} />
          </div>
          <div>
            <p className="label">Steps</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">{(SHARE_STEPS[placement.format] ?? ['Post it on ' + ch.name + '.', 'Come back here and mark it as shared.']).map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
          <Note>Marking it as shared only updates this demo. {ch.name} can not tell us it was posted, so reach for this item is an estimate.</Note>
        </div>
      </div>
    </Dialog>
  );
}
