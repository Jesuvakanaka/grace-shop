'use client';
// Step 1 of the journey: "Understand my business". Short questions with editable
// example answers. Unknown policies stay unknown.
import React, { useState } from 'react';
import { Mark } from '@/components/storefront/Brand';
import { useDemo } from '../store';
import { EXAMPLE_BUSINESS } from '../seed';
import type { Business } from '../types';
import { Field, Icon, Note, Simulated } from '../ui';

type PolicyKey = 'delivery' | 'returns' | 'ordering' | 'payment';

const SUGGESTIONS = {
  audience: [
    'Women aged about 25 to 45 in Harare who like elegant, colourful clothes',
    'Professional women who need standout outfits for weddings, graduations and church',
    'Young women who follow fashion on Instagram and TikTok and like bold looks',
  ],
  worthChoosing: [
    'Every piece is chosen by hand, and we give honest fit advice on WhatsApp before you buy.',
    'Bold, elegant pieces you will not see on everyone else at the event.',
    'A real person helps you pick the right size and style, quickly, on WhatsApp.',
  ],
  voice: [
    'Warm, confident and simple. No slang.',
    'Elegant and calm, like a boutique stylist.',
    'Friendly and upbeat, with a little humour.',
  ],
};

const POLICY_INFO: Record<PolicyKey, { label: string; example: string; hint: string }> = {
  delivery: { label: 'Delivery', example: 'Free delivery in Harare within 2 days', hint: 'Where you deliver, how long it takes and what it costs.' },
  returns: { label: 'Returns and exchanges', example: 'Exchanges within 7 days if unworn with tags', hint: 'Whether people can return or exchange, and how.' },
  ordering: { label: 'How people order', example: 'Message us on WhatsApp to order.', hint: 'Your website sends shoppers to WhatsApp to order.' },
  payment: { label: 'Payment', example: 'EcoCash, bank transfer or cash on delivery', hint: 'How customers pay you.' },
};

/** Blank policies are unknown, never an empty promise. */
export function normaliseBusiness(b: Business): Business {
  const p = (v: string | null) => (v === null || v.trim() === '' ? null : v.trim());
  return { ...b, name: b.name.trim() || 'My shop', delivery: p(b.delivery), returns: p(b.returns), ordering: p(b.ordering), payment: p(b.payment) };
}

