'use client';
// ZP-1200: one message: who it would reach, why it cannot be sent yet, approve and send.
// ZP-1117 (MM-12): what was approved (people, criteria, cost) and who would be left out until approved again.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { mk } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';
import { BROADCAST_STATUS_CLASSES, BROADCAST_STATUS_LABELS, MESSAGE_CHANNEL_LABELS, broadcastButtons, progressLine, type BroadcastButton } from '@/lib/marketing/messages-ui';

interface Broadcast { id: number; name: string; channelKind: string; subject: string | null; text: string; templateName: string | null; status: string; purpose: string; approvedBy: string | null; approvedAt: string | null; plannedCount: number; sentCount: number; failedCount: number; skippedCount: number; error: string | null; consentChannel: string }
interface Detail {
  broadcast: Broadcast;
  audience: { eligible: number; matched: number; withheld: { noAddress: number; noConsent: number; optedOut: number } };
  blockedReasons: string[];
  preview: { text: string; subject: string | null };
  sentToday: number;
  dailyCap: number;
  approval: { count: number; costCents: number | null; criteria: { sources?: string[]; contactIds?: number[] } | null; purpose: string; willGet: number; waitingForApproval: number; noLongerEligible: number } | null;
  estimatedCostCents: number | null;
}
const PURPOSE_LABELS: Record<string, string> = { PROMOTION: 'An offer or news (needs agreement to offers)', REVIEW_REQUEST: 'A request for an honest review (needs agreement to feedback requests)' };
const cost = (c: number | null) => (c === null ? 'not known: set the cost per message in Settings' : `about US$${(c / 100).toFixed(2)}`);
const criteriaLine = (c: { sources?: string[]; contactIds?: number[] } | null) => {
  if (!c) return 'everyone who agreed';
  const parts = [c.sources?.length ? `from ${c.sources.join(', ').toLowerCase()}` : null, c.contactIds?.length ? `${c.contactIds.length} chosen people` : null].filter(Boolean);
  return parts.length ? parts.join(', ') : 'everyone who agreed';
};
interface Recipient { id: number; status: string; error: string | null; sentAt: string | null; contact: { id: number; name: string | null; phone: string | null; email: string | null } }
// MM-12-AC6: SENT means the provider accepted it. Nothing here says delivered: the provider has not told us.
const RECIPIENT_LABELS: Record<string, string> = { PENDING: 'Waiting', SENDING: 'Sending', SENT: 'Accepted by the provider (delivery not confirmed)', FAILED: 'Did not go out', SKIPPED: 'Skipped' };

