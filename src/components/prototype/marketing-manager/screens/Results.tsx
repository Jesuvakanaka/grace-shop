'use client';
// "Results": a sample report whose totals are sums of the demo records, honest
// attribution (tracked, customer-reported, unknown), a plain-English review and
// recommendations that become the next draft plan.
import React, { useState } from 'react';
import { fmtShort, money, num } from '../dates';
import { activeCampaign, economics, liveCampaigns, review, totals, type Recommendation } from '../engine';
import { useDemo } from '../store';
import { Dialog, Empty, Icon, Note, PageTitle, SectionTitle, Simulated } from '../ui';

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '');

export function ResultsScreen() {
  const { state, route, dispatch, go, toast } = useDemo();
  const active = activeCampaign(state);
  const scopes = [
    ...liveCampaigns(state).map((c) => ({ id: c.id, label: `${c.name} (${c.startDate > state.today ? `starts ${fmtShort(c.startDate)}` : 'current'})` })),
    ...state.campaigns.filter((c) => c.status === 'ended').sort((a, b) => b.endDate.localeCompare(a.endDate)).map((c) => ({ id: c.id, label: c.name })),
    { id: 'all', label: 'All sample activity' },
  ];
  const scope = scopes.find((s) => s.id === route[1])?.id ?? scopes[0].id;
  const campaign = state.campaigns.find((c) => c.id === scope);
  const t = totals(state, scope);
  const rv = review(state, t, scope);
  const [pending, setPending] = useState<Recommendation | null>(null);
  const empty = t.reach === 0 && t.visits === 0 && t.enquiries === 0 && t.sales === 0;

  const startFrom = (r: Recommendation) => {
    dispatch({ type: 'draft/start', input: r.input });
    dispatch({ type: 'draft/plan', variant: 0 });
    setPending(null);
    go('#/plan');
    toast('A draft plan was prepared from the recommendation (simulated).');
  };

  const funnel = [
    { label: 'Combined reported reach', value: t.reach, help: 'Each channel’s reported reach, added up. It may include the same people more than once, so it is not a count of different people.' },
    { label: 'Shop visits', value: t.visits, help: 'Visits to your online shop.' },
    { label: 'Enquiry clicks', value: t.clicks, help: 'Taps on "Ask on WhatsApp". A tap only opens WhatsApp; it is not a conversation yet.' },
    { label: 'Recorded conversations', value: t.enquiries, help: 'WhatsApp conversations recorded here. Any that were not recorded are missing from this number.' },
    { label: 'Recorded sales', value: t.sales, help: 'Sales you recorded after the customer confirmed.' },
  ];

  return (
    <div>
      <PageTitle eyebrow="Results" title={campaign ? campaign.name : 'All sample activity'}
        hint={campaign ? `${fmtShort(campaign.startDate)} to ${campaign.status === 'active' ? 'today' : fmtShort(campaign.endDate)}. Every number is the sum of the sample records.` : 'Everything in the demo, including sales that no campaign can take credit for.'}
        action={
          <div>
            <label htmlFor="scope" className="sr-only">Show results for</label>
            <select id="scope" className="select !w-auto min-w-56" value={scope} onChange={(e) => go(`#/results/${e.target.value}`)}>
              {scopes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        } />

      {empty ? (
        <Empty icon="chart" title="No results yet" text={campaign?.scheduled ? 'Results appear after the first item goes out. Move the demo forward a day on the Campaigns screen.' : 'Results appear once the campaign is scheduled and its first item goes out.'} action={<a href="#/campaigns" className="btn btn-secondary">Go to campaign</a>} />
      ) : (
        <div className="space-y-5">
          <section className="card" aria-label="From seeing to buying">
            <SectionTitle title="From seeing to buying" hint="How many people moved to the next step." />
            <ol className="grid gap-2 sm:grid-cols-5">
              {funnel.map((f, i) => (
                <li key={f.label} className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{f.label}</p>
                  <p className="mt-1 font-serif text-3xl leading-none">{num(f.value)}</p>
                  {i > 0 && funnel[i - 1].value ? <p className="mt-1 text-xs text-slate-500">{pct(f.value, funnel[i - 1].value)} of the step before</p> : <p className="mt-1 text-xs text-transparent">.</p>}
                  <p className="mt-2 text-xs text-slate-600">{f.help}</p>
                </li>
              ))}
            </ol>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card">
              <SectionTitle title="Money" hint="Pretend spending in this prototype." />
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-200">
                  <tr><th scope="row" className="py-2 text-left font-normal">Revenue from recorded sales</th><td className="py-2 text-right font-semibold">{money(t.revenue)}</td></tr>
                  <tr><th scope="row" className="py-2 pl-3 text-left font-normal text-slate-600">Advertising</th><td className="py-2 text-right">{money(t.costs.ads)}</td></tr>
                  <tr><th scope="row" className="py-2 pl-3 text-left font-normal text-slate-600">Messaging</th><td className="py-2 text-right">{money(t.costs.messaging)}</td></tr>
                  <tr><th scope="row" className="py-2 pl-3 text-left font-normal text-slate-600">Content creation</th><td className="py-2 text-right">{money(t.costs.content)}</td></tr>
                  <tr><th scope="row" className="py-2 text-left font-normal">Marketing costs</th><td className="py-2 text-right font-semibold">{money(t.costs.total)}</td></tr>
                </tbody>
              </table>
              <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${t.revenue < t.costs.total ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-800'}`}>{economics(state, t, scope)}</p>
              <p className="mt-2 text-xs text-slate-500">Revenue is not profit: it does not take off what the clothes cost you.</p>
            </section>

            <section className="card">
              <SectionTitle title="Where the sales came from" />
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between gap-3"><span><strong>Tracked</strong><span className="block text-slate-600">Came through a campaign link. Most reliable.</span></span><span className="shrink-0 text-right">{t.bySource.tracked.sales} · {money(t.bySource.tracked.revenue)}</span></li>
                <li className="flex justify-between gap-3"><span><strong>Customer said</strong><span className="block text-slate-600">What the customer told you. Useful but less certain.</span></span><span className="shrink-0 text-right">{t.bySource.reported.sales} · {money(t.bySource.reported.revenue)}</span></li>
                <li className="flex justify-between gap-3"><span><strong>Unknown</strong><span className="block text-slate-600">No link and no answer. Not credited to any campaign.</span></span><span className="shrink-0 text-right">{t.bySource.unknown.sales} · {money(t.bySource.unknown.revenue)}</span></li>
              </ul>
              <p className="mt-3 border-t border-slate-200 pt-3 text-sm"><strong>Repeat customers:</strong> {t.repeatCustomers ? `${t.repeatCustomers} customer${t.repeatCustomers === 1 ? '' : 's'} in this view ha${t.repeatCustomers === 1 ? 's' : 've'} bought more than once.` : 'none in this view yet.'}</p>
              {scope !== 'all' ? <p className="mt-2 text-xs text-slate-500">Sales with no known source never appear under a campaign. See &ldquo;All sample activity&rdquo; for every sale.</p> : null}
            </section>
          </div>

          <section className="card">
            <SectionTitle title="By channel" hint="The rows add up to the totals. Reach is as each channel reports it, so people seen on two channels count twice." />
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Channel</th><th className="text-right">Reported reach</th><th className="text-right">Visits</th><th className="text-right">Enquiry clicks</th><th className="text-right">Conversations</th><th className="text-right">Sales</th></tr></thead>
                <tbody>
                  {t.rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}{r.reportedOnly ? <span className="block text-xs text-slate-500">customer-reported only</span> : null}</td>
                      <td className="text-right">{num(r.reach)}</td><td className="text-right">{num(r.visits)}</td><td className="text-right">{num(r.clicks)}</td><td className="text-right">{r.enquiries}</td><td className="text-right">{r.sales}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td>Total</td><td className="text-right">{num(t.reach)}</td><td className="text-right">{num(t.visits)}</td><td className="text-right">{num(t.clicks)}</td><td className="text-right">{t.enquiries}</td><td className="text-right">{t.sales}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" aria-labelledby="review-title">
            <div className="mb-3 flex flex-wrap items-center gap-2"><h2 id="review-title" className="font-serif text-2xl">What this means</h2><Simulated>Simulated review from sample numbers</Simulated></div>
            <div className="grid gap-5 md:grid-cols-3">
              <ReviewList title="What appears to be working" items={rv.working} />
              <ReviewList title="Where customers drop off" items={rv.dropOff} />
              <ReviewList title="What is still uncertain" items={rv.uncertain} />
            </div>
          </section>

          <section aria-labelledby="next-title">
            <h2 id="next-title" className="mb-3 font-serif text-2xl">What to try next</h2>
            <ul className="grid gap-3 md:grid-cols-3">
              {rv.next.map((r) => (
                <li key={r.id} className="card flex flex-col">
                  <p className="font-medium text-slate-900">{r.title}</p>
                  <p className="mt-1 flex-1 text-sm text-slate-600">{r.why}</p>
                  <button type="button" className="btn btn-primary btn-sm mt-3 self-start" onClick={() => (state.draft?.plan ? setPending(r) : startFrom(r))}><Icon name="sparkle" className="h-4 w-4" /> Turn into next draft plan</button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {active && !empty && scope === active.id ? <Note className="mt-5">The campaign is still running. Numbers will change as more items go out.</Note> : null}

      <Dialog open={!!pending} onClose={() => setPending(null)} title="Replace your draft plan?"
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setPending(null)}>Keep my draft</button><button type="button" className="btn btn-primary" onClick={() => pending && startFrom(pending)}>Replace it</button></>}>
        <p>You already have a draft plan waiting. Starting from this recommendation replaces it.</p>
      </Dialog>
    </div>
  );
}

function ReviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      <ul className="space-y-2 text-sm text-slate-800">
        {items.length ? items.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-olive-600" />{x}</li>) : <li className="text-slate-500">Not enough data yet.</li>}
      </ul>
    </div>
  );
}
