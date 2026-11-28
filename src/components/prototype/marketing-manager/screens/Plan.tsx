'use client';
// "My plan": choose a goal, period and budget, then review, edit, swap or accept a simulated plan.
import React, { useState } from 'react';
import { FORMATS, WHATSAPP_RATE, channelById, productById, type ChannelId } from '../catalog';
import { addDays, fmtDay, fmtShort, money, num } from '../dates';
import { activeCampaign, planCostsFor } from '../engine';
import { GOALS, GOAL_ORDER, OPTIONAL_CHANNELS, STAGE_INFO, planEstimate, planSteps, recipientsFor, reshapePlan, roundRange } from '../plan';
import { useDemo } from '../store';
import type { GoalId, GoalInput, Plan } from '../types';
import { Dialog, Field, Icon, Note, PageTitle, Pill, SectionTitle, Simulated, Working } from '../ui';

const PREP_STEPS = ['Reading your business answers', 'Choosing products and the right customers', 'Picking channels that suit the goal', 'Scheduling the steps and checking the budget'];

export function PlanScreen() {
  const { state, dispatch, toast } = useDemo();
  const [preparing, setPreparing] = useState<string | null>(null);
  const draft = state.draft;
  const c = activeCampaign(state);

  const prepare = (variant: number, label: string) => {
    setPreparing(label);
    window.setTimeout(() => {
      dispatch({ type: 'draft/plan', variant });
      setPreparing(null);
      toast(variant === 0 ? 'Your plan is ready to review.' : 'Here is an alternative plan.');
    }, 2200);
  };

  const start = (input: GoalInput) => {
    dispatch({ type: 'draft/start', input });
    prepare(0, 'Preparing your plan');
  };

  return (
    <div>
      <PageTitle eyebrow="My plan" title={draft?.plan ? 'Your proposed plan' : c ? 'Your plan' : 'Set a goal'} hint={draft?.plan ? 'Check it, change anything you like, then accept it. Nothing goes out until you also approve each item.' : 'Tell your marketing manager what you want to achieve. You get a plan in a minute.'} />

      {preparing ? (
        <Working label={`${preparing}…`} steps={PREP_STEPS} />
      ) : draft?.plan ? (
        <ProposedPlan plan={draft.plan} onAlternative={() => prepare(draft.plan!.variant + 1, 'Preparing an alternative')} />
      ) : (
        <>
          {c ? <CurrentPlan /> : null}
          <GoalForm key={draft ? 'd' : 'n'} initial={draft?.input} onSubmit={start} hasActive={!!c} />
        </>
      )}
    </div>
  );
}

function GoalForm({ initial, onSubmit, hasActive }: { initial?: GoalInput; onSubmit: (i: GoalInput) => void; hasActive: boolean }) {
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
      {hasActive ? <SectionTitle title="Plan what comes next" hint="Accepting a new plan ends the current campaign. Its results stay in your reports." /> : null}
      {initial?.fromRecommendation ? <Note tone="ok" className="mb-4">Started from the recommendation: <strong>{initial.fromRecommendation}</strong>. Change anything before preparing the plan.</Note> : null}
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
        <p className="mt-1.5 text-sm text-slate-500">Starts tomorrow in the demo ({fmtDay(addDays(state.today, 1))}).</p>
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
        <button type="button" className="btn btn-primary" disabled={!goal} onClick={() => goal && onSubmit({ goal, weeks, budget, fromRecommendation: initial?.fromRecommendation })}>
          <Icon name="sparkle" className="h-4 w-4" /> Prepare my plan
        </button>
        {!goal ? <span className="text-sm text-slate-500">Choose a goal first.</span> : <Simulated>The plan is simulated from templates</Simulated>}
      </div>
    </section>
  );
}

function CurrentPlan() {
  const { state } = useDemo();
  const c = activeCampaign(state)!;
  const costs = planCostsFor(state, c.plan);
  return (
    <section className="card mb-5" aria-labelledby="cur-plan">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-olive-700">Current plan · accepted</p>
          <h2 id="cur-plan" className="font-serif text-2xl">{c.name}</h2>
          <p className="text-sm text-slate-600">{GOALS[c.goal].label} · {fmtShort(c.startDate)} to {fmtShort(c.endDate)} · estimated {money(costs.total)} of {money(c.plan.budget)}</p>
        </div>
        <a href="#/campaigns" className="btn btn-secondary btn-sm">See campaign</a>
      </div>
      <p className="mt-3 text-slate-700"><strong>Message:</strong> {c.plan.message}</p>
    </section>
  );
}

