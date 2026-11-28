'use client';
// Business settings (secondary screen): the answers from onboarding, editable.
import React, { useState } from 'react';
import { useDemo } from '../store';
import type { Business } from '../types';
import { Field, Note, PageTitle, SectionTitle } from '../ui';
import { normaliseBusiness } from './Onboarding';

type PolicyKey = 'delivery' | 'returns' | 'ordering' | 'payment';
const POLICIES: { key: PolicyKey; label: string }[] = [
  { key: 'delivery', label: 'Delivery' },
  { key: 'returns', label: 'Returns and exchanges' },
  { key: 'ordering', label: 'How people order' },
  { key: 'payment', label: 'Payment' },
];

export function SettingsScreen() {
  const { state, dispatch, go, toast } = useDemo();
  const [b, setB] = useState<Business>(state.business);
  const set = (patch: Partial<Business>) => setB((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(b) !== JSON.stringify(state.business);

  return (
    <div>
      <PageTitle eyebrow="Business settings" title="Your business" hint="What your marketing manager knows about your shop. Plans and replies use these answers." />
      <div className="space-y-5">
        <section className="card grid gap-4 md:grid-cols-2">
          <Field label="Shop name" htmlFor="s-name"><input id="s-name" className="input" value={b.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Where you deliver" htmlFor="s-areas"><input id="s-areas" className="input" value={b.areas} onChange={(e) => set({ areas: e.target.value })} /></Field>
          <Field label="What you sell" htmlFor="s-sells"><textarea id="s-sells" rows={3} className="input" value={b.sells} onChange={(e) => set({ sells: e.target.value })} /></Field>
          <Field label="Who you want to reach" htmlFor="s-aud"><textarea id="s-aud" rows={3} className="input" value={b.audience} onChange={(e) => set({ audience: e.target.value })} /></Field>
          <Field label="Why customers should choose you" htmlFor="s-worth"><textarea id="s-worth" rows={3} className="input" value={b.worthChoosing} onChange={(e) => set({ worthChoosing: e.target.value })} /></Field>
          <div className="space-y-4">
            <Field label="Language" htmlFor="s-lang">
              <select id="s-lang" className="select" value={b.language} onChange={(e) => set({ language: e.target.value })}>
                <option>English</option><option>English and Shona</option><option>English and Ndebele</option>
              </select>
            </Field>
            <Field label="Brand voice" htmlFor="s-voice"><input id="s-voice" className="input" value={b.voice} onChange={(e) => set({ voice: e.target.value })} /></Field>
            <Field label="Monthly marketing budget (US dollars)" htmlFor="s-budget"><input id="s-budget" type="number" min={0} step={10} className="input max-w-40" value={b.monthlyBudget} onChange={(e) => set({ monthlyBudget: Math.max(0, Number(e.target.value) || 0) })} /></Field>
          </div>
        </section>

        <section className="card">
          <SectionTitle title="Policies" hint="Anything not decided stays unknown. Your marketing never guesses it, and replies leave a gap for you to fill." />
          <div className="grid gap-3 md:grid-cols-2">
            {POLICIES.map(({ key, label }) => (
              <div key={key} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`s-${key}`} className="font-medium">{label}</label>
                  <label className="inline-flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-olive-600" checked={b[key] === null} onChange={(e) => set({ [key]: e.target.checked ? null : '' } as Partial<Business>)} /> Not decided yet</label>
                </div>
                {b[key] === null ? <p className="mt-1 rounded bg-amber-50 px-2 py-1.5 text-sm text-amber-900">Unknown</p> : <input id={`s-${key}`} className="input mt-2" value={b[key] ?? ''} onChange={(e) => set({ [key]: e.target.value } as Partial<Business>)} />}
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => { const nb = normaliseBusiness(b); dispatch({ type: 'business/update', business: nb }); setB(nb); toast('Saved. New plans and materials use these answers.'); }}>Save changes</button>
          <button type="button" className="btn btn-ghost" disabled={!dirty} onClick={() => setB(state.business)}>Undo changes</button>
          <button type="button" className="btn btn-secondary ml-auto" onClick={() => { dispatch({ type: 'onboarding/restart' }); go('#/welcome'); }}>Answer the welcome questions again</button>
        </div>
        <Note>Changes apply to new plans and materials. Items you already approved keep their approved words.</Note>

        <section className="card">
          <SectionTitle title="About this prototype" />
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Every customer, number, conversation and sale is fictional sample data.</li>
            <li>Plans, captions, replies, revisions and reviews marked &ldquo;Simulated&rdquo; come from fixed templates. No AI is used.</li>
            <li>Nothing is posted, sent, connected or paid for. &ldquo;Published in demo&rdquo; only changes this page.</li>
            <li>Your changes are saved in this browser only. &ldquo;Reset demo&rdquo; at the top starts again.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
