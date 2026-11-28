'use client';
// "My marketing": answers the owner's five questions at a glance.
import React from 'react';
import { fmtDay, money, num, relDay } from '../dates';
import { activeCampaign, adNeedsApproval, campaignProgress, dueFollowUps, goalLabel, liveCampaigns, managerUpdate, nextStep, totals, uncreditedSales, waitingCustomers } from '../engine';
import { FORMATS, productById } from '../catalog';
import { useDemo } from '../store';
import { Icon, Simulated } from '../ui';
import { CampaignJourney } from './shared';

function QCard({ q, children, href, link }: { q: string; children: React.ReactNode; href: string; link: string }) {
  return (
    <section className="card flex flex-col" aria-label={q}>
      <h2 className="font-serif text-xl text-slate-900">{q}</h2>
      <div className="mt-2 flex-1 text-sm text-slate-700">{children}</div>
      <a href={href} className="mt-3 inline-flex min-h-10 items-center gap-1 self-start text-sm font-medium text-brand-olive-700 underline-offset-4 hover:underline">{link} <Icon name="arrow" className="h-4 w-4" /></a>
    </section>
  );
}

export function HomeScreen() {
  const { state } = useDemo();
  const step = nextStep(state);
  const c = activeCampaign(state);
  const prog = c ? campaignProgress(state, c) : null;
  const waiting = waitingCustomers(state);
  const due = dueFollowUps(state);
  const lastEnded = [...state.campaigns].filter((x) => x.status === 'ended' && !x.cancelled).sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const scope = c && c.scheduled ? c : lastEnded;
  const t = scope ? totals(state, scope.id) : null;
  const other = scope ? uncreditedSales(state, scope.id) : null;
  const live = liveCampaigns(state);
  const liveIds = new Set(live.map((x) => x.id));
  const pendingMats = state.materials.filter((m) => liveIds.has(m.campaignId) && m.status !== 'approved');
  const adWaiting = live.filter((x) => adNeedsApproval(state, x));
  const following = live.filter((x) => x.id !== c?.id);

  return (
    <div>
      <header className="mb-4 sm:mb-6">
        <p className="brand-label text-brand-olive-700">My marketing</p>
        <h1 className="font-serif text-2xl leading-tight sm:text-4xl">Here is where things stand</h1>
        <p className="mt-1 text-sm text-slate-600 sm:text-base">{fmtDay(state.today)} in the demo{state.onboarding === 'skipped' ? ' · exploring with example answers' : ''}</p>
      </header>

      {/* The one next action. */}
      <section className="mb-5 overflow-hidden rounded-2xl bg-brand-olive-700 text-white shadow-md" aria-labelledby="next-title">
        <div className="flex flex-col gap-3 p-4 sm:gap-4 sm:p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-lime-200">What to do next</p>
            <h2 id="next-title" className="mt-1 font-serif text-xl leading-snug sm:text-3xl">{step.title}</h2>
            <p className="mt-1 max-w-xl text-sm text-brand-olive-50 sm:text-base">{step.detail}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <a href={step.href} className="btn bg-brand-cream text-brand-ink hover:bg-white">{step.cta} <Icon name="arrow" className="h-4 w-4" /></a>
            {step.also ? <a href={step.also.href} className="btn border border-brand-cream/70 text-brand-cream hover:bg-brand-olive-800">{step.also.cta}</a> : null}
          </div>
        </div>
      </section>

      {/* Manager update. */}
      <section className="card mb-5" aria-labelledby="update-title">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="update-title" className="font-serif text-xl">Update from your marketing manager</h2>
          <Simulated>Simulated update from sample data</Simulated>
        </div>
        <div className="space-y-1.5 text-slate-700">
          {managerUpdate(state).map((l) => <p key={l}>{l}</p>)}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <QCard q="What is it doing for me?" href={c ? '#/campaigns' : '#/plan'} link={c ? 'See the campaign' : state.draft?.plan ? 'Review the plan' : 'Go to My plan'}>
          {c && prog ? (
            <div className="space-y-3">
              <p><span className="text-slate-500">Current goal:</span> <strong>{goalLabel(c.goal)}</strong></p>
              <p><span className="text-slate-500">Campaign:</span> {c.name} · {c.scheduled ? (state.today < c.startDate ? `starts ${relDay(c.startDate, state.today).toLowerCase()}` : prog.finished ? 'finished' : `day ${prog.day} of ${c.plan.days}`) : 'not scheduled yet'}{c.paused ? ' · paused' : ''}</p>
              <CampaignJourney campaign={c} compact />
              {following.map((x) => <p key={x.id} className="text-slate-600"><span className="text-slate-500">Next:</span> {x.name} starts {fmtDay(x.startDate)}, after this one.</p>)}
            </div>
          ) : (
            <p>No campaign is running. {state.draft?.plan ? `Your marketing manager prepared "${state.draft.plan.name}" for you to review. You can also choose a different goal.` : 'Ask for a recommended plan, or choose a goal yourself.'}</p>
          )}
        </QCard>

        <QCard q="What needs my approval?" href={!pendingMats.length && !adWaiting.length && state.draft?.plan ? '#/plan' : '#/approvals'} link={!pendingMats.length && !adWaiting.length && state.draft?.plan ? 'Review the plan' : 'Go to approvals'}>
          {pendingMats.length || adWaiting.length || state.draft?.plan ? (
            <ul className="space-y-1.5">
              {state.draft?.plan ? <li className="flex items-center justify-between gap-2"><span className="truncate">Plan: {state.draft.plan.name}</span><span className="shrink-0 text-xs text-slate-500">To review</span></li> : null}
              {adWaiting.map((x) => <li key={x.id} className="flex items-center justify-between gap-2"><span className="truncate">Paid ad spending for {x.name}</span><span className="shrink-0 text-xs text-amber-800">Not approved</span></li>)}
              {pendingMats.slice(0, 4).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{FORMATS[m.formats[0]].label}: {m.title}</span>
                  <span className={`shrink-0 text-xs ${m.status === 'changes' ? 'text-rose-700' : m.reapproval ? 'text-amber-800' : 'text-slate-500'}`}>{m.status === 'changes' ? 'Sent back' : m.reapproval ? 'Changed, approve again' : 'Waiting'}</span>
                </li>
              ))}
              {pendingMats.length > 4 ? <li className="text-slate-500">and {pendingMats.length - 4} more</li> : null}
            </ul>
          ) : (
            <p>Nothing is waiting for you. Nothing goes out without your approval.</p>
          )}
        </QCard>

        <QCard q="Are any customers waiting?" href="#/customers" link="Open customers">
          {waiting.length || due.length ? (
            <ul className="space-y-1.5">
              {waiting.slice(0, 3).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span className="truncate"><strong className="font-medium">{state.customers.find((x) => x.id === e.customerId)?.name}</strong> · {productById(e.productId).name}</span>
                  <span className="shrink-0 text-xs text-amber-800">{e.stage === 'new' ? 'New' : 'Waiting for you'}</span>
                </li>
              ))}
              {waiting.length > 3 ? <li className="text-slate-500">and {waiting.length - 3} more waiting</li> : null}
              {due.length ? <li className="text-slate-600">{due.length} follow-up{due.length === 1 ? '' : 's'} due.</li> : null}
            </ul>
          ) : (
            <p>No one is waiting. New WhatsApp enquiries appear here.</p>
          )}
        </QCard>

        <QCard q="How is my marketing performing?" href="#/results" link="See results">
          {t && scope ? (
            <div>
              <p className="mb-3 text-slate-600">{scope.status === 'active' ? 'This campaign so far' : `Last campaign: ${scope.name}`}</p>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 px-2 py-2"><dt className="text-xs text-slate-500">Recorded conversations</dt><dd className="font-serif text-2xl">{num(t.enquiries)}</dd></div>
                <div className="rounded-lg bg-slate-50 px-2 py-2"><dt className="text-xs text-slate-500">Recorded sales</dt><dd className="font-serif text-2xl">{num(t.sales)}</dd></div>
                <div className="rounded-lg bg-slate-50 px-2 py-2"><dt className="text-xs text-slate-500">Spent</dt><dd className="font-serif text-2xl">{money(t.costs.total)}</dd></div>
              </dl>
              {other?.count ? <p className="mt-2 text-xs text-slate-600">{other.count === 1 ? '1 other sale' : `${other.count} other sales`} in this period {other.count === 1 ? 'is' : 'are'} not credited to this campaign.</p> : null}
            </div>
          ) : (
            <p>Results appear once your first item goes out.</p>
          )}
        </QCard>
      </div>
    </div>
  );
}
