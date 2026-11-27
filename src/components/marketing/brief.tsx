'use client';
// Marketing hub: the thinking behind a piece of content. The selling profile of a product
// (who buys it, why, what stops them) and the brief form that is filled in from it.
import React, { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import { ACTION_CHOICES, DEFAULT_ACTION, JOBS, JOB_HINT, JOB_LABEL, isJob, type Job, type UrgencyOption } from '@/lib/marketing/brief';
import { PROFILE_LIMITS, buyerLine, doubtLine, type SellingProfile } from '@/lib/marketing/profile-model';
import { mk } from './api';
import { Card, ErrorNote } from './parts';

export interface BriefValue {
  job: Job | '';
  reader: string;
  message: string;
  proof: string;
  urgencyKind: string;
  urgencyText: string;
  action: string;
}
export const EMPTY_BRIEF: BriefValue = { job: '', reader: '', message: '', proof: '', urgencyKind: 'NONE', urgencyText: '', action: '' };

type BriefSource = { job?: string | null; reader?: string | null; message?: string | null; proof?: string | null; urgencyKind?: string | null; urgencyText?: string | null; action?: string | null };
export const briefFromContent = (c: BriefSource): BriefValue => ({
  job: isJob(c.job) ? c.job : '',
  reader: c.reader ?? '',
  message: c.message ?? '',
  proof: c.proof ?? '',
  urgencyKind: c.urgencyKind ?? 'NONE',
  urgencyText: c.urgencyText ?? '',
  action: c.action ?? '',
});
/** The fields as the API takes them. With no job chosen nothing is sent as a brief. */
export const briefBody = (b: BriefValue): Record<string, string | null> => ({
  job: b.job || null,
  reader: b.reader.trim() || null,
  message: b.message.trim() || null,
  proof: b.proof.trim() || null,
  urgencyKind: b.job ? b.urgencyKind || 'NONE' : null,
  urgencyText: b.urgencyKind === 'OWN' ? b.urgencyText.trim() || null : null,
  action: b.action.trim() || null,
});
/** Why the brief cannot be saved yet, or null. */
export const briefProblem = (b: BriefValue): string | null =>
  b.job && b.urgencyKind === 'OWN' && !b.urgencyText.trim() ? 'Type your reason to act now, or choose "None".' : null;

export interface ProductSelling {
  profile: SellingProfile | null;
  urgency: UrgencyOption[];
  policiesOnFile: boolean;
}

/** Loads a product's selling profile and the reasons to act now that are true for it today. */
export function useProductSelling(productId: number | null, campaignId?: number | null) {
  const [data, setData] = useState<(ProductSelling & { productId: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!productId) return;
    let live = true;
    mk<ProductSelling>(`/api/marketing/products/${productId}/profile${campaignId ? `?campaignId=${campaignId}` : ''}`)
      .then((d) => { if (live) { setData({ ...d, productId }); setError(null); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the selling profile.'); });
    return () => { live = false; };
  }, [productId, campaignId]);
  const setProfile = (profile: SellingProfile) => setData((d) => (d ? { ...d, profile } : d));
  // Never show one product's profile under another while the new one loads.
  return { data: data && data.productId === productId ? data : null, error, setProfile };
}

const CUSTOM = '__custom__';

/** A list of ready choices plus "type my own". */
function Choice({ id, label, hint, options, value, onChange, placeholder, testId }: {
  id: string; label: string; hint?: string; options: string[]; value: string; onChange: (v: string) => void; placeholder?: string; testId?: string;
}) {
  const known = options.includes(value);
  const [custom, setCustom] = useState(value !== '' && !known);
  const typing = custom || (value !== '' && !known) || options.length === 0;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {options.length > 0 ? (
        <select
          id={id}
          className="select"
          value={typing ? CUSTOM : value}
          onChange={(e) => {
            if (e.target.value === CUSTOM) { setCustom(true); onChange(''); } else { setCustom(false); onChange(e.target.value); }
          }}
          data-testid={testId}
        >
          <option value="">Let the AI choose</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={CUSTOM}>Something else (I will type it)</option>
        </select>
      ) : null}
      {typing ? (
        <input id={options.length > 0 ? `${id}-own` : id} className={`input ${options.length > 0 ? 'mt-2' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} maxLength={400} placeholder={placeholder} aria-label={options.length > 0 ? `${label}: your own words` : undefined} data-testid={testId ? `${testId}-own` : undefined} />
      ) : null}
      {hint ? <p className="text-xs text-slate-500 mt-1">{hint}</p> : null}
    </div>
  );
}

/** The brief: one job, one reader, one message, the proof, a true reason to act now and one action. */
export function BriefForm({ value, onChange, profile, urgency, hasProduct }: {
  value: BriefValue;
  onChange: (v: BriefValue) => void;
  profile: SellingProfile | null;
  urgency: UrgencyOption[];
  hasProduct: boolean;
}) {
  const set = (patch: Partial<BriefValue>) => onChange({ ...value, ...patch });
  const pickJob = (job: Job) => {
    // The action follows the job until the owner has chosen their own.
    const followed = value.action === '' || (value.job !== '' && value.action === DEFAULT_ACTION[value.job]);
    set({ job, action: followed ? DEFAULT_ACTION[job] : value.action });
  };
  const readers = (profile?.buyers ?? []).map(buyerLine);
  const reasons = profile?.reasons ?? [];
  const messages = [...reasons.map((r) => r.reason), ...(profile?.doubts ?? []).map(doubtLine).filter((x): x is string => x !== null)];
  const pickMessage = (m: string) => {
    // A reason comes with the fact it rests on: offer that fact as the proof unless the owner wrote their own.
    const fact = reasons.find((r) => r.reason === m)?.fact;
    const auto = value.proof === '' || reasons.some((r) => r.fact === value.proof);
    set({ message: m, proof: fact && auto ? fact : value.proof });
  };
  const options = urgency.length > 0 ? urgency : [{ kind: 'NONE', label: 'None', text: null }, { kind: 'OWN', label: 'My own reason (I will type it)', text: null }];
  const stale = value.urgencyKind !== 'NONE' && value.urgencyKind !== 'OWN' && !options.some((o) => o.kind === value.urgencyKind);

  return (
    <div className="space-y-4" data-testid="brief-form">
      <fieldset>
        <legend className="label">What is the job of this piece?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {JOBS.map((j) => (
            <label key={j} className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${value.job === j ? 'border-brand-olive-500 bg-brand-olive-50' : 'border-slate-200'}`}>
              <input type="radio" name="brief-job" className="mt-1 h-5 w-5" checked={value.job === j} onChange={() => pickJob(j)} data-testid={`brief-job-${j}`} />
              <span>
                <span className="block font-medium text-slate-900">{JOB_LABEL[j]}</span>
                <span className="block text-xs text-slate-500">{JOB_HINT[j]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {value.job ? (
        <>
          {hasProduct && !profile ? <p className="text-sm text-amber-700" data-testid="brief-no-profile">This product has no selling profile yet. Work it out above and the choices below fill in for you, or type them yourself.</p> : null}
          <Choice id="brief-reader" label="Who is it for?" hint="One kind of person, in one moment." options={readers} value={value.reader} onChange={(reader) => set({ reader })} placeholder="For example: a parent with a family event coming up" testId="brief-reader" />
          <Choice id="brief-message" label="The one thing it must say" hint="One reason to want it, or one doubt to answer. Not two." options={messages} value={value.message} onChange={pickMessage} placeholder="The single idea this piece must land" testId="brief-message" />
          {value.job !== 'GET_SEEN' ? (
            <div>
              <label className="label" htmlFor="brief-proof">The proof</label>
              <input id="brief-proof" className="input" value={value.proof} onChange={(e) => set({ proof: e.target.value })} maxLength={600} placeholder="A product fact, or a customer's own words" data-testid="brief-proof" />
              <p className="text-xs text-slate-500 mt-1">Only what is true. Paste a customer&apos;s words exactly as they said them.</p>
            </div>
          ) : null}
          <div>
            <label className="label" htmlFor="brief-urgency">A reason to act now</label>
            <select id="brief-urgency" className="select" value={stale ? 'NONE' : value.urgencyKind} onChange={(e) => set({ urgencyKind: e.target.value })} data-testid="brief-urgency">
              {options.map((o) => <option key={o.kind} value={o.kind}>{o.label}</option>)}
            </select>
            {value.urgencyKind === 'OWN' ? (
              <input className="input mt-2" value={value.urgencyText} onChange={(e) => set({ urgencyText: e.target.value })} maxLength={200} placeholder="For example: order by Friday for the school concert" aria-label="Your reason to act now" data-testid="brief-urgency-own" />
            ) : null}
            <p className="text-xs text-slate-500 mt-1">
              {stale ? 'The reason chosen before is no longer true, so it will be left out. ' : ''}
              Only reasons that are true today are listed. The AI repeats the one you choose and cannot make up its own.
            </p>
          </div>
          <Choice id="brief-action" label="The one thing it asks the reader to do" options={[...ACTION_CHOICES]} value={value.action} onChange={(action) => set({ action })} placeholder="One clear next step" testId="brief-action" />
        </>
      ) : (
        <p className="text-sm text-slate-500">Choose a job and the AI writes this piece to do that job. With no job chosen it writes a simple offer from your note.</p>
      )}
    </div>
  );
}

const blank = (p: SellingProfile | null): SellingProfile => ({
  buyers: p?.buyers.map((b) => ({ ...b })) ?? [],
  reasons: p?.reasons.map((r) => ({ ...r })) ?? [],
  doubts: p?.doubts.map((d) => ({ ...d })) ?? [],
  occasions: [...(p?.occasions ?? [])],
});

/** Why someone buys this product. The AI works it out once; the owner corrects it. */
export function SellingProfilePanel({ productId, productName, profile, onProfile }: {
  productId: number;
  productName: string;
  profile: SellingProfile | null;
  onProfile: (p: SellingProfile) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<'ai' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SellingProfile | null>(null);
  const url = `/api/marketing/products/${productId}/profile`;

  const generate = async () => {
    setBusy('ai');
    setError(null);
    try {
      const d = await mk<{ profile: SellingProfile }>(url, { method: 'POST' });
      onProfile(d.profile);
      setDraft(null);
      toast.success('Selling profile worked out. Read it and correct anything that is wrong.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The AI could not work out the selling profile.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy('save');
    setError(null);
    try {
      const body = {
        buyers: draft.buyers.filter((b) => b.who.trim() || b.moment.trim()),
        reasons: draft.reasons.filter((r) => r.reason.trim() || r.fact.trim()),
        doubts: draft.doubts.filter((d) => d.doubt.trim()).map((d) => ({ doubt: d.doubt, answer: d.answer?.trim() ? d.answer : null })),
        occasions: draft.occasions.map((o) => o.trim()).filter(Boolean),
      };
      const d = await mk<{ profile: SellingProfile }>(url, { method: 'PUT', body });
      onProfile(d.profile);
      setDraft(null);
      toast.success('Selling profile saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  const unanswered = (profile?.doubts ?? []).filter((d) => !d.answer).length;

  return (
    <Card className="space-y-4" data-testid="selling-profile">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold">Why people buy {productName}</h2>
          <p className="text-sm text-slate-600">The selling profile. Everything the AI writes about this product starts from here, so correct anything that is not right.</p>
        </div>
        {!draft ? (
          <div className="flex flex-wrap gap-2">
            {profile ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft(blank(profile))} disabled={busy !== null} data-testid="profile-edit">Edit</button> : null}
            <button type="button" className={profile ? 'btn btn-secondary btn-sm' : 'btn btn-primary'} onClick={generate} disabled={busy !== null} data-testid="profile-generate">
              {busy === 'ai' ? 'The AI is thinking…' : profile ? 'Work it out again' : 'Work out the selling profile'}
            </button>
          </div>
        ) : null}
      </div>
      <ErrorNote message={error} />

      {!profile && !draft ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Not worked out yet. It takes a few seconds and is saved on the product.</p>
          <button type="button" className="text-sm text-brand-olive-700 underline" onClick={() => setDraft(blank(null))} data-testid="profile-write-own">Or write it yourself</button>
        </div>
      ) : null}

      {profile && !draft ? (
        <div className="space-y-3 text-sm" data-testid="profile-view">
          <div>
            <h3 className="font-semibold text-slate-900">Who buys it</h3>
            <ul className="list-disc pl-5 text-slate-700">{profile.buyers.map((b, i) => <li key={i}><strong>{b.who}</strong>: {b.moment}</li>)}</ul>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Why they want it</h3>
            <ol className="list-decimal pl-5 text-slate-700">{profile.reasons.map((r, i) => <li key={i}>{r.reason} <span className="text-slate-500">(because: {r.fact})</span></li>)}</ol>
          </div>
          {profile.doubts.length > 0 ? (
            <div>
              <h3 className="font-semibold text-slate-900">What makes them hesitate</h3>
              <ul className="list-disc pl-5 text-slate-700">
                {profile.doubts.map((d, i) => (
                  <li key={i}>{d.doubt} {d.answer ? <span className="text-slate-500">{d.answer}</span> : <span className="text-amber-700 font-medium">The AI had no answer. Press Edit and type yours.</span>}</li>
                ))}
              </ul>
              {unanswered > 0 ? <p className="mt-1 text-xs text-slate-500">The AI never guesses an answer. Filling in delivery, returns and how to order under Settings lets it answer more of these.</p> : null}
            </div>
          ) : null}
          {profile.occasions.length > 0 ? <p className="text-slate-700"><span className="font-semibold text-slate-900">Best moments: </span>{profile.occasions.join(', ')}</p> : null}
        </div>
      ) : null}

      {draft ? (
        <div className="space-y-5" data-testid="profile-editor">
          <Rows
            title="Who buys it"
            rows={draft.buyers}
            max={PROFILE_LIMITS.buyers}
            fields={[{ key: 'who', label: 'Who they are' }, { key: 'moment', label: 'The moment they are in' }]}
            empty={{ who: '', moment: '' }}
            onChange={(buyers) => setDraft({ ...draft, buyers })}
          />
          <Rows
            title="Why they want it"
            rows={draft.reasons}
            max={PROFILE_LIMITS.reasons}
            fields={[{ key: 'reason', label: 'What the buyer gets' }, { key: 'fact', label: 'The product fact behind it' }]}
            empty={{ reason: '', fact: '' }}
            onChange={(reasons) => setDraft({ ...draft, reasons })}
          />
          <Rows
            title="What makes them hesitate"
            rows={draft.doubts.map((d) => ({ doubt: d.doubt, answer: d.answer ?? '' }))}
            max={PROFILE_LIMITS.doubts}
            fields={[{ key: 'doubt', label: 'The doubt' }, { key: 'answer', label: 'Your honest answer (leave empty if you have none)' }]}
            empty={{ doubt: '', answer: '' }}
            onChange={(doubts) => setDraft({ ...draft, doubts })}
          />
          <div>
            <label className="label" htmlFor="profile-occasions">Best moments to sell it (one per line)</label>
            <textarea id="profile-occasions" className="input min-h-24" value={draft.occasions.join('\n')} onChange={(e) => setDraft({ ...draft, occasions: e.target.value.split('\n').slice(0, PROFILE_LIMITS.occasions) })} data-testid="profile-occasions" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy !== null} data-testid="profile-save">{busy === 'save' ? 'Saving…' : 'Save the profile'}</button>
            <button type="button" className="btn btn-secondary" onClick={() => { setDraft(null); setError(null); }} disabled={busy !== null}>Cancel</button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** A small editable list of two-box rows. */
function Rows<K extends string>({ title, rows, max, fields, empty, onChange }: {
  title: string;
  rows: Record<K, string>[];
  max: number;
  fields: { key: K; label: string }[];
  empty: Record<K, string>;
  onChange: (rows: Record<K, string>[]) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
          {fields.map((f) => (
            <input key={f.key} className="input" value={r[f.key]} maxLength={PROFILE_LIMITS.text} placeholder={f.label} aria-label={`${title} ${i + 1}: ${f.label}`} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)))} />
          ))}
          <button type="button" className="text-xs text-rose-700 underline" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {rows.length < max ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...rows, { ...empty }])}>Add one</button> : null}
    </div>
  );
}
