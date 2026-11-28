'use client';
// "My plan": the manager's recommended plan (or one from the owner's goal), led by a compact
// decision summary with the reasoning, channels, schedule, costs and outcomes one tap away.
// Accepting never ends a running campaign unless the owner explicitly chooses to replace it.
import React, { useState } from 'react';
import { FORMATS, WHATSAPP_RATE, channelById, productById, type ChannelId } from '../catalog';
import { addDays, fmtDay, fmtShort, money, num } from '../dates';
import { liveCampaigns, planCostsFor, reducer, scriptedConversations, shownState } from '../engine';
import { GOALS, GOAL_ORDER, OPTIONAL_CHANNELS, STAGE_INFO, planEstimate, planSteps, recipientsFor, reshapePlan, roundRange } from '../plan';
import { useDemo } from '../store';
import type { Campaign, GoalId, GoalInput, Plan } from '../types';
import { Dialog, Field, Icon, Note, PageTitle, Pill, SectionTitle, Simulated, Working } from '../ui';
import { AutoPill } from './shared';

const PREP_STEPS = ['Reading your business answers', 'Choosing products and the right customers', 'Picking channels that suit the goal', 'Scheduling the steps and checking the budget'];

export function PlanScreen() {
  const { state, dispatch, toast } = useDemo();
  const [preparing, setPreparing] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const draft = state.draft;
  const live = liveCampaigns(state);

  const prepare = (variant: number, label: string) => {
    setPreparing(label);
    window.setTimeout(() => {
      dispatch({ type: 'draft/plan', variant });
      setPreparing(null);
      toast(variant === 0 ? 'Your plan is ready to review.' : 'Here is an alternative plan.');
    }, 2200);
  };

  const start = (input: GoalInput) => {
    setChanging(false);
    dispatch({ type: 'draft/start', input });
    prepare(0, 'Preparing your plan');
  };

  const recommend = () => {
    setPreparing('Preparing a recommended plan');
    window.setTimeout(() => {
      const next = reducer(state, { type: 'draft/recommend' });
      dispatch({ type: 'draft/recommend' });
      setPreparing(null);
      toast(next.draft?.plan ? 'A recommended plan is ready to review.' : 'Nothing new to recommend while your campaigns cover the likely goals. Choose a goal yourself instead.', next.draft?.plan ? 'ok' : 'info');
    }, 2200);
  };

  const title = draft?.plan && !changing ? (draft.recommended ? 'Recommended next campaign' : 'Your proposed plan') : changing ? 'Choose a different goal' : live.length ? 'Your plan' : 'Plan your next campaign';
  const hint = draft?.plan && !changing
    ? `${draft.recommended ? 'Your marketing manager prepared this on its own.' : 'Prepared from the goal you chose.'} Check the summary, open any detail, change what you like, then accept it. Nothing goes out until you also approve each item.`
    : 'Tell your marketing manager what you want to achieve, or ask it to recommend a plan.';

  return (
    <div>
      <PageTitle eyebrow="My plan" title={title} hint={hint} />

      {preparing ? (
        <Working label={`${preparing}…`} steps={PREP_STEPS} />
      ) : draft?.plan && !changing ? (
        <ProposedPlan plan={draft.plan} recommended={draft.recommended} onAlternative={() => prepare(draft.plan!.variant + 1, 'Preparing an alternative')} onChangeGoal={() => setChanging(true)} />
      ) : (
        <>
          {live.map((c) => <CurrentPlan key={c.id} c={c} />)}
          {!draft?.plan && !changing ? (
            <section className="card mb-5 flex flex-col gap-3 border-brand-olive-200 bg-brand-olive-50/60 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-slate-900">Not sure what to aim for?</p>
                <p className="text-sm text-slate-600">Your marketing manager can look at your results and customers and recommend the next campaign.</p>
              </div>
              <button type="button" className="btn btn-primary shrink-0" onClick={recommend}><Icon name="sparkle" className="h-4 w-4" /> Recommend a plan</button>
            </section>
          ) : null}
          <GoalForm key={draft ? 'd' : 'n'} initial={draft?.input} onSubmit={start} hasActive={live.length > 0} onCancel={changing ? () => setChanging(false) : undefined} />
        </>
      )}
    </div>
  );
}

