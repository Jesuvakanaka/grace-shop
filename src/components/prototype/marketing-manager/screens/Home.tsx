'use client';
// "My marketing": answers the owner's five questions at a glance.
import React from 'react';
import { fmtDay, money, num, relDay } from '../dates';
import { activeCampaign, campaignProgress, dueFollowUps, goalLabel, managerUpdate, nextStep, totals, waitingCustomers } from '../engine';
import { productById } from '../catalog';
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
  const lastEnded = [...state.campaigns].filter((x) => x.status === 'ended').sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const scope = c && c.scheduled ? c : lastEnded;
  const t = scope ? totals(state, scope.id) : null;
  const pendingMats = c ? state.materials.filter((m) => m.campaignId === c.id && m.status !== 'approved') : [];

  return (
    <div>
      <header className="mb-6">
        <p className="brand-label text-brand-olive-700">My marketing</p>
        <h1 className="font-serif text-3xl leading-tight sm:text-4xl">Here is where things stand</h1>
        <p className="mt-1 text-slate-600">{fmtDay(state.today)} in the demo{state.onboarding === 'skipped' ? ' · exploring with example answers' : ''}</p>
      </header>

      {/* The one next action. */}
      <section className="mb-5 overflow-hidden rounded-2xl bg-brand-olive-700 text-white shadow-md" aria-labelledby="next-title">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-lime-200">What to do next</p>
            <h2 id="next-title" className="mt-1 font-serif text-2xl sm:text-3xl">{step.title}</h2>
            <p className="mt-1 max-w-xl text-brand-olive-50">{step.detail}</p>
          </div>
          <a href={step.href} className="btn shrink-0 bg-brand-cream text-brand-ink hover:bg-white">{step.cta} <Icon name="arrow" className="h-4 w-4" /></a>
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
        <QCard q="What is it doing for me?" href={c ? '#/campaigns' : '#/plan'} link={c ? 'See the campaign' : 'Set a goal'}>
          {c && prog ? (
            <div className="space-y-3">
              <p><span className="text-slate-500">Current goal:</span> <strong>{goalLabel(c.goal)}</strong></p>
              <p><span className="text-slate-500">Campaign:</span> {c.name} · {c.scheduled ? (state.today < c.startDate ? `starts ${relDay(c.startDate, state.today).toLowerCase()}` : prog.finished ? 'finished' : `day ${prog.day} of ${c.plan.days}`) : 'not scheduled yet'}{c.paused ? ' · paused' : ''}</p>
              <CampaignJourney campaign={c} compact />
            </div>
          ) : (
            <p>No campaign is running. {state.draft?.plan ? 'A new plan is waiting for you to review.' : 'Choose a goal and your marketing manager prepares a plan.'}</p>
          )}
        </QCard>

        <QCard q="What needs my approval?" href="#/approvals" link="Go to approvals">
          {pendingMats.length ? (
            <ul className="space-y-1.5">
              {pendingMats.slice(0, 4).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{m.title}</span>
                  <span className={`shrink-0 text-xs ${m.status === 'changes' ? 'text-rose-700' : m.reapproval ? 'text-amber-800' : 'text-slate-500'}`}>{m.status === 'changes' ? 'Sent back' : m.reapproval ? 'Changed, approve again' : 'Waiting'}</span>
                </li>
              ))}
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
              {due.length ? <li className="text-slate-600">{due.length} follow-up{due.length === 1 ? '' : 's'} due today.</li> : null}
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
                <div className="rounded-lg bg-slate-50 px-2 py-2"><dt className="text-xs text-slate-500">Conversations</dt><dd className="font-serif text-2xl">{num(t.enquiries)}</dd></div>
                <div className="rounded-lg bg-slate-50 px-2 py-2"><dt className="text-xs text-slate-500">Recorded sales</dt><dd className="font-serif text-2xl">{num(t.sales)}</dd></div>
                <div className="rounded-lg bg-slate-50 px-2 py-2"><dt className="text-xs text-slate-500">Spent</dt><dd className="font-serif text-2xl">{money(t.costs.total)}</dd></div>
              </dl>
            </div>
          ) : (
            <p>Results appear once your first item goes out.</p>
          )}
        </QCard>
      </div>
    </div>
  );
}