export default function MessagePage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<BroadcastButton | null>(null);
  const [edit, setEdit] = useState({ name: '', subject: '', text: '' });

  const load = useCallback(() => {
    mk<Detail>(`/api/marketing/broadcasts/${id}`)
      .then((x) => { setD(x); setEdit({ name: x.broadcast.name, subject: x.broadcast.subject ?? '', text: x.broadcast.text }); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'));
    mk<{ recipients: Recipient[] }>(`/api/marketing/broadcasts/${id}/recipients`).then((x) => setRecipients(x.recipients)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (b: BroadcastButton) => {
    setConfirm(null); setBusy(true); setError(null); setNote(null);
    try {
      const r = await mk<{ run: { sent: number; failed: number; skipped: number; stoppedBecause: string | null } | null }>(`/api/marketing/broadcasts/${id}/transition`, { method: 'POST', body: { action: b.action } });
      if (r.run) setNote(`This batch: ${r.run.sent} sent, ${r.run.failed} did not go out, ${r.run.skipped} skipped.${r.run.stoppedBecause ? ` Stopped: ${r.run.stoppedBecause}` : ''}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); }
    load(); setBusy(false);
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await mk(`/api/marketing/broadcasts/${id}`, { method: 'PATCH', body: { name: edit.name, text: edit.text, ...(d?.broadcast.channelKind === 'EMAIL' ? { subject: edit.subject } : {}) } });
      setNote('Saved. If it had been approved it is a draft again: approve it again.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    load(); setBusy(false);
  };

  if (!d) return error ? <ErrorNote message={error} /> : <Loading />;
  const b = d.broadcast;
  const buttons = broadcastButtons(b.status, d.approval ? d.approval.willGet : d.audience.eligible);
  const editable = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(b.status);
  const w = d.audience.withheld;

  return (
    <div className="space-y-6">
      <p><Link href="/marketing/messages" className="text-sm text-brand-olive-700 underline">All messages</Link></p>
      <ErrorNote message={error} />
      {note ? <p className="rounded-lg border border-brand-olive-200 bg-brand-olive-50 px-4 py-3 text-sm text-brand-olive-700" role="status" data-testid="message-note">{note}</p> : null}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-serif text-2xl font-semibold text-slate-900">{b.name}</h2>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${BROADCAST_STATUS_CLASSES[b.status]}`} data-testid="message-status">{BROADCAST_STATUS_LABELS[b.status] ?? b.status}</span>
        </div>
        <p className="text-sm text-slate-500">{MESSAGE_CHANNEL_LABELS[b.channelKind]}{b.approvedBy ? ` · approved by ${b.approvedBy}` : ''}</p>
        <p className="text-sm text-slate-600" data-testid="message-purpose">{PURPOSE_LABELS[b.purpose] ?? b.purpose}</p>
        <p className="text-sm" data-testid="message-progress">{progressLine(b)}</p>
        {b.error ? <p className="text-sm text-rose-700">{b.error}</p> : null}
      </Card>

      <Card className="space-y-2" data-testid="message-audience">
        <h3 className="font-semibold text-slate-900">Who would get it</h3>
        <p className="text-3xl font-semibold" data-testid="audience-count">{d.audience.eligible}</p>
        <p className="text-sm text-slate-600">people agreed to hear from you on this channel and have not stopped.</p>
        {d.audience.matched - d.audience.eligible > 0 ? (
          <p className="text-sm text-slate-500">Left out: {w.noConsent} never said yes, {w.optedOut} stopped, {w.noAddress} have no {b.channelKind === 'EMAIL' ? 'email address' : 'phone number'}.</p>
        ) : null}
        <p className="text-sm text-slate-600" data-testid="audience-cost">Estimated cost for them: {cost(d.estimatedCostCents)}.</p>
        <p className="text-xs text-slate-500">Checked again at the moment of sending. Today: {d.sentToday} of {d.dailyCap} messages allowed.</p>
      </Card>

      {d.approval ? (
        <Card className="space-y-2" data-testid="message-approval">
          <h3 className="font-semibold text-slate-900">What was approved</h3>
          <p className="text-sm text-slate-700"><strong>{d.approval.count}</strong> {d.approval.count === 1 ? 'person' : 'people'} ({criteriaLine(d.approval.criteria)}), estimated cost {cost(d.approval.costCents)}.</p>
          <p className="text-sm text-slate-700" data-testid="approval-will-get">Sending now reaches <strong>{d.approval.willGet}</strong> of them.</p>
          {d.approval.noLongerEligible > 0 ? <p className="text-sm text-slate-600">{d.approval.noLongerEligible} stopped or can no longer be messaged since, so they are left out.</p> : null}
          {d.approval.waitingForApproval > 0 ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="approval-waiting">{d.approval.waitingForApproval} more {d.approval.waitingForApproval === 1 ? 'person agreed' : 'people agreed'} after approval. They are not included unless you send it for approval again.</p>
          ) : null}
        </Card>
      ) : null}

      {d.blockedReasons.length > 0 ? (
        <Card className="space-y-2 border-amber-200 bg-amber-50" data-testid="message-blocked">
          <h3 className="font-semibold text-amber-900">Why it cannot be sent right now</h3>
          <ul className="list-disc pl-5 text-sm text-amber-900">{d.blockedReasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </Card>
      ) : <p className="text-sm text-brand-olive-700" data-testid="message-ready">Everything is in place. Pressing send will really message people.</p>}

      <Card className="space-y-3">
        <h3 className="font-semibold text-slate-900">The message</h3>
        {editable ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Changing the words sends it back to a draft: you approve the exact words.</p>
            <div><label className="label" htmlFor="e-name">Name</label><input id="e-name" className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            {b.channelKind === 'EMAIL' ? <div><label className="label" htmlFor="e-subject">Subject</label><input id="e-subject" className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></div> : null}
            <div><label className="label" htmlFor="e-text">Words</label><textarea id="e-text" className="input min-h-32" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} data-testid="edit-text" /></div>
            <button type="button" className="btn btn-secondary" disabled={busy || (edit.text === b.text && edit.name === b.name && edit.subject === (b.subject ?? ''))} onClick={save}>Save changes</button>
          </div>
        ) : null}
        <h4 className="font-semibold text-slate-900 text-sm">What the first person would get</h4>
        {d.preview.subject ? <p className="text-sm"><strong>Subject:</strong> {d.preview.subject}</p> : null}
        <pre className="whitespace-pre-wrap rounded bg-white border border-slate-200 p-3 text-sm" data-testid="message-preview">{d.preview.text}</pre>
        {b.templateName ? <p className="text-xs text-slate-500">WhatsApp template: {b.templateName}</p> : null}
      </Card>

      {buttons.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="message-actions">
          {buttons.map((a) => (
            <button key={a.action} type="button" className={a.tone === 'primary' ? 'btn btn-primary min-h-12' : a.tone === 'danger' ? 'btn btn-danger min-h-12' : 'btn btn-secondary min-h-12'} disabled={busy} onClick={() => (a.confirm ? setConfirm(a) : run(a))} data-testid={`message-action-${a.action}`}>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}

      {recipients.length > 0 ? (
        <Card>
          <h3 className="font-semibold text-slate-900 mb-2">People</h3>
          <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100 text-sm" data-testid="recipient-list">
            {recipients.map((r) => (
              <li key={r.id} className="py-2">
                {r.contact.name || r.contact.phone || r.contact.email} · {RECIPIENT_LABELS[r.status] ?? r.status}{r.error ? <span className="block text-xs text-rose-700">{r.error}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ConfirmDialog open={confirm !== null} title={confirm?.label ?? ''} message={confirm?.confirm ?? ''} confirmText={confirm?.label} variant={confirm?.tone === 'danger' ? 'danger' : 'default'} onConfirm={() => confirm && run(confirm)} onCancel={() => setConfirm(null)} />
    </div>
  );
}
