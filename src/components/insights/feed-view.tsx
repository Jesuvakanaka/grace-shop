'use client';
// ZP-546: Insights "Clean vs Info view", the feed-view A/B test (ZP-543 /
// ZP-544). One column per view, test visits only. A winner is named only
// with enough visitors on both sides AND a clear difference
// (src/lib/insights/feed-view.ts); otherwise the page says so plainly.
// Rendered only when the range has test visits.
import React from 'react';
import type { FeedViewColumn, FeedViewComparison } from '@/lib/insights/types';
import { verdictText } from '@/lib/insights/feed-view';
import { fmt, ScrollTable, Section, td, tdNum, th, thNum } from './parts';

const VIEW_LABEL: Record<FeedViewColumn['view'], string> = { clean: 'Clean view', info: 'Info view' };

const countAndRate = (count: number, rate: number | null) => `${fmt.num(count)} · ${fmt.pct(rate)}`;

const ROWS: { label: string; note?: string; main?: boolean; render: (c: FeedViewColumn) => string }[] = [
  { label: 'Visitors', note: 'visits of the test', render: (c) => fmt.num(c.visits) },
  { label: 'Opened a piece', note: 'details or product page', render: (c) => countAndRate(c.openVisits, c.openRate) },
  { label: 'Tapped WhatsApp', note: 'the main measure', main: true, render: (c) => countAndRate(c.whatsappVisits, c.whatsappRate) },
  { label: 'Restock requests', note: 'visits that asked', render: (c) => fmt.num(c.restockVisits) },
];

export function FeedViewReport({ data, csv }: { data: FeedViewComparison | null | undefined; csv: string }) {
  if (!data) return null;
  const { columns, verdict, minVisits } = data;
  const ahead = verdict.kind === 'ahead';
  return (
    <Section
      id="feedviews"
      title="Clean vs Info view"
      description="The feed A/B test: each new browser is shown one of the two views at random. Only visits that were part of the test are counted; percentages are of those visits."
      csv={[csv]}
    >
      <p
        role="status"
        className={`mb-3 text-sm rounded-lg border px-3 py-2 ${
          ahead ? 'bg-brand-olive-50 border-brand-olive-200 text-brand-olive-800' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}
        data-testid="feedviews-verdict"
      >
        <strong className="font-semibold">{verdictText(verdict)}</strong>
        {verdict.kind === 'ahead' ? (
          <>
            : {fmt.pct(verdict.infoRate)} of Info view visitors tapped WhatsApp, against {fmt.pct(verdict.cleanRate)} with the Clean view.
          </>
        ) : (
          <>
            . A winner is named once each view has at least {fmt.num(minVisits)} visitors and the difference in WhatsApp taps is too large to be
            chance (95% confidence).
          </>
        )}
      </p>
      <ScrollTable caption="Clean view and Info view compared">
        <thead>
          <tr>
            <th scope="col" className={th}>
              <span className="sr-only">Measure</span>
            </th>
            {columns.map((c) => (
              <th key={c.view} scope="col" className={thNum} data-testid={`feedviews-col-${c.view}`}>
                {VIEW_LABEL[c.view]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label} className={row.main ? 'font-semibold' : ''}>
              <th scope="row" className={`${td} text-left font-medium text-slate-700`}>
                {row.label}
                {row.note && <span className="block text-xs font-normal text-slate-500">{row.note}</span>}
              </th>
              {columns.map((c) => (
                <td key={c.view} className={tdNum}>
                  {row.render(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </Section>
  );
}