function ProposedPlan({ plan, onAlternative }: { plan: Plan; onAlternative: () => void }) {
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
  const active = activeCampaign(state);
  const unknown = (['delivery', 'returns', 'payment'] as const).filter((k) => state.business[k] === null);
  const edit = (patch: Partial<Plan>) => dispatch({ type: 'draft/edit', plan: reshapePlan(plan, patch, recipients, state.business.areas) });
  const [convLo, convHi] = roundRange(Math.max(2, est.clicks * 0.35), 0.6, 1.3);

  const accept = () => {
    dispatch({ type: 'draft/accept' });
    setConfirmAccept(false);
    go('#/approvals');
    toast('Plan accepted. Your campaign items are ready for approval.');
  };

  return (
    <div className="space-y-5">
      {plan.fromRecommendation ? <Note tone="ok">Prepared from the recommendation: <strong>{plan.fromRecommendation}</strong></Note> : null}

      <section className="card">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="lime">{GOALS[plan.goal].label}</Pill>
          <Simulated>Simulated plan</Simulated>
          {plan.variant > 0 ? <Pill>Alternative {plan.variant + 1}</Pill> : null}
          {plan.edited ? <Pill tone="sky">Edited by you</Pill> : null}
        </div>
        <h2 className="mt-2 font-serif text-3xl">{plan.name}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><dt className="text-xs uppercase tracking-wider text-slate-500">Period</dt><dd className="font-medium">{fmtShort(plan.startDate)} to {fmtShort(end)}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-slate-500">Length</dt><dd className="font-medium">{plan.days} days</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-slate-500">Your budget</dt><dd className="font-medium">{money(plan.budget)}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-slate-500">Estimated cost</dt><dd className={`font-medium ${over ? 'text-rose-700' : ''}`}>{money(costs.total)}</dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={over || editing} onClick={() => (active ? setConfirmAccept(true) : accept())}><Icon name="check" className="h-4 w-4" /> Accept plan</button>
          <button type="button" className={`btn ${editing ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEditing(!editing)}><Icon name="edit" className="h-4 w-4" /> {editing ? 'Done editing' : 'Edit plan'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => (plan.edited ? setConfirmAlt(true) : onAlternative())}><Icon name="sparkle" className="h-4 w-4" /> Show me an alternative</button>
          <button type="button" className="btn btn-ghost" onClick={() => { dispatch({ type: 'draft/discard' }); toast('Plan discarded.', 'info'); }}>Discard</button>
        </div>
        {over ? <Note tone="error" className="mt-3">This plan costs {money(costs.total - plan.budget)} more than your budget. Lower the daily ad amount, remove a channel or raise the budget.</Note> : null}
      </section>

      {editing ? <EditPanel plan={plan} edit={edit} /> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card">
          <SectionTitle title="What we will promote" />
          <p className="mb-3 font-medium">{plan.collectionName}</p>
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
        </section>
        <section className="card space-y-4">
          <div><SectionTitle title="Who it is for" /><p className="text-slate-700">{plan.audience}</p></div>
          <div><SectionTitle title="Main message" /><p className="font-serif text-2xl leading-snug text-brand-olive-800">&ldquo;{plan.message}&rdquo;</p></div>
          <div><SectionTitle title="Reason to buy" /><p className="text-slate-700">{plan.reason}</p></div>
        </section>
      </div>

      <section className="card">
        <SectionTitle title="Channels and why they suit this goal" />
        <ul className="divide-y divide-slate-200">
          {plan.channels.map((ch) => {
            const info = channelById(ch.id);
            return (
              <li key={ch.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex min-w-48 items-center gap-2 font-medium">{info.name}</div>
                <p className="flex-1 text-sm text-slate-700">{ch.why}</p>
                <Pill tone={info.depiction === 'automatic' ? 'sky' : 'violet'}>{info.depiction === 'automatic' ? 'Posted for you' : 'You share it'}</Pill>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <SectionTitle title="Campaign steps and schedule" hint="From being discovered to following up after a sale." />
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
                <p className="mt-1 text-sm text-slate-500">{s.formats.map((f) => FORMATS[f].label).join(' · ')}</p>
              </div>
            </li>
          ))}
        </ol>
        {plan.channels.some((c) => c.id === 'meta_ads') ? <p className="mt-2 text-sm text-slate-600">The ad runs every day from {fmtShort(plan.startDate)} to {fmtShort(end)}.</p> : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card">
          <SectionTitle title="Estimated costs" hint="Pretend money in this prototype." />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-200">
              <tr><th scope="row" className="py-2 pr-3 text-left font-normal">Advertising<br /><span className="text-xs text-slate-500">{costs.adDays ? `${money(plan.adDaily)} a day for ${costs.adDays} days` : 'No paid ads in this plan'}</span></th><td className="py-2 text-right font-medium">{money(costs.ads)}</td></tr>
              <tr><th scope="row" className="py-2 pr-3 text-left font-normal">Messaging<br /><span className="text-xs text-slate-500">{costs.messaging ? `1 WhatsApp follow-up to ${costs.recipients} people who agreed, at an example ${money(WHATSAPP_RATE)} each` : 'No paid messages'}</span></th><td className="py-2 text-right font-medium">{money(costs.messaging)}</td></tr>
              <tr><th scope="row" className="py-2 pr-3 text-left font-normal">Content creation<br /><span className="text-xs text-slate-500">{plan.content.map((x) => `${x.label}${x.cost ? '' : ' (included)'}`).join('; ')}</span></th><td className="py-2 text-right font-medium">{money(costs.content)}</td></tr>
              <tr className="font-semibold"><th scope="row" className="py-2 pr-3 text-left">Total</th><td className="py-2 text-right">{money(costs.total)}</td></tr>
              <tr className="text-slate-600"><th scope="row" className="py-2 pr-3 text-left font-normal">Left from your {money(plan.budget)} budget</th><td className={`py-2 text-right ${over ? 'text-rose-700' : ''}`}>{money(plan.budget - costs.total)}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Rates are examples, not checked with Meta or WhatsApp.</p>
        </section>
        <section className="card">
          <SectionTitle title="What success would look like" hint="Rough ranges based on the sample data. Not a promise." />
          <ul className="space-y-2 text-slate-700">
            <li>About <strong>{num(roundRange(est.reach)[0])} to {num(roundRange(est.reach)[1])}</strong> people see something from the campaign.</li>
            <li>About <strong>{num(roundRange(est.visits)[0])} to {num(roundRange(est.visits)[1])}</strong> shop visits.</li>
            <li>About <strong>{num(roundRange(est.clicks)[0])} to {num(roundRange(est.clicks)[1])}</strong> taps on &ldquo;Ask on WhatsApp&rdquo;.</li>
            <li>A good result would be <strong>{convLo} to {convHi} real WhatsApp conversations</strong>, some of which may become sales.</li>
          </ul>
          <Note className="mt-3">Sales are not guaranteed. Success means learning which channel and message bring real conversations for the money spent.</Note>
        </section>
      </div>

      {unknown.length ? (
        <Note tone="warn">
          Your {unknown.length > 1 ? `${unknown.slice(0, -1).join(', ')} and ${unknown[unknown.length - 1]}` : unknown[0]} {unknown.length === 1 ? 'policy is' : 'policies are'} unknown, so no material mentions {unknown.length === 1 ? 'it' : 'them'}. <a className="underline" href="#/settings">Add them in Business settings</a> if you want them included.
        </Note>
      ) : null}

      <Dialog open={confirmAlt} onClose={() => setConfirmAlt(false)} title="Replace your edits?"
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setConfirmAlt(false)}>Keep this plan</button><button type="button" className="btn btn-primary" onClick={() => { setConfirmAlt(false); onAlternative(); }}>Show alternative</button></>}>
        <p>You changed this plan. An alternative replaces it, including your changes.</p>
      </Dialog>
      <Dialog open={confirmAccept} onClose={() => setConfirmAccept(false)} title="End the current campaign?"
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setConfirmAccept(false)}>Not yet</button><button type="button" className="btn btn-primary" onClick={accept}>Accept new plan</button></>}>
        <p>&ldquo;{active?.name}&rdquo; is still active. Accepting this plan ends it: anything that has not gone out yet is withdrawn. What already happened stays in your results.</p>
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