export function OnboardingScreen() {
  const { state, dispatch, go, toast } = useDemo();
  const [b, setB] = useState<Business>(state.business);
  const [step, setStep] = useState(0);
  const [helping, setHelping] = useState<string | null>(null);
  const set = (patch: Partial<Business>) => setB((x) => ({ ...x, ...patch }));

  const help = (key: keyof typeof SUGGESTIONS | 'budget') => (
    <div className="mt-2">
      {helping === key ? (
        <div className="rounded-lg border border-dashed border-brand-olive-300 bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-2"><Simulated /><button type="button" className="text-xs text-slate-500 underline" onClick={() => setHelping(null)}>Hide</button></div>
          {key === 'budget' ? (
            <div className="space-y-2 text-sm text-slate-700">
              <p>For a small shop starting out, many owners begin with <strong>$150 to $300 a month</strong>: enough to test a small amount of ads for two weeks and learn what works, without risking much.</p>
              <div className="flex flex-wrap gap-2">
                {[150, 300].map((v) => <button key={v} type="button" className="btn btn-secondary btn-sm" onClick={() => { set({ monthlyBudget: v }); setHelping(null); }}>Use ${v}</button>)}
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {SUGGESTIONS[key].map((s) => (
                <li key={s}>
                  <button type="button" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-brand-olive-400 hover:bg-brand-olive-50" onClick={() => { set({ [key]: s } as Partial<Business>); setHelping(null); }}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button type="button" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-brand-olive-700 underline-offset-4 hover:underline" onClick={() => setHelping(key)}>
          <Icon name="sparkle" className="h-4 w-4" /> Help me decide
        </button>
      )}
    </div>
  );

  const example = <span className="text-xs text-slate-500">Example answer. Change it to fit your shop.</span>;

  const policy = (k: PolicyKey) => {
    const v = b[k];
    const unknown = v === null;
    return (
      <div key={k} className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`p-${k}`} className="font-medium text-slate-900">{POLICY_INFO[k].label}</label>
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-olive-600" checked={unknown} onChange={(e) => set({ [k]: e.target.checked ? null : '' } as Partial<Business>)} />
            Not decided yet
          </label>
        </div>
        <p className="text-xs text-slate-500">{POLICY_INFO[k].hint}</p>
        {unknown ? (
          <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-sm text-amber-900">Unknown. Your marketing will not mention it, and replies leave a gap for you to fill.</p>
        ) : (
          <input id={`p-${k}`} className="input mt-2" value={v ?? ''} placeholder={`For example: ${POLICY_INFO[k].example}`} onChange={(e) => set({ [k]: e.target.value } as Partial<Business>)} />
        )}
      </div>
    );
  };

  const steps: { title: string; intro: string; body: React.ReactNode }[] = [
    {
      title: 'What do you sell?',
      intro: 'In a sentence, as you would tell a new customer.',
      body: (
        <div className="space-y-4">
          <Field label="Shop name" htmlFor="ob-name"><input id="ob-name" className="input" value={b.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="What you sell" htmlFor="ob-sells" hint={example}><textarea id="ob-sells" rows={3} className="input" value={b.sells} onChange={(e) => set({ sells: e.target.value })} /></Field>
        </div>
      ),
    },
    {
      title: 'Who do you want to reach?',
      intro: 'Describe the people most likely to love your clothes.',
      body: <Field label="Your ideal customers" htmlFor="ob-aud" hint={example}><textarea id="ob-aud" rows={3} className="input" value={b.audience} onChange={(e) => set({ audience: e.target.value })} />{help('audience')}</Field>,
    },
    {
      title: 'Where do you deliver?',
      intro: 'Ads and posts are only aimed at places you can actually serve.',
      body: <Field label="Towns or areas" htmlFor="ob-areas" hint={example}><input id="ob-areas" className="input" value={b.areas} onChange={(e) => set({ areas: e.target.value })} /></Field>,
    },
    {
      title: 'What makes your shop worth choosing?',
      intro: 'The honest reason someone should buy from you rather than elsewhere.',
      body: <Field label="Your reason" htmlFor="ob-worth" hint={example}><textarea id="ob-worth" rows={3} className="input" value={b.worthChoosing} onChange={(e) => set({ worthChoosing: e.target.value })} />{help('worthChoosing')}</Field>,
    },
    {
      title: 'Delivery, returns and ordering',
      intro: 'Only fill in what you have decided. Anything you leave as "not decided" stays unknown, and your marketing will never guess it.',
      body: <div className="space-y-3">{(['delivery', 'returns', 'ordering', 'payment'] as PolicyKey[]).map(policy)}</div>,
    },
    {
      title: 'Language and brand voice',
      intro: 'How your posts and replies should sound.',
      body: (
        <div className="space-y-4">
          <Field label="Language" htmlFor="ob-lang">
            <select id="ob-lang" className="select" value={b.language} onChange={(e) => set({ language: e.target.value })}>
              <option>English</option>
              <option>English and Shona</option>
              <option>English and Ndebele</option>
            </select>
          </Field>
          <Field label="Brand voice" htmlFor="ob-voice" hint={example}><input id="ob-voice" className="input" value={b.voice} onChange={(e) => set({ voice: e.target.value })} />{help('voice')}</Field>
        </div>
      ),
    },
    {
      title: 'Your marketing budget',
      intro: 'The most you want to spend in a month on ads, messages and content. Plans always stay within it.',
      body: (
        <Field label="Monthly budget in US dollars" htmlFor="ob-budget" hint="You can change this at any time. Nothing is spent in this prototype.">
          <div className="flex items-center gap-2">
            <span className="text-lg text-slate-600">$</span>
            <input id="ob-budget" type="number" min={0} step={10} inputMode="numeric" className="input max-w-40" value={b.monthlyBudget} onChange={(e) => set({ monthlyBudget: Math.max(0, Number(e.target.value) || 0) })} />
            <span className="text-sm text-slate-500">a month</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">{[100, 200, 300, 500].map((v) => <button key={v} type="button" onClick={() => set({ monthlyBudget: v })} className={`btn btn-sm ${b.monthlyBudget === v ? 'btn-primary' : 'btn-secondary'}`}>${v}</button>)}</div>
          {help('budget')}
        </Field>
      ),
    },
  ];

  const last = step === steps.length - 1;
  const finish = () => {
    dispatch({ type: 'onboarding/finish', business: normaliseBusiness(b) });
    go('#/');
    toast('Thanks. Your marketing manager now knows your business.');
  };
  const skip = () => {
    dispatch({ type: 'onboarding/skip' });
    go('#/');
    toast('You are exploring the prepared demo with example answers.', 'info');
  };
  const current = steps[step];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5"><Mark className="h-9 w-9" title="" /><span className="font-serif text-xl font-semibold">Marketing manager</span></div>
        <button type="button" onClick={skip} className="btn btn-ghost btn-sm">Skip and explore the demo</button>
      </div>

      {step === 0 ? (
        <Note className="mb-5">
          A few short questions so your marketing manager understands your shop. Example answers are filled in for you. Change anything, or skip and explore the prepared demo.
        </Note>
      ) : null}

      <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
        <span>Question {step + 1} of {steps.length}</span>
        <span className="sr-only">{Math.round(((step + 1) / steps.length) * 100)}% complete</span>
      </div>
      <div className="mb-6 flex gap-1" aria-hidden>
        {steps.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-olive-600' : 'bg-slate-300'}`} />)}
      </div>

      <section className="card" aria-labelledby="ob-title">
        <h1 id="ob-title" className="font-serif text-3xl text-slate-900">{current.title}</h1>
        <p className="mb-5 mt-1 text-slate-600">{current.intro}</p>
        {current.body}
      </section>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button type="button" className="btn btn-secondary" disabled={step === 0} onClick={() => { setStep(step - 1); setHelping(null); }}><Icon name="back" className="h-4 w-4" /> Back</button>
        {last ? (
          <button type="button" className="btn btn-primary" onClick={finish}>Finish <Icon name="check" className="h-4 w-4" /></button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => { setStep(step + 1); setHelping(null); }}>Next <Icon name="arrow" className="h-4 w-4" /></button>
        )}
      </div>

      {last ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-700">
          <p className="mb-2 font-medium text-slate-900">Before you finish</p>
          <ul className="list-disc space-y-1 pl-5">
            {(['delivery', 'returns', 'ordering', 'payment'] as PolicyKey[]).filter((k) => b[k] === null).map((k) => <li key={k}>{POLICY_INFO[k].label} is unknown. It stays unknown until you add it in Business settings.</li>)}
            <li>You can change every answer later in Business settings.</li>
          </ul>
        </div>
      ) : null}
      <p className="mt-6 text-center text-xs text-slate-500">Example answers are based on a sample shop{b.name === EXAMPLE_BUSINESS.name ? ' named VYRA' : ''}. Nothing you type leaves this browser.</p>
    </div>
  );
}
