'use client';
// "Customers": WhatsApp enquiries from fictional customers. Reply with an editable
// suggestion, follow up, record a sale, mark lost, and respect marketing opt-outs.
import React, { useState } from 'react';
import { channelById, productById, type ChannelId } from '../catalog';
import { addDays, fmtShort, money, relDay } from '../dates';
import { totals } from '../engine';
import { useDemo } from '../store';
import type { Enquiry, Source } from '../types';
import { RichText } from '../previews';
import { Dialog, Empty, Icon, Note, PageTitle, Pill, SectionTitle, Simulated } from '../ui';

const TABS = [
  { key: 'new', label: 'New enquiries' },
  { key: 'waiting', label: 'Waiting for my reply' },
  { key: 'followup', label: 'Follow-up due' },
  { key: 'replied', label: 'Replied' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const REPORTED_CHOICES: { id: ChannelId; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'whatsapp_status', label: 'WhatsApp Status' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'referrals', label: 'A friend or family member' },
];

function sourceText(src: Source) {
  if (src.kind === 'tracked') return { tone: 'olive' as const, label: `Tracked: ${channelById(src.channel!).name}` };
  if (src.kind === 'reported') return { tone: 'sky' as const, label: `Customer said: ${src.channel ? channelById(src.channel).name : 'other'}` };
  return { tone: 'slate' as const, label: 'Source unknown' };
}

const inTab = (e: Enquiry, tab: TabKey, today: string) =>
  tab === 'followup' ? !!e.followUp && e.followUp.date <= addDays(today, 7) : e.stage === tab;

export function CustomersScreen() {
  const { route } = useDemo();
  if (route[1] === 'e' && route[2]) return <EnquiryDetail id={route[2]} />;
  return <EnquiryList tab={(TABS.find((t) => t.key === route[1])?.key ?? 'new') as TabKey} />;
}

function EnquiryList({ tab }: { tab: TabKey }) {
  const { state, dispatch } = useDemo();
  const t = totals(state, 'all');
  const list = state.enquiries.filter((e) => inTab(e, tab, state.today)).sort((a, b) => (tab === 'followup' ? (a.followUp!.date.localeCompare(b.followUp!.date)) : b.created.localeCompare(a.created)));
  const count = (k: TabKey) => state.enquiries.filter((e) => inTab(e, k, state.today)).length;

  return (
    <div>
      <PageTitle eyebrow="Customers" title="WhatsApp enquiries" hint="Your shop sends shoppers to WhatsApp to ask and order. Every conversation here is a fictional sample customer." />

      <Note className="mb-5">
        <strong>{t.clicks} taps</strong> on &ldquo;Ask on WhatsApp&rdquo; so far, but only <strong>{state.enquiries.length} people</strong> actually sent a message. A tap only opens WhatsApp: you can not see or reply to people who did not send anything.
      </Note>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Enquiry stage">
        {TABS.map((x) => (
          <a key={x.key} href={`#/customers/${x.key}`} role="tab" aria-selected={tab === x.key} className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm ${tab === x.key ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
            {x.label}<span className={`rounded-full px-1.5 text-xs ${tab === x.key ? 'bg-white/20' : 'bg-slate-100'}`}>{count(x.key)}</span>
          </a>
        ))}
      </div>

      {list.length ? (
        <ul className="space-y-2.5">
          {list.map((e) => {
            const c = state.customers.find((x) => x.id === e.customerId);
            const p = productById(e.productId);
            const src = sourceText(e.source);
            return (
              <li key={e.id}>
                <a href={`#/customers/e/${e.id}`} onClick={() => { if (e.stage === 'new') dispatch({ type: 'enquiry/open', id: e.id }); }} className="card-hover flex gap-3 !p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- fixed local lookbook file */}
                  <img src={p.image} alt="" className="h-16 w-12 shrink-0 rounded object-cover object-top" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{c?.name}</span>
                      {e.stage === 'new' ? <Pill tone="lime">New</Pill> : e.stage === 'waiting' ? <Pill tone="amber">Waiting for you</Pill> : null}
                      {!c?.marketingOk ? <Pill>No promotions</Pill> : null}
                    </div>
                    <p className="truncate text-sm text-slate-700">{e.question}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                      <span>{p.name}</span><span>{src.label}</span>
                      {e.followUp ? <span className={e.followUp.date <= state.today ? 'font-medium text-amber-800' : ''}>Follow-up {relDay(e.followUp.date, state.today).toLowerCase()}</span> : <span>{relDay(e.created, state.today)}</span>}
                    </p>
                  </div>
                  <Icon name="arrow" className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty icon="users" title={tab === 'new' ? 'No new enquiries' : tab === 'waiting' ? 'No one is waiting for you' : tab === 'followup' ? 'No follow-ups this week' : `No ${TABS.find((x) => x.key === tab)!.label.toLowerCase()} enquiries`} text={tab === 'new' ? 'New WhatsApp conversations appear here when a campaign item brings someone in.' : undefined} />
      )}
    </div>
  );
}

function EnquiryDetail({ id }: { id: string }) {
  const { state, dispatch, toast } = useDemo();
  const e = state.enquiries.find((x) => x.id === id);
  const [saleOpen, setSaleOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [fuOpen, setFuOpen] = useState(false);
  if (!e) return <Empty title="Enquiry not found" action={<a href="#/customers" className="btn btn-secondary">Back to customers</a>} />;
  const c = state.customers.find((x) => x.id === e.customerId)!;
  const p = productById(e.productId);
  const src = sourceText(e.source);
  const sale = e.saleId ? state.sales.find((s) => s.id === e.saleId) : undefined;
  const closed = e.stage === 'won' || e.stage === 'lost';

  return (
    <div>
      <a href="#/customers" className="mb-4 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-700 hover:underline"><Icon name="back" className="h-4 w-4" /> All enquiries</a>
      <PageTitle eyebrow="Sample customer" title={c.name} hint={<span className="flex flex-wrap items-center gap-2"><Pill tone={src.tone}>{src.label}</Pill>{e.stage === 'won' ? <Pill tone="olive">Won</Pill> : e.stage === 'lost' ? <Pill tone="rose">Lost</Pill> : null}{e.followUp ? <Pill tone="amber">Follow-up {relDay(e.followUp.date, state.today).toLowerCase()}</Pill> : null}</span>} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-xl border border-slate-200" aria-label="Conversation example">
            <div className="flex items-center gap-2 bg-[#075e54] px-4 py-2.5 text-sm text-white"><Icon name="whatsapp" className="h-5 w-5" /> WhatsApp conversation (sample)</div>
            <ol className="space-y-2 bg-[#efeae2] p-3 sm:p-4">
              {e.messages.map((m, i) => (
                <li key={i} className={`flex ${m.from === 'shop' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[14px] shadow-sm ${m.from === 'shop' ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    <p className="mt-0.5 text-right text-[11px] text-slate-500">{fmtShort(m.date)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {!closed || e.suggestedReply ? <ReplyBox key={`${e.id}-${e.messages.length}`} e={e} /> : null}

          {e.script.length && e.stage === 'replied' ? (
            <button type="button" className="btn btn-secondary" onClick={() => { dispatch({ type: 'enquiry/customerReplies', id: e.id }); toast(`${c.name} replied (simulated).`, 'info'); }}>
              <Icon name="comment" className="h-4 w-4" /> Simulate the customer&apos;s answer
            </button>
          ) : null}
        </div>

        <aside className="space-y-5">
          <section className="card">
            <SectionTitle title="Product" />
            <div className="flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- fixed local lookbook file */}
              <img src={p.image} alt={p.name} className="h-24 w-18 rounded object-cover object-top" />
              <div><p className="font-medium">{p.name}</p><p className="text-sm text-slate-600">{money(p.price)} sample price</p><p className="mt-1 text-sm text-slate-600">{p.note}</p></div>
            </div>
          </section>

          <section className="card">
            <SectionTitle title="Their question" />
            <p className="text-slate-800">{e.question}</p>
            <p className="mt-3 text-sm text-slate-600"><strong>How they found you:</strong> {e.source.detail ?? src.label}</p>
          </section>

          <section className="card space-y-3">
            <SectionTitle title="Next step" />
            {sale ? (
              <Note tone="ok">Sale recorded: {money(sale.amount)} on {fmtShort(sale.date)} ({sale.source.kind === 'tracked' ? 'tracked' : sale.source.kind === 'reported' ? 'customer-reported source' : 'source unknown'}). It is counted once in Results.</Note>
            ) : e.stage === 'lost' ? (
              <Note>Marked as lost: {e.lostReason}</Note>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!sale && e.stage !== 'lost' ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setSaleOpen(true)}>Record a sale</button> : null}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFuOpen(true)}><Icon name="calendar" className="h-4 w-4" /> {e.followUp ? 'Change follow-up' : 'Schedule a follow-up'}</button>
              {!closed ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLostOpen(true)}>Mark as lost</button> : null}
            </div>
            {e.followUp ? (
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p><strong>{e.followUp.kind === 'promo' ? 'Promotional' : 'Service'} follow-up</strong> {relDay(e.followUp.date, state.today).toLowerCase()}: {e.followUp.note}</p>
                <button type="button" className="mt-1 text-sm text-slate-600 underline" onClick={() => { dispatch({ type: 'enquiry/followUp', id: e.id, followUp: null }); toast('Follow-up removed.', 'info'); }}>Remove follow-up</button>
              </div>
            ) : null}
          </section>

          <section className="card">
            <SectionTitle title="Marketing messages" />
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-olive-600" checked={c.marketingOk} onChange={(ev) => { dispatch({ type: 'customer/optOut', id: c.id, optedOut: !ev.target.checked }); toast(ev.target.checked ? `${c.name} can receive promotions again.` : `${c.name} opted out. Promotional follow-ups are blocked.`, 'info'); }} />
              <span><span className="font-medium">Agreed to promotional messages</span><span className="block text-sm text-slate-600">Only tick this if the customer said yes.</span></span>
            </label>
            {!c.marketingOk ? <Note tone="warn" className="mt-2">No promotions. You can answer their questions and send order updates, but promotional follow-ups and campaign messages are blocked for {c.name}.</Note> : null}
          </section>
        </aside>
      </div>

      <SaleDialog open={saleOpen} onClose={() => setSaleOpen(false)} e={e} />
      <FollowUpDialog open={fuOpen} onClose={() => setFuOpen(false)} e={e} />
      <Dialog open={lostOpen} onClose={() => setLostOpen(false)} title="Mark as lost">
        <p className="mb-3 text-sm text-slate-600">Why did it not work out? This helps the review in Results.</p>
        <div className="space-y-2">
          {['Price was too high', 'Size or colour not available', 'Stopped replying', 'Bought elsewhere'].map((r) => (
            <button key={r} type="button" className="btn btn-secondary w-full !justify-start !normal-case !tracking-normal" onClick={() => { dispatch({ type: 'enquiry/lost', id: e.id, reason: `${r}.` }); setLostOpen(false); toast('Marked as lost.', 'info'); }}>{r}</button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

function ReplyBox({ e }: { e: Enquiry }) {
  const { state, dispatch, toast } = useDemo();
  const [text, setText] = useState(e.suggestedReply);
  const [follow, setFollow] = useState(e.stage !== 'won' && e.stage !== 'lost');
  const gaps = text.match(/\[[^\]]+\]/g) ?? [];
  const send = () => {
    dispatch({ type: 'enquiry/reply', id: e.id, text: text.trim(), followUp: follow ? { date: addDays(state.today, 2), kind: 'service', note: 'Check if they have any other questions.' } : undefined });
    toast('Reply recorded in the demo. Nothing was sent on WhatsApp.');
  };
  return (
    <section className="card" aria-labelledby="reply-title">
      <div className="mb-2 flex flex-wrap items-center gap-2"><h2 id="reply-title" className="font-serif text-xl">Your reply</h2>{e.suggestedReply ? <Simulated /> : null}</div>
      {e.suggestedReply ? <p className="mb-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Suggested</span><RichText text={e.suggestedReply} /></p> : null}
      <label htmlFor="reply" className="label">Edit before sending</label>
      <textarea id="reply" rows={5} className="input" value={text} onChange={(ev) => setText(ev.target.value)} placeholder="Type your reply" />
      {gaps.length ? <Note tone="warn" className="mt-2">Fill in {gaps.join(', ')} before sending. Your {gaps.some((g) => /deliver/i.test(g)) ? 'delivery' : 'payment'} details are unknown, so your marketing manager left a gap instead of guessing.</Note> : null}
      <label className="mt-3 flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-brand-olive-600" checked={follow} onChange={(ev) => setFollow(ev.target.checked)} /> Remind me to follow up in 2 days
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={!text.trim() || gaps.length > 0} onClick={send}><Icon name="send" className="h-4 w-4" /> Send reply (demo)</button>
        {text !== e.suggestedReply && e.suggestedReply ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText(e.suggestedReply)}>Use the suggestion again</button> : null}
      </div>
      <p className="mt-2 text-xs text-slate-500">In the demo the reply is only added to this sample conversation. Nothing is sent on WhatsApp.</p>
    </section>
  );
}

function SaleDialog({ open, onClose, e }: { open: boolean; onClose: () => void; e: Enquiry }) {
  const { dispatch, toast } = useDemo();
  const p = productById(e.productId);
  const [amount, setAmount] = useState(p.price);
  const tracked = e.source.kind === 'tracked';
  const [kind, setKind] = useState<'reported' | 'unknown'>(e.source.kind === 'reported' ? 'reported' : 'unknown');
  const [channel, setChannel] = useState<ChannelId>(e.source.channel ?? 'instagram');
  const save = () => {
    const source: Source = tracked ? e.source : kind === 'reported' ? { kind: 'reported', channel } : { kind: 'unknown' };
    dispatch({ type: 'enquiry/sale', id: e.id, amount, source });
    onClose();
    toast(`Demo sale of ${money(amount)} recorded. Results are updated.`);
  };
  return (
    <Dialog open={open} onClose={onClose} title="Record a sale"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={!(amount > 0)} onClick={save}>Record sale</button></>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{p.name}. Record it once the customer has confirmed the order. In this prototype it only updates the sample results.</p>
        <div>
          <label htmlFor="sale-amt" className="label">Amount (US dollars)</label>
          <input id="sale-amt" type="number" min={1} step={1} className="input max-w-40" value={amount} onChange={(ev) => setAmount(Math.max(0, Number(ev.target.value) || 0))} />
        </div>
        <fieldset>
          <legend className="label">How did they find you?</legend>
          {tracked ? (
            <Note tone="ok">Tracked: they came through the link on {channelById(e.source.channel!).name}. This is the most reliable kind of source.</Note>
          ) : (
            <div className="space-y-2">
              <label className="flex min-h-10 items-center gap-2"><input type="radio" name="src" className="h-4 w-4 accent-brand-olive-600" checked={kind === 'reported'} onChange={() => setKind('reported')} /> The customer told me</label>
              {kind === 'reported' ? (
                <select aria-label="Where they said they found you" className="select ml-6 max-w-64" value={channel} onChange={(ev) => setChannel(ev.target.value as ChannelId)}>
                  {REPORTED_CHOICES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              ) : null}
              <label className="flex min-h-10 items-center gap-2"><input type="radio" name="src" className="h-4 w-4 accent-brand-olive-600" checked={kind === 'unknown'} onChange={() => setKind('unknown')} /> I don&apos;t know</label>
              <p className="text-xs text-slate-500">&ldquo;Customer told me&rdquo; is useful but less certain than a tracked link. Unknown sales are counted, but not credited to any campaign.</p>
            </div>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}

function FollowUpDialog({ open, onClose, e }: { open: boolean; onClose: () => void; e: Enquiry }) {
  const { state, dispatch, toast } = useDemo();
  const c = state.customers.find((x) => x.id === e.customerId)!;
  const [days, setDays] = useState(2);
  const [kind, setKind] = useState<'promo' | 'service'>(c.marketingOk ? 'promo' : 'service');
  const [note, setNote] = useState(e.followUp?.note ?? 'Check if they are ready to order.');
  const effectiveKind = c.marketingOk ? kind : 'service';
  return (
    <Dialog open={open} onClose={onClose} title="Schedule a follow-up"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => { dispatch({ type: 'enquiry/followUp', id: e.id, followUp: { date: addDays(state.today, days), kind: effectiveKind, note } }); onClose(); toast(`Follow-up set for ${relDay(addDays(state.today, days), state.today).toLowerCase()}.`); }}>Save follow-up</button></>}>
      <div className="space-y-4">
        <div>
          <p className="label">When</p>
          <div className="flex flex-wrap gap-2">{[1, 2, 3, 7].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-secondary'}`}>{d === 1 ? 'Tomorrow' : `In ${d} days`}</button>)}</div>
        </div>
        <fieldset>
          <legend className="label">Kind of message</legend>
          <label className="flex min-h-10 items-center gap-2"><input type="radio" name="fu" className="h-4 w-4 accent-brand-olive-600" checked={effectiveKind === 'service'} onChange={() => setKind('service')} /> Service: answer questions or update on an order</label>
          <label className={`flex min-h-10 items-center gap-2 ${c.marketingOk ? '' : 'text-slate-400'}`}><input type="radio" name="fu" className="h-4 w-4 accent-brand-olive-600" disabled={!c.marketingOk} checked={effectiveKind === 'promo'} onChange={() => setKind('promo')} /> Promotional: new pieces or offers</label>
          {!c.marketingOk ? <Note tone="warn" className="mt-1">{c.name} has not agreed to promotional messages, so a promotional follow-up is blocked.</Note> : null}
        </fieldset>
        <div>
          <label htmlFor="fu-note" className="label">Note to yourself</label>
          <input id="fu-note" className="input" value={note} onChange={(ev) => setNote(ev.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}
