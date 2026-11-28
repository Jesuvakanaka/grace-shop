'use client';
// ZP-1200: messages to your own contacts (email, texts, WhatsApp templates). Only people who agreed, only after you approve.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { mk } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';
import { BROADCAST_STATUS_CLASSES, BROADCAST_STATUS_LABELS, MESSAGE_CHANNEL_LABELS, SOURCE_LABELS, progressLine } from '@/lib/marketing/messages-ui';

interface Row { id: number; name: string; channelKind: string; status: string; plannedCount: number; sentCount: number; failedCount: number; skippedCount: number; createdAt: string }
const LIMITS: Record<string, number> = { SMS: 290, WHATSAPP_CLOUD: 1024, EMAIL: 20000 };

export default function MessagesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cap, setCap] = useState('');
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [f, setF] = useState({ channelKind: 'SMS', name: '', subject: '', text: '', templateName: '', templateLanguage: 'en', templateVars: '', sources: [] as string[], purpose: 'PROMOTION' });

  const load = useCallback(() => {
    mk<{ broadcasts: Row[] }>('/api/marketing/broadcasts').then((d) => setRows(d.broadcasts)).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'));
    mk<{ settings: { messageDailyCap: number; messageCostCents: Record<string, number> } }>('/api/marketing/settings').then((d) => {
      setCap(String(d.settings.messageDailyCap));
      setCosts(Object.fromEntries(Object.entries(d.settings.messageCostCents ?? {}).map(([k, v]) => [k, String(v)])));
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const wa = f.channelKind === 'WHATSAPP_CLOUD';
      const { broadcast } = await mk<{ broadcast: { id: number } }>('/api/marketing/broadcasts', {
        method: 'POST',
        body: {
          channelKind: f.channelKind, name: f.name, text: f.text, purpose: f.purpose,
          ...(f.channelKind === 'EMAIL' ? { subject: f.subject } : {}),
          ...(wa ? { templateName: f.templateName || null, templateLanguage: f.templateLanguage, templateVars: f.templateVars.split('\n').map((v) => v.trim()).filter(Boolean) } : {}),
          audienceFilter: f.sources.length ? { sources: f.sources } : {},
        },
      });
      router.push(`/marketing/messages/${broadcast.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); setBusy(false); }
  };
  const saveCap = async () => {
    setError(null);
    // MM-12-AC3: an empty cost means "not known", and approval then says so instead of guessing.
    const messageCostCents = Object.fromEntries(Object.entries(costs).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)]));
    try { await mk('/api/marketing/settings', { method: 'PUT', body: { messageDailyCap: Number(cap), messageCostCents } }); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
  };
  const limit = LIMITS[f.channelKind];

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      <Card>
        <p className="text-sm text-slate-600 mb-3">A message goes only to people who agreed to hear from you <strong>on that channel</strong> and have not stopped. Nothing is sent until you approve the exact words and live sending is switched on in Settings.</p>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2" data-testid="message-form">
          <div>
            <label className="label" htmlFor="m-channel">How</label>
            <select id="m-channel" className="select" value={f.channelKind} onChange={(e) => setF({ ...f, channelKind: e.target.value })} data-testid="message-channel">
              {Object.entries(MESSAGE_CHANNEL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="m-name">Name (for you)</label><input id="m-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} required data-testid="message-name" /></div>
          {f.channelKind === 'EMAIL' ? <div className="sm:col-span-2"><label className="label" htmlFor="m-subject">Subject</label><input id="m-subject" className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} data-testid="message-subject" /></div> : null}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="m-text">{f.channelKind === 'WHATSAPP_CLOUD' ? 'Words of the approved template (so you can check them)' : 'Words'}</label>
            <textarea id="m-text" className="input min-h-32" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} required data-testid="message-text" />
            <p className="mt-1 text-xs text-slate-500">{f.text.length} of {limit} characters. Write {'{name}'} to put in their first name. Links to your shop are tracked automatically.{f.channelKind === 'SMS' ? ' Every text ends with "Reply STOP to opt out."' : ''}{f.channelKind === 'EMAIL' ? ' Every email gets an unsubscribe link.' : ''}</p>
          </div>
          {f.channelKind === 'WHATSAPP_CLOUD' ? (
            <>
              <div><label className="label" htmlFor="m-tpl">Template name (as approved by Meta)</label><input id="m-tpl" className="input" placeholder="new_arrivals" value={f.templateName} onChange={(e) => setF({ ...f, templateName: e.target.value })} data-testid="message-template" /></div>
              <div><label className="label" htmlFor="m-lang">Template language</label><input id="m-lang" className="input" value={f.templateLanguage} onChange={(e) => setF({ ...f, templateLanguage: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="m-vars">Template fields, one per line ({'{name}'} = first name)</label><textarea id="m-vars" className="input min-h-20" value={f.templateVars} onChange={(e) => setF({ ...f, templateVars: e.target.value })} /></div>
            </>
          ) : null}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="m-purpose">What it is for</label>
            <select id="m-purpose" className="select" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} data-testid="message-purpose">
              <option value="PROMOTION">An offer or news: goes to people who agreed to offers</option>
              <option value="REVIEW_REQUEST">Asking for an honest review: goes to people who agreed to feedback requests</option>
            </select>
            {f.purpose === 'REVIEW_REQUEST' ? <p className="mt-1 text-xs text-slate-500">Ask for an honest review. Never ask only for good ones, and never offer anything for a review.</p> : null}
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="label">Who (only people who agreed are ever included)</legend>
            <div className="flex flex-wrap gap-4">
              {Object.entries(SOURCE_LABELS).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.sources.includes(k)} onChange={(e) => setF({ ...f, sources: e.target.checked ? [...f.sources, k] : f.sources.filter((s) => s !== k) })} />{l}</label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">Tick none to include everyone who agreed.</p>
          </fieldset>
          <div className="sm:col-span-2"><button type="submit" className="btn btn-primary" disabled={busy || f.name.trim() === '' || f.text.trim() === ''} data-testid="message-create">Save as a draft</button></div>
        </form>
      </Card>

      <Card>
        <label className="label" htmlFor="m-cap">Most messages to send in one day (all channels together)</label>
        <div className="flex flex-wrap items-center gap-3">
          <input id="m-cap" className="input max-w-32" type="number" min={0} max={10000} value={cap} onChange={(e) => setCap(e.target.value)} data-testid="message-cap" />
        </div>
        <p className="label mt-4">What one message costs you, in US cents (leave empty if you do not know)</p>
        <div className="grid gap-3 sm:grid-cols-3" data-testid="message-costs">
          {Object.entries(MESSAGE_CHANNEL_LABELS).map(([k, l]) => (
            <div key={k}><label className="text-sm text-slate-600" htmlFor={`m-cost-${k}`}>{l}</label><input id={`m-cost-${k}`} className="input" type="number" min={0} max={1000} step="0.1" value={costs[k] ?? ''} onChange={(e) => setCosts({ ...costs, [k]: e.target.value })} data-testid={`message-cost-${k}`} /></div>
          ))}
        </div>
        <button type="button" className="btn btn-secondary mt-3" onClick={saveCap} disabled={cap === ''}>Save limit and costs</button>
        <p className="mt-1 text-xs text-slate-500">Messages go out gently, about one a second. Each text or WhatsApp message costs money: start small.</p>
      </Card>

      {!rows && !error ? <Loading /> : null}
      {rows && rows.length === 0 ? <EmptyState icon="💬" title="No messages yet" description="Write a message above, then send it for approval." /> : null}
      <ul className="space-y-3" data-testid="message-list">
        {rows?.map((b) => (
          <li key={b.id}>
            <Link href={`/marketing/messages/${b.id}`} className="card flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50" data-testid={`message-${b.id}`}>
              <div>
                <p className="font-semibold text-slate-900">{b.name}</p>
                <p className="text-sm text-slate-500">{MESSAGE_CHANNEL_LABELS[b.channelKind] ?? b.channelKind} · {progressLine(b)}</p>
              </div>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${BROADCAST_STATUS_CLASSES[b.status]}`}>{BROADCAST_STATUS_LABELS[b.status] ?? b.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
