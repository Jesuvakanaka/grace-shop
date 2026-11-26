'use client';
// ZP-1200: contacts and consent. Nobody is ever marked as agreeing automatically: only you, or a clear "yes" in an imported file you confirm.
import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { mk } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';
import { CONSENT_CHANNEL_LABELS, CONSENT_STATE_CLASSES, CONSENT_STATE_LABELS, SOURCE_LABELS } from '@/lib/marketing/messages-ui';

const CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL'] as const;
type Consent = Record<(typeof CHANNELS)[number], string>;
interface Contact { id: number; name: string | null; phone: string | null; email: string | null; source: string; notes: string | null; consent: Consent }
interface HistoryRow { id: number; channel: string; status: string; method: string; evidence: string | null; recordedBy: string; recordedAt: string }
interface Plan {
  rows: { line: number; name: string | null; phone: string | null; email: string | null; action: string; problems: string[]; consent: { channel: string; status: string }[] }[];
  hasConsentColumns: boolean;
  totals: { create: number; update: number; skip: number; optIns: number; optOuts: number; ignoredOptIns: number };
}

function ConsentBadges({ consent }: { consent: Consent }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {CHANNELS.map((c) => (
        <span key={c} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${CONSENT_STATE_CLASSES[consent[c]]}`} data-testid={`consent-${c.toLowerCase()}`}>
          {CONSENT_CHANNEL_LABELS[c]}: {CONSENT_STATE_LABELS[consent[c]]}
        </span>
      ))}
    </span>
  );
}

function ContactDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ channel: 'WHATSAPP', status: 'OPTED_IN', method: '', evidence: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    mk<{ history: HistoryRow[] }>(`/api/marketing/contacts/${id}`).then((d) => setHistory(d.history)).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await mk(`/api/marketing/contacts/${id}/consent`, { method: 'POST', body: { channel: f.channel, status: f.status, method: f.method, evidence: f.evidence.trim() || undefined } });
      setF({ ...f, method: '', evidence: '' });
      load(); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    setBusy(false);
  };
  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3" data-testid={`contact-detail-${id}`}>
      <ErrorNote message={error} />
      <h4 className="font-semibold text-slate-900">Consent history</h4>
      {!history ? <Loading /> : history.length === 0 ? <p className="text-sm text-slate-500">Nothing recorded. This person will not be messaged.</p> : (
        <ul className="space-y-1 text-sm" data-testid="consent-history">
          {history.map((h, i) => (
            <li key={h.id} className={i === 0 ? 'font-medium' : 'text-slate-600'}>
              {new Date(h.recordedAt).toLocaleDateString()} · {CONSENT_CHANNEL_LABELS[h.channel]}: {h.status === 'OPTED_IN' ? 'agreed' : 'stopped'} · {h.method}{h.evidence ? ` (${h.evidence})` : ''} · by {h.recordedBy}{i === 0 ? ' (this one counts)' : ''}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" data-testid="consent-form">
        <div>
          <label className="label" htmlFor={`cc-${id}`}>Channel</label>
          <select id={`cc-${id}`} className="select" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
            {CHANNELS.map((c) => <option key={c} value={c}>{CONSENT_CHANNEL_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`cs-${id}`}>What happened</label>
          <select id={`cs-${id}`} className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="OPTED_IN">They agreed to hear from us</option>
            <option value="OPTED_OUT">They asked us to stop</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`cm-${id}`}>How did they say so? (needed)</label>
          <input id={`cm-${id}`} className="input" placeholder="For example: said yes on WhatsApp on 26 Nov" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} maxLength={300} required />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`ce-${id}`}>Proof (optional)</label>
          <input id={`ce-${id}`} className="input" placeholder="For example: screenshot saved in the Marketing folder" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} maxLength={1000} />
        </div>
        <div className="sm:col-span-2"><button type="submit" className="btn btn-primary" disabled={busy || f.method.trim() === ''}>Save</button></div>
      </form>
    </div>
  );
}

function ImportCard({ onDone }: { onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const readFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name); setPlan(null); setDone(null);
    file.text().then(setCsv).catch(() => setError('Could not read that file.'));
  };
  const preview = async () => {
    setBusy(true); setError(null); setDone(null); setConfirm(false);
    try { setPlan((await mk<{ plan: Plan }>('/api/marketing/contacts/import', { method: 'POST', body: { csv, fileName: fileName || undefined } })).plan); }
    catch (err) { setPlan(null); setError(err instanceof Error ? err.message : 'Could not read the file.'); }
    setBusy(false);
  };
  const commit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await mk<{ created: number; updated: number }>('/api/marketing/contacts/import', { method: 'POST', body: { csv, fileName: fileName || undefined, commit: true, confirmConsent: confirm } });
      setDone(`Added ${r.created} new and updated ${r.updated}.`); setPlan(null); setCsv(''); onDone();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not import.'); }
    setBusy(false);
  };
  const t = plan?.totals;
  return (
    <Card>
      <h3 className="font-semibold text-slate-900 mb-1">Import from a file</h3>
      <p className="text-sm text-slate-600 mb-3">A CSV file with the columns <code>name</code>, <code>phone</code>, <code>email</code>. Nobody is marked as agreeing to messages unless the file has a column <code>whatsapp_consent</code>, <code>sms_consent</code> or <code>email_consent</code> with a clear yes or no (and ideally <code>consent_method</code> saying how they agreed). Look at the preview first: nothing is saved until you press Import.</p>
      <ErrorNote message={error} />
      {done ? <p className="mb-3 rounded-lg border border-brand-olive-200 bg-brand-olive-50 px-4 py-3 text-sm text-brand-olive-700" role="status">{done}</p> : null}
      <input type="file" accept=".csv,text/csv" className="mb-3 block text-sm" onChange={(e) => readFile(e.target.files?.[0])} data-testid="import-file" />
      <textarea className="input min-h-28 font-mono text-xs" placeholder={'name,phone,email\nTendai Moyo,0771234567,'} value={csv} onChange={(e) => { setCsv(e.target.value); setPlan(null); }} data-testid="import-csv" />
      <div className="mt-3"><button type="button" className="btn btn-secondary" disabled={busy || csv.trim() === ''} onClick={preview} data-testid="import-preview">Preview</button></div>
      {plan && t ? (
        <div className="mt-4 space-y-3" data-testid="import-plan">
          <p className="text-sm"><strong>{t.create}</strong> new, <strong>{t.update}</strong> already known, <strong>{t.skip}</strong> skipped.{' '}
            {plan.hasConsentColumns ? <>The file says <strong>yes</strong> for {t.optIns} and <strong>no</strong> for {t.optOuts}{t.ignoredOptIns ? `; ${t.ignoredOptIns} yes ignored` : ''}.</> : <>The file has no consent column, so <strong>nobody will be marked as agreeing</strong>. You can record that for each person afterwards.</>}</p>
          <ul className="max-h-60 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {plan.rows.slice(0, 200).map((r) => (
              <li key={r.line} className="p-2">
                <span className="font-medium">{r.name ?? r.phone ?? r.email ?? `Line ${r.line}`}</span>{' '}
                <span className="text-slate-500">{r.action === 'create' ? 'will be added' : r.action === 'update' ? 'already known' : 'skipped'}{r.consent.map((c) => ` · ${CONSENT_CHANNEL_LABELS[c.channel]}: ${c.status === 'OPTED_IN' ? 'agreed' : 'stopped'}`).join('')}</span>
                {r.problems.length ? <span className="block text-xs text-amber-700">{r.problems.join('; ')}</span> : null}
              </li>
            ))}
          </ul>
          {t.optIns > 0 ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} data-testid="import-confirm" />
              <span>I confirm these {t.optIns} people really agreed to hear from us on that channel.</span>
            </label>
          ) : null}
          <button type="button" className="btn btn-primary" disabled={busy || (t.create + t.update === 0) || (t.optIns > 0 && !confirm)} onClick={commit} data-testid="import-commit">Import</button>
        </div>
      ) : null}
    </Card>
  );
}

export default function ContactsPage() {
  const [items, setItems] = useState<Contact[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', email: '', notes: '', method: '', WHATSAPP: false, SMS: false, EMAIL: false });

  const load = useCallback(() => {
    const [channel, status] = filter ? filter.split(':') : ['', ''];
    const qs = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(channel ? { channel, status } : {}) });
    mk<{ contacts: Contact[]; total: number }>(`/api/marketing/contacts?${qs}`)
      .then((d) => { setItems(d.contacts); setTotal(d.total); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load contacts.'));
  }, [q, filter]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const agreed = CHANNELS.filter((c) => f[c]);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { contact } = await mk<{ contact: Contact }>('/api/marketing/contacts', { method: 'POST', body: { name: f.name || null, phone: f.phone || null, email: f.email || null, notes: f.notes || null } });
      for (const c of agreed) await mk(`/api/marketing/contacts/${contact.id}/consent`, { method: 'POST', body: { channel: c, status: 'OPTED_IN', method: f.method } });
      setF({ name: '', phone: '', email: '', notes: '', method: '', WHATSAPP: false, SMS: false, EMAIL: false });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); load(); }
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      <Card>
        <p className="text-sm text-slate-600 mb-3">You can only message people who have told you they want to hear from you, on that exact channel. A new contact starts with <strong>no</strong> permission.</p>
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2" data-testid="contact-form">
          <div><label className="label" htmlFor="ct-name">Name</label><input id="ct-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} data-testid="contact-name" /></div>
          <div><label className="label" htmlFor="ct-phone">Phone (Zimbabwe numbers can start 07 or +263)</label><input id="ct-phone" className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="contact-phone" /></div>
          <div><label className="label" htmlFor="ct-email">Email</label><input id="ct-email" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="contact-email" /></div>
          <div><label className="label" htmlFor="ct-notes">Note (optional)</label><input id="ct-notes" className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={1000} /></div>
          <fieldset className="sm:col-span-2">
            <legend className="label">They told me they want to hear from us by (leave empty if not)</legend>
            <div className="flex flex-wrap gap-4">
              {CHANNELS.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f[c]} onChange={(e) => setF({ ...f, [c]: e.target.checked })} />{CONSENT_CHANNEL_LABELS[c]}</label>
              ))}
            </div>
          </fieldset>
          {agreed.length > 0 ? (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="ct-method">How did they say so? (needed)</label>
              <input id="ct-method" className="input" placeholder="For example: said yes on WhatsApp on 26 Nov" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} maxLength={300} data-testid="contact-method" />
            </div>
          ) : null}
          <div className="sm:col-span-2"><button type="submit" className="btn btn-primary" disabled={busy || (f.phone.trim() === '' && f.email.trim() === '') || (agreed.length > 0 && f.method.trim() === '')} data-testid="contact-add">Add contact</button></div>
        </form>
      </Card>

      <div className="flex flex-wrap gap-3">
        <input className="input max-w-xs" type="search" placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" data-testid="contact-search" />
        <select className="select max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by consent">
          <option value="">Everyone</option>
          {CHANNELS.map((c) => <option key={c} value={`${c}:OPTED_IN`}>Agreed to {CONSENT_CHANNEL_LABELS[c]}</option>)}
          {CHANNELS.map((c) => <option key={`o${c}`} value={`${c}:OPTED_OUT`}>Stopped {CONSENT_CHANNEL_LABELS[c]}</option>)}
        </select>
      </div>

      {!items && !error ? <Loading /> : null}
      {items && items.length === 0 ? <EmptyState icon="📇" title="No contacts yet" description="Add the people who asked to hear from you. Contacts from enquiries are not added automatically: the website does not keep phone numbers." /> : null}
      {items ? <p className="text-sm text-slate-500" data-testid="contact-total">{total} {total === 1 ? 'contact' : 'contacts'}</p> : null}
      <ul className="space-y-3" data-testid="contact-list">
        {items?.map((c) => (
          <li key={c.id} className="card" data-testid={`contact-${c.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{c.name || c.phone || c.email}</p>
                <p className="text-sm text-slate-500">{[c.phone, c.email].filter(Boolean).join(' · ')} · {SOURCE_LABELS[c.source] ?? c.source}</p>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>{open === c.id ? 'Close' : 'Consent'}</button>
            </div>
            <div className="mt-2"><ConsentBadges consent={c.consent} /></div>
            {open === c.id ? <ContactDetail id={c.id} onChanged={load} /> : null}
          </li>
        ))}
      </ul>
      <ImportCard onDone={load} />
    </div>
  );
}