function GoalForm({ initial, onSubmit, hasActive, onCancel }: { initial?: GoalInput; onSubmit: (i: GoalInput) => void; hasActive: boolean; onCancel?: () => void }) {
  const { state } = useDemo();
  const [goal, setGoal] = useState<GoalId | null>(initial?.goal ?? null);
  const [weeks, setWeeks] = useState<1 | 2 | 4>(initial?.weeks ?? 2);
  const [budget, setBudget] = useState<number>(initial?.budget ?? Math.round((state.business.monthlyBudget * 2) / 4));
  const [touched, setTouched] = useState(!!initial);
  const pickWeeks = (w: 1 | 2 | 4) => {
    setWeeks(w);
    if (!touched) setBudget(Math.round((state.business.monthlyBudget * w) / 4));
  };
  return (
    <section className="card" aria-labelledby="goal-title">
      {hasActive ? <SectionTitle title="Plan what comes next" hint="Your current campaign keeps running. When you accept a new plan, you choose whether it starts after the current one or replaces it." /> : null}
      {onCancel ? <Note className="mb-4">Preparing a plan for a different goal replaces the recommended plan. You can ask for a recommendation again later.</Note> : null}
      {initial?.fromRecommendation && !onCancel ? <Note tone="ok" className="mb-4">Started from the recommendation: <strong>{initial.fromRecommendation}</strong>. Change anything before preparing the plan.</Note> : null}
      <fieldset>
        <legend id="goal-title" className="mb-2 font-medium text-slate-900">1. What do you want to achieve?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {GOAL_ORDER.map((g) => (
            <label key={g} className={`flex min-h-[76px] cursor-pointer gap-3 rounded-xl border p-3.5 ${goal === g ? 'border-brand-olive-600 bg-brand-olive-50 ring-1 ring-brand-olive-600' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <input type="radio" name="goal" className="mt-1 h-4 w-4 accent-brand-olive-600" checked={goal === g} onChange={() => setGoal(g)} />
              <span><span className="block font-medium text-slate-900">{GOALS[g].label}</span><span className="block text-sm text-slate-600">{GOALS[g].hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-2 font-medium text-slate-900">2. For how long?</legend>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1" role="radiogroup">
          {([1, 2, 4] as const).map((w) => (
            <button key={w} type="button" role="radio" aria-checked={weeks === w} onClick={() => pickWeeks(w)} className={`min-h-10 rounded-md px-4 text-sm ${weeks === w ? 'bg-brand-olive-600 font-medium text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
              {w} week{w === 1 ? '' : 's'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-slate-500">{hasActive ? `Starts after your current campaign, or tomorrow (${fmtDay(addDays(state.today, 1))}) if you choose to replace it.` : `Starts tomorrow in the demo (${fmtDay(addDays(state.today, 1))}).`}</p>
      </fieldset>

      <div className="mt-6">
        <Field label="3. Budget for this period (US dollars)" htmlFor="plan-budget" hint={`Your monthly budget is ${money(state.business.monthlyBudget)}, so ${weeks} week${weeks === 1 ? '' : 's'} is about ${money(Math.round((state.business.monthlyBudget * weeks) / 4))}. The plan never goes over what you set.`}>
          <div className="flex items-center gap-2">
            <span className="text-lg text-slate-600">$</span>
            <input id="plan-budget" type="number" min={0} step={5} inputMode="numeric" className="input max-w-40" value={budget} onChange={(e) => { setTouched(true); setBudget(Math.max(0, Number(e.target.value) || 0)); }} />
          </div>
        </Field>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={!goal} onClick={() => goal && onSubmit({ goal, weeks, budget, fromRecommendation: onCancel ? undefined : initial?.fromRecommendation })}>
          <Icon name="sparkle" className="h-4 w-4" /> Prepare my plan
        </button>
        {onCancel ? <button type="button" className="btn btn-ghost" onClick={onCancel}>Back to the recommended plan</button> : null}
        {!goal ? <span className="text-sm text-slate-500">Choose a goal first.</span> : <Simulated>The plan is simulated from templates</Simulated>}
      </div>
    </section>
  );
}

function CurrentPlan({ c }: { c: Campaign }) {
  const { state } = useDemo();
  const costs = planCostsFor(state, c.plan);
  const later = c.startDate > state.today;
  return (
    <section className="card mb-5" aria-label={`Accepted plan: ${c.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-olive-700">Accepted plan · {later ? `starts ${fmtShort(c.startDate)}` : 'running'}</p>
          <h2 className="font-serif text-2xl">{c.name}</h2>
          <p className="text-sm text-slate-600">{GOALS[c.goal].label} · {fmtShort(c.startDate)} to {fmtShort(c.endDate)} · estimated {money(costs.total)} of {money(c.plan.budget)}</p>
        </div>
        <a href="#/campaigns" className="btn btn-secondary btn-sm">See campaign</a>
      </div>
      <p className="mt-3 text-slate-700"><strong>Message:</strong> {c.plan.message}</p>
    </section>
  );
}

/** A collapsed detail section with a one-line summary, so the plan leads with the decision. */
function Details({ title, summary, children, id }: { title: string; summary: React.ReactNode; children: React.ReactNode; id: string }) {
  return (
    <details className="card group !p-0" id={id}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-serif text-xl text-slate-900">{title}</span>
          <span className="block text-sm text-slate-600">{summary}</span>
        </span>
        <span className="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 group-open:bg-slate-800 group-open:text-white">
          <span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <div className="border-t border-slate-100 px-5 pb-5 pt-4">{children}</div>
    </details>
  );
}

function ProposedPlan({ plan, recommended, onAlternative, onChangeGoal }: { plan: Plan; recommended?: string; onAlternative: () => void; onChangeGoal: () => void }) {
  const { state, dispatch, go, toast } = useDemo();
  const [editing, setEditing] = useState(false);
  const [confirmAlt, setConfirmAlt] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const recipients = recipientsFor(state.customers);
  const costs = planCostsFor(state, plan);
  const over = costs.total > plan.budget;
  const est = planEstimate(plan, recipients);
  const steps = planSteps(plan);
  const end = addDays(plan.startDate, plan.days - 1);
  const live = liveCampaigns(state);
  const lastLive = [...live].sort((a, b) => a.endDate.localeCompare(b.endDate)).at(-1);
  const tomorrow = addDays(state.today, 1);
  const afterStart = [lastLive ? addDays(lastLive.endDate, 1) : plan.startDate, tomorrow].sort().at(-1)!;
  const unknown = (['delivery', 'returns', 'payment'] as const).filter((k) => state.business[k] === null);
  const edit = (patch: Partial<Plan>) => dispatch({ type: 'draft/edit', plan: reshapePlan(plan, patch, recipients, state.business.areas) });
  const scripted = scriptedConversations(plan);
  const formats = steps.flatMap((s) => s.formats);
  const manual = formats.filter((f) => !FORMATS[f].auto).length;
  const hasAds = costs.adDays > 0;
  const unsent = live.flatMap((c) => state.placements.filter((p) => p.campaignId === c.id && shownState(state, p) !== 'published')).length;

  const alongStart = [plan.startDate, tomorrow].sort().at(-1)!;
  const liveCosts = live.map((c) => ({ c, total: planCostsFor(state, c.plan).total }));
  const combined = liveCosts.reduce((n, x) => n + x.total, 0) + costs.total;
  const accept = (mode: 'after' | 'alongside' | 'replace') => {
    dispatch({ type: 'draft/accept', mode });
    setConfirmAccept(false);
    go('#/approvals');
    toast(!live.length ? 'Plan accepted. Your campaign items are ready for approval.'
      : mode === 'after' ? `Plan accepted. It starts on ${fmtShort(afterStart)}, after your current campaign. Its items are ready for approval.`
      : mode === 'alongside' ? `Plan accepted. It starts on ${fmtShort(alongStart)} and runs alongside your current campaign.`
      : 'Plan accepted. The current campaign has ended and the new one starts tomorrow.');
  };

  return (
    <div className="space-y-4">
      {/* The decision, in one card. */}
      <section className="card">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="lime">{GOALS[plan.goal].label}</Pill>
          <Simulated>{recommended ? 'Recommended by your marketing manager (simulated)' : 'Simulated plan'}</Simulated>
          {plan.variant > 0 ? <Pill>Alternative {plan.variant + 1}</Pill> : null}
          {plan.edited ? <Pill tone="sky">Edited by you</Pill> : null}
        </div>
        <h2 className="mt-2 font-serif text-3xl">{plan.name}</h2>
        <p className="mt-1 text-slate-700">Promote <strong>{plan.collectionName}</strong> with the message <span className="font-serif text-lg text-brand-olive-800">&ldquo;{plan.message}&rdquo;</span></p>
        {recommended ? <p className="mt-3 rounded-lg bg-brand-olive-50 px-3.5 py-2.5 text-sm text-brand-olive-900"><strong>Why this plan:</strong> {recommended}</p> : plan.fromRecommendation ? <p className="mt-3 text-sm text-slate-600">Prepared from the recommendation: <strong>{plan.fromRecommendation}</strong></p> : null}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <div><dt className="text-xs uppercase tracking-wider text-slate-500">When</dt><dd className="font-medium">{fmtShort(afterStart)} to {fmtShort(addDays(afterStart, plan.days - 1))}</dd><dd className="text-xs text-slate-500">{plan.days} days{live.length ? ', after your current campaign' : ''}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-slate-500">Cost</dt><dd className={`font-medium ${over ? 'text-rose-700' : ''}`}>{money(costs.total)} of {money(plan.budget)}</dd><dd className="text-xs text-slate-500">{hasAds ? `${money(costs.ads)} of it paid ads` : 'No paid ads'}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-slate-500">Channels</dt><dd className="font-medium">{plan.channels.length}</dd><dd className="text-xs text-slate-500">{plan.channels.map((c) => channelById(c.id).name).join(', ')}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-slate-500">You approve</dt><dd className="font-medium">{formats.length} items</dd><dd className="text-xs text-slate-500">{manual ? `${manual} you share yourself` : 'All posted for you'}{hasAds ? ', plus ad spending' : ''}</dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={over || editing} onClick={() => (live.length ? setConfirmAccept(true) : accept('after'))}><Icon name="check" className="h-4 w-4" /> Accept plan</button>
          <button type="button" className={`btn ${editing ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEditing(!editing)}><Icon name="edit" className="h-4 w-4" /> {editing ? 'Done editing' : 'Edit plan'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => (plan.edited ? setConfirmAlt(true) : onAlternative())}><Icon name="sparkle" className="h-4 w-4" /> Show me an alternative</button>
          <button type="button" className="btn btn-secondary" onClick={onChangeGoal}>Change the goal</button>
          <button type="button" className="btn btn-ghost" onClick={() => { dispatch({ type: 'draft/discard' }); toast('Plan discarded.', 'info'); }}>Discard</button>
        </div>
        {over ? <Note tone="error" className="mt-3">This plan costs {money(costs.total - plan.budget)} more than your budget. Lower the daily ad amount, remove a channel or raise the budget.</Note> : null}
        {unknown.length ? (
          <p className="mt-3 text-sm text-amber-800">
            Your {unknown.length > 1 ? `${unknown.slice(0, -1).join(', ')} and ${unknown[unknown.length - 1]}` : unknown[0]} {unknown.length === 1 ? 'policy is' : 'policies are'} unknown, so no material mentions {unknown.length === 1 ? 'it' : 'them'}. <a className="underline" href="#/settings">Add them in Business settings</a>.
          </p>
        ) : null}
      </section>

      {editing ? <EditPanel plan={plan} edit={edit} /> : null}

      <Details id="plan-audience" title="Who it is for and why" summary={`${plan.productIds.length} pieces from ${plan.collectionName}, for ${plan.audience.split('.')[0].replace(/^./, (x) => x.toLowerCase())}.`}>
        <div className="grid gap-5 lg:grid-cols-2">
          <ul className="grid grid-cols-3 gap-2">
            {plan.productIds.map((id) => {
              const p = productById(id);
              return (
                <li key={id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element -- fixed local lookbook file */}
                  <img src={p.image} alt={p.name} className="aspect-[3/4] w-full object-cover object-top" />
                  <p className="px-2 py-1.5 text-xs leading-tight">{p.name}<br /><span className="text-slate-500">{money(p.price)} sample price</span></p>
                </li>
              );
            })}
          </ul>
          <div className="space-y-3">
            <div><p className="label">Who it is for</p><p className="text-slate-700">{plan.audience}</p></div>
            <div><p className="label">Reason to buy</p><p className="text-slate-700">{plan.reason}</p></div>
          </div>
        </div>
      </Details>

      <Details id="plan-channels" title="Channels and how each item goes out" summary={`${formats.length - manual} posted for you, ${manual} shared by you. Shown the same way on approvals and the schedule.`}>
        <ul className="divide-y divide-slate-200">
          {plan.channels.map((ch) => {
            const info = channelById(ch.id);
            const fs = [...new Set(formats.filter((f) => FORMATS[f].channel === ch.id))];
            return (
              <li key={ch.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="min-w-44 font-medium">{info.name}</div>
                <div className="flex-1">
                  <p className="text-sm text-slate-700">{ch.why}</p>
                  {fs.length ? (
                    <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5 text-sm text-slate-600">
                      {fs.map((f) => <li key={f} className="flex items-center gap-1.5">{FORMATS[f].label} <AutoPill f={f} /></li>)}
                    </ul>
                  ) : <p className="mt-1 text-xs text-slate-500">Runs the paid ad; see the schedule.</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </Details>

      <Details id="plan-schedule" title="Schedule" summary={`${steps.length} steps from discovery to follow-up, ${fmtShort(plan.startDate)} to ${fmtShort(end)}${live.length ? ' (moves later if it follows your current campaign)' : ''}.`}>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s.stage} className="flex gap-3">
              <div className="flex w-16 shrink-0 flex-col items-center rounded-lg bg-slate-50 py-2 text-center">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">Day {Math.round((Date.parse(s.date) - Date.parse(plan.startDate)) / 86_400_000) + 1}</span>
                <span className="text-sm font-medium">{fmtShort(s.date)}</span>
              </div>
              <div className="min-w-0 flex-1 border-b border-slate-100 pb-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-olive-700">{i + 1}. {STAGE_INFO[s.stage].journey}</p>
                <p className="font-medium">{STAGE_INFO[s.stage].label}: {productById(s.productId).name}</p>
                <p className="text-sm text-slate-600">{STAGE_INFO[s.stage].what}</p>
                <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5 text-sm text-slate-600">
                  {s.formats.map((f) => <li key={f} className="flex items-center gap-1.5">{FORMATS[f].label} <AutoPill f={f} /></li>)}
                </ul>
              </div>
            </li>
          ))}
        </ol>
        {hasAds ? <p className="mt-2 text-sm text-slate-600">If you approve the ad and its spending, it runs every day of the campaign, up to {money(costs.ads)} in total.</p> : null}
      </Details>

      <Details id="plan-costs" title="Costs" summary={`${money(costs.total)} in total: ${money(costs.ads)} ads, ${money(costs.messaging)} messaging, ${money(costs.content)} content. ${money(plan.budget - costs.total)} left.`}>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-200">
            <tr><th scope="row" className="py-2 pr-3 text-left font-normal">Advertising<br /><span className="text-xs text-slate-500">{costs.adDays ? `${money(plan.adDaily)} a day for ${costs.adDays} days, only once you approve the spending` : 'No paid ads in this plan'}</span></th><td className="py-2 text-right font-medium">{money(costs.ads)}</td></tr>
            <tr><th scope="row" className="py-2 pr-3 text-left font-normal">Messaging<br /><span className="text-xs text-slate-500">{costs.messaging ? `1 WhatsApp follow-up to ${costs.recipients} people who agreed, at an example ${money(WHATSAPP_RATE)} each` : 'No paid messages'}</span></th><td className="py-2 text-right font-medium">{money(costs.messaging)}</td></tr>
            <tr><th scope="row" className="py-2 pr-3 text-left font-normal">Content creation<br /><span className="text-xs text-slate-500">{plan.content.map((x) => `${x.label}${x.cost ? '' : ' (included)'}`).join('; ')}</span></th><td className="py-2 text-right font-medium">{money(costs.content)}</td></tr>
            <tr className="font-semibold"><th scope="row" className="py-2 pr-3 text-left">Total</th><td className="py-2 text-right">{money(costs.total)}</td></tr>
            <tr className="text-slate-600"><th scope="row" className="py-2 pr-3 text-left font-normal">Left from your {money(plan.budget)} budget</th><td className={`py-2 text-right ${over ? 'text-rose-700' : ''}`}>{money(plan.budget - costs.total)}</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Pretend money. Rates are examples, not checked with Meta or WhatsApp.</p>
      </Details>

      <Details id="plan-outcomes" title="Illustrative demo outcomes" summary="Example numbers from the prototype's sample data. Not a forecast.">
        <Note tone="warn" className="mb-3">These ranges come from the fixed sample numbers this prototype uses. They are illustrative demo outcomes, not a forecast for your shop.</Note>
        <ul className="space-y-2 text-slate-700">
          <li><strong>{num(roundRange(est.reach)[0])} to {num(roundRange(est.reach)[1])}</strong> combined reported reach. The same person can be counted more than once.</li>
          <li><strong>{num(roundRange(est.visits)[0])} to {num(roundRange(est.visits)[1])}</strong> shop visits.</li>
          <li><strong>{num(roundRange(est.clicks)[0])} to {num(roundRange(est.clicks)[1])}</strong> taps on &ldquo;Ask on WhatsApp&rdquo;.</li>
          <li><strong>{scripted === 0 ? 'No' : scripted}</strong> scripted WhatsApp conversation{scripted === 1 ? '' : 's'} arrive in this demo when its items go out. A real campaign could bring more or fewer, and only some taps become conversations.</li>
        </ul>
        <p className="mt-3 text-sm text-slate-600">Sales are not guaranteed. Success means learning which channel and message bring real conversations for the money spent.</p>
      </Details>

      <Dialog open={confirmAlt} onClose={() => setConfirmAlt(false)} title="Replace your edits?"
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setConfirmAlt(false)}>Keep this plan</button><button type="button" className="btn btn-primary" onClick={() => { setConfirmAlt(false); onAlternative(); }}>Show alternative</button></>}>
        <p>You changed this plan. An alternative replaces it, including your changes.</p>
      </Dialog>
      <Dialog open={confirmAccept} onClose={() => setConfirmAccept(false)} title="When should this campaign run?" wide
        footer={<button type="button" className="btn btn-ghost" onClick={() => setConfirmAccept(false)}>Cancel</button>}>
        <p className="mb-4 text-slate-700">{live.map((c) => `"${c.name}"`).join(' and ')} {live.length === 1 ? 'is' : 'are'} still live. Choose what happens to {live.length === 1 ? 'it' : 'them'}.</p>
        <div className="space-y-3">
          <button type="button" className="w-full rounded-xl border-2 border-brand-olive-600 bg-brand-olive-50 p-4 text-left hover:bg-brand-olive-100" onClick={() => accept('after')}>
            <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">Start after the current campaign <Pill tone="olive">Recommended</Pill></span>
            <span className="mt-1 block text-sm text-slate-700">Nothing changes in the current campaign. <strong>Proposed start: {fmtDay(afterStart)}</strong>, running {plan.days} days to {fmtDay(addDays(afterStart, plan.days - 1))}. You can approve its items now.</span>
          </button>
          <button type="button" className="w-full rounded-xl border border-slate-300 bg-white p-4 text-left hover:border-brand-olive-400 hover:bg-brand-olive-50" onClick={() => accept('alongside')}>
            <span className="block font-medium text-slate-900">Run alongside it</span>
            <span className="mt-1 block text-sm text-slate-700">Both campaigns run at the same time. Customers may see both.</span>
            <span className="mt-2 block overflow-hidden rounded-lg border border-slate-200 text-sm">
              {liveCosts.map(({ c, total }) => (
                <span key={c.id} className="flex justify-between gap-3 border-b border-slate-100 px-3 py-1.5"><span>{c.name} · {fmtShort(c.startDate)} to {fmtShort(c.endDate)}</span><span className="shrink-0">{money(total)}</span></span>
              ))}
              <span className="flex justify-between gap-3 border-b border-slate-100 px-3 py-1.5"><span>{plan.name} · {fmtShort(alongStart)} to {fmtShort(addDays(alongStart, plan.days - 1))}</span><span className="shrink-0">{money(costs.total)}</span></span>
              <span className="flex justify-between gap-3 bg-slate-50 px-3 py-1.5 font-semibold"><span>Combined planned spending</span><span className="shrink-0">{money(combined)}</span></span>
            </span>
          </button>
          <button type="button" className="w-full rounded-xl border border-slate-300 bg-white p-4 text-left hover:border-rose-300 hover:bg-rose-50" onClick={() => accept('replace')}>
            <span className="block font-medium text-slate-900">Replace the current campaign</span>
            <span className="mt-1 block text-sm text-slate-700">What stops: {live.map((c) => `"${c.name}"`).join(' and ')} {live.length === 1 ? 'ends' : 'end'} today. {unsent ? `${unsent} item${unsent === 1 ? '' : 's'} that ${unsent === 1 ? 'has' : 'have'} not gone out ${unsent === 1 ? 'is' : 'are'} withdrawn` : 'Nothing is left to withdraw'}{live.some((c) => c.adApproved) ? ' and its paid ads stop' : ''}. What already happened stays in your results. The new plan starts tomorrow.</span>
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function EditPanel({ plan, edit }: { plan: Plan; edit: (p: Partial<Plan>) => void }) {
  const ids = plan.channels.map((c) => c.id);
  const toggle = (id: ChannelId) => edit({ channels: ids.includes(id) ? plan.channels.filter((c) => c.id !== id) : [...plan.channels, { id, why: '' }] });
  const locked = plan.channels.filter((c) => c.locked);
  return (
    <section className="card border-brand-olive-300 ring-1 ring-brand-olive-200" aria-label="Edit plan">
      <SectionTitle title="Edit the plan" hint="Costs and the schedule update as you change things." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Main message" htmlFor="ed-msg"><input id="ed-msg" className="input" value={plan.message} onChange={(e) => edit({ message: e.target.value })} /></Field>
        <Field label="Campaign name" htmlFor="ed-name"><input id="ed-name" className="input" value={plan.name} onChange={(e) => edit({ name: e.target.value })} /></Field>
        <Field label="Reason to buy" htmlFor="ed-reason"><textarea id="ed-reason" rows={3} className="input" value={plan.reason} onChange={(e) => edit({ reason: e.target.value })} /></Field>
        <Field label="Who it is for" htmlFor="ed-aud"><textarea id="ed-aud" rows={3} className="input" value={plan.audience} onChange={(e) => edit({ audience: e.target.value })} /></Field>
        <Field label="Length" htmlFor="ed-days">
          <select id="ed-days" className="select" value={plan.days} onChange={(e) => edit({ days: Number(e.target.value) })}>
            <option value={7}>1 week</option><option value={14}>2 weeks</option><option value={28}>4 weeks</option>
          </select>
        </Field>
        {ids.includes('meta_ads') ? (
          <Field label="Daily ad amount (US dollars)" htmlFor="ed-ad" hint={`${money(plan.adDaily)} × ${plan.days} days = ${money(plan.adDaily * plan.days)}`}>
            <input id="ed-ad" type="number" min={1} max={50} className="input max-w-32" value={plan.adDaily} onChange={(e) => edit({ adDaily: Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))) })} />
          </Field>
        ) : null}
      </div>
      <fieldset className="mt-5">
        <legend className="label">Channels</legend>
        <div className="flex flex-wrap gap-2">
          {locked.map((c) => (
            <span key={c.id} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-3 text-sm text-slate-700" title={c.locked}><Icon name="lock" className="h-3.5 w-3.5" />{channelById(c.id).name}</span>
          ))}
          {OPTIONAL_CHANNELS.map((id) => (
            <button key={id} type="button" aria-pressed={ids.includes(id)} onClick={() => toggle(id)} className={`min-h-10 rounded-full border px-3 text-sm ${ids.includes(id) ? 'border-brand-olive-600 bg-brand-olive-50 font-medium text-brand-olive-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
              {ids.includes(id) ? '✓ ' : '+ '}{channelById(id).name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Instagram and WhatsApp messages are always included: they carry the discovery posts and the follow-ups.</p>
      </fieldset>
    </section>
  );
}
