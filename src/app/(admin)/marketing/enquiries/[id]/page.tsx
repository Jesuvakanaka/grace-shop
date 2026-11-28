'use client';
// ZP-1116 (MM-11): one enquiry. Reply suggestions to copy (VYRA sends nothing), move it on, link the sale it became,
// settle who it is from, and its full history. Winning adds no money: the sale is the money.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { mk } from '@/components/marketing/api';
import { Card, ErrorNote, Loading } from '@/components/marketing/parts';
import { CONVERSATION_LABELS, ENQUIRY_CHANNEL_LABELS, ENQUIRY_STATUS_CLASSES, ENQUIRY_STATUS_LABELS, EVENT_LABELS, followUpLine } from '@/lib/marketing/enquiries-ui';

interface Enquiry {
  id: number; contactId: number | null; contactName: string | null; customerName: string | null; customerPhone: string | null; channelKind: string; conversation: string
  sourceEvidence: string | null; campaignId: number | null; message: string | null; status: string; assignedTo: string | null; nextFollowUpAt: string | null; lostReason: string | null
  saleId: number | null; needsContactReview: boolean; contactCandidates: number[]; createdAt: string
}
interface Event { id: number; kind: string; fromStatus: string | null; toStatus: string | null; detail: Record<string, unknown> | null; actor: string; at: string }
interface Suggestion { kind: 'SERVICE' | 'WITH_OFFER'; text: string; note: string }
interface Detail { enquiry: Enquiry; events: Event[]; suggestions: Suggestion[] }

const harare = (s: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' }).format(new Date(s));

export default function EnquiryPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [candidates, setCandidates] = useState<{ id: number; name: string | null; phone: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [move, setMove] = useState({ status: '', saleId: '', lostReason: '' });
  const [follow, setFollow] = useState('');
  const [comment, setComment] = useState('');

  const load = useCallback(() => {
    mk<Detail>(`/api/marketing/enquiries/${id}`)
      .then((x) => {
        setD(x);
        setReply((r) => r || x.suggestions[0]?.text || '');
        Promise.all(x.enquiry.contactCandidates.map((c) => mk<{ contact: { id: number; name: string | null; phone: string | null } }>(`/api/marketing/contacts/${c}`).then((y) => y.contact).catch(() => null)))
          .then((cs) => setCandidates(cs.filter((c): c is { id: number; name: string | null; phone: string | null } => c !== null)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(null); setNote(null);
    try { await fn(); setNote(done); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); }
    load(); setBusy(false);
  };
  const copy = (text: string) => act(async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* the owner can still select the text */ }
    await mk(`/api/marketing/enquiries/${id}/reply`, { method: 'POST', body: { text, action: 'COPIED' } });
  }, 'Copied. Paste it into your chat with them: VYRA has not sent anything.');
  const sentMyself = () => act(() => mk(`/api/marketing/enquiries/${id}/reply`, { method: 'POST', body: { text: reply, action: 'SENT_BY_OWNER' } }), 'Written down that you sent it yourself.');
  const doMove = () => act(() => mk(`/api/marketing/enquiries/${id}/status`, { method: 'POST', body: { status: move.status, ...(move.status === 'WON' ? { saleId: Number(move.saleId) } : {}), ...(move.status === 'LOST' && move.lostReason.trim() ? { lostReason: move.lostReason } : {}) } }), 'Moved.');

  if (!d) return error ? <ErrorNote message={error} /> : <Loading />;
  const e = d.enquiry;
  const closed = e.status === 'WON' || e.status === 'LOST';

  return (
    <div className="space-y-6">
      <p><Link href="/marketing/enquiries" className="text-sm text-brand-olive-700 underline">All enquiries</Link></p>
      <ErrorNote message={error} />
      {note ? <p className="rounded-lg border border-brand-olive-200 bg-brand-olive-50 px-4 py-3 text-sm text-brand-olive-700" role="status" data-testid="enquiry-note">{note}</p> : null}

      <Card className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-serif text-2xl font-semibold text-slate-900">{e.contactName ?? e.customerName ?? e.customerPhone ?? 'Someone'}</h2>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${ENQUIRY_STATUS_CLASSES[e.status] ?? ''}`} data-testid="enquiry-status">{ENQUIRY_STATUS_LABELS[e.status] ?? e.status}</span>
        </div>
        <p className="text-sm text-slate-500">{ENQUIRY_CHANNEL_LABELS[e.channelKind] ?? e.channelKind} · {CONVERSATION_LABELS[e.conversation] ?? e.conversation} · {harare(e.createdAt)}</p>
        {e.customerPhone ? <p className="text-sm text-slate-600">{e.customerPhone}</p> : null}
        {e.message ? <p className="whitespace-pre-wrap rounded bg-white border border-slate-200 p-3 text-sm">{e.message}</p> : null}
        {e.sourceEvidence ? <p className="text-sm text-slate-600">How they found you: {e.sourceEvidence}</p> : null}
        <p className="text-sm text-slate-600">{followUpLine(e.nextFollowUpAt, e.status)}{e.assignedTo ? ` · with ${e.assignedTo}` : ''}</p>
        {e.saleId ? <p className="text-sm text-brand-olive-700" data-testid="enquiry-sale">Became sale {e.saleId}. The money is counted once, on that sale.</p> : null}
        {e.lostReason ? <p className="text-sm text-slate-600">Lost: {e.lostReason}</p> : null}
      </Card>

      {e.needsContactReview ? (
        <Card className="space-y-2 border-amber-200 bg-amber-50" data-testid="enquiry-review">
          <h3 className="font-semibold text-amber-900">Who is this?</h3>
          <p className="text-sm text-amber-900">We are not sure which contact this is, so it is not linked yet. Choose one, or say it is nobody you know.</p>
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => (
              <button key={c.id} type="button" className="btn btn-secondary min-h-12" disabled={busy} onClick={() => act(() => mk(`/api/marketing/enquiries/${id}/contact`, { method: 'POST', body: { contactId: c.id } }), 'Linked.')} data-testid={`enquiry-candidate-${c.id}`}>{c.name ?? 'No name'}{c.phone ? ` · ${c.phone}` : ''}</button>
            ))}
            <button type="button" className="btn btn-secondary min-h-12" disabled={busy} onClick={() => act(() => mk(`/api/marketing/enquiries/${id}/contact`, { method: 'POST', body: { contactId: null } }), 'Left unlinked.')}>None of these</button>
          </div>
        </Card>
      ) : null}

      <Card className="space-y-3" data-testid="enquiry-replies">
        <h3 className="font-semibold text-slate-900">Reply</h3>
        <p className="text-xs text-slate-500">Suggestions use today&apos;s stock and prices. VYRA does not send replies: copy one and send it from your phone.</p>
        {d.suggestions.map((s) => (
          <div key={s.kind} className="rounded border border-slate-200 bg-white p-3 space-y-2" data-testid={`suggestion-${s.kind}`}>
            <p className="text-sm whitespace-pre-wrap">{s.text}</p>
            <p className="text-xs text-slate-500">{s.note}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary min-h-12" disabled={busy} onClick={() => copy(s.text)} data-testid={`copy-${s.kind}`}>Copy</button>
              <button type="button" className="btn btn-secondary min-h-12" onClick={() => setReply(s.text)}>Edit this one</button>
            </div>
          </div>
        ))}
        {d.suggestions.length === 1 ? <p className="text-xs text-slate-500" data-testid="service-only">They have not agreed to offers on this channel, so only a plain answer is suggested.</p> : null}
        <label className="label" htmlFor="r-text">Your words</label>
        <textarea id="r-text" className="input min-h-24" value={reply} onChange={(ev) => setReply(ev.target.value)} maxLength={4000} data-testid="reply-text" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary min-h-12" disabled={busy || !reply.trim()} onClick={() => copy(reply)}>Copy my words</button>
          <button type="button" className="btn btn-secondary min-h-12" disabled={busy || !reply.trim()} onClick={sentMyself} data-testid="reply-sent-myself">I sent this myself</button>
        </div>
      </Card>

      <Card className="space-y-3" data-testid="enquiry-move">
        <h3 className="font-semibold text-slate-900">{closed ? 'Reopen or change' : 'Move it on'}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="m-status">Now</label>
            <select id="m-status" className="select" value={move.status} onChange={(ev) => setMove({ ...move, status: ev.target.value })} data-testid="move-status">
              <option value="">Choose…</option>
              {Object.entries(ENQUIRY_STATUS_LABELS).filter(([k]) => k !== e.status).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {move.status === 'WON' ? (
            <div><label className="label" htmlFor="m-sale">Sale number (from the sales log)</label><input id="m-sale" className="input" inputMode="numeric" value={move.saleId} onChange={(ev) => setMove({ ...move, saleId: ev.target.value.replace(/\D/g, '') })} data-testid="move-sale" /></div>
          ) : null}
          {move.status === 'LOST' ? (
            <div><label className="label" htmlFor="m-lost">Why (optional)</label><input id="m-lost" className="input" value={move.lostReason} onChange={(ev) => setMove({ ...move, lostReason: ev.target.value })} maxLength={500} /></div>
          ) : null}
        </div>
        {move.status === 'WON' ? <p className="text-xs text-slate-500">Record the sale first in the daily log. Winning links to it and adds no money of its own.</p> : null}
        <button type="button" className="btn btn-primary min-h-12" disabled={busy || !move.status || (move.status === 'WON' && !move.saleId)} onClick={doMove} data-testid="move-save">Save</button>
        {!closed ? (
          <div className="grid gap-3 sm:grid-cols-2 pt-2">
            <div><label className="label" htmlFor="m-follow">Next follow-up</label><input id="m-follow" className="input" type="datetime-local" value={follow} onChange={(ev) => setFollow(ev.target.value)} /></div>
            <div className="flex items-end"><button type="button" className="btn btn-secondary min-h-12" disabled={busy || !follow} onClick={() => act(() => mk(`/api/marketing/enquiries/${id}`, { method: 'PATCH', body: { nextFollowUpAt: new Date(follow).toISOString() } }), 'Follow-up set.')}>Set follow-up</button></div>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="m-note">Note</label><input id="m-note" className="input" value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={2000} /></div>
          <div className="flex items-end"><button type="button" className="btn btn-secondary min-h-12" disabled={busy || !comment.trim()} onClick={() => act(async () => { await mk(`/api/marketing/enquiries/${id}`, { method: 'PATCH', body: { note: comment } }); setComment(''); }, 'Note added.')}>Add note</button></div>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-slate-900 mb-2">History</h3>
        <ol className="divide-y divide-slate-100 text-sm" data-testid="enquiry-history">
          {d.events.map((ev) => (
            <li key={ev.id} className="py-2">
              <span className="font-medium">{EVENT_LABELS[ev.kind] ?? ev.kind}</span>
              {ev.toStatus ? ` · ${ev.fromStatus ? `${ENQUIRY_STATUS_LABELS[ev.fromStatus] ?? ev.fromStatus} → ` : ''}${ENQUIRY_STATUS_LABELS[ev.toStatus] ?? ev.toStatus}` : ''}
              {typeof ev.detail?.note === 'string' ? ` · ${ev.detail.note}` : ''}
              {typeof ev.detail?.saleId === 'number' ? ` · sale ${ev.detail.saleId}` : ''}
              {typeof ev.detail?.lostReason === 'string' ? ` · ${ev.detail.lostReason}` : ''}
              <span className="block text-xs text-slate-500">{ev.actor} · {harare(ev.at)}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
