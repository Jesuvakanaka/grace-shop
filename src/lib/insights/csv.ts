// ZP-505: CSV export of one Insights report. Pure.
// UTF-8 with a BOM (Excel opens it right), CRLF line ends, RFC 4180 quoting.
// Text cells that a spreadsheet would run as a formula (= + - @ tab CR) get a
// leading apostrophe. Rates are exported as fractions (0..1), seconds as means.
import type { InsightsReport } from './types'

export const INSIGHTS_REPORTS = [
  'overview',
  'looks',
  'photos',
  'videos',
  'funnel',
  'depth',
  'demand',
  'sources',
  'heatmap',
  'health',
] as const
export type InsightsReportName = (typeof INSIGHTS_REPORTS)[number]

export function isInsightsReportName(value: unknown): value is InsightsReportName {
  return typeof value === 'string' && (INSIGHTS_REPORTS as readonly string[]).includes(value)
}

type Cell = string | number | boolean | null | undefined

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 10_000) / 10_000) : ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  let s = value
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function reportCsv(report: InsightsReport, name: InsightsReportName): string {
  switch (name) {
    case 'overview': {
      const o = report.overview
      const rows: Cell[][] = [
        ['from', report.range.from],
        ['to', report.range.to],
        ['visits', o.visits],
        ['new visits', o.newVisits],
        ['returning visits', o.returningVisits],
        ['ended visits', o.endedVisits],
        ['looks seen per visit (mean)', o.looksPerVisit],
        ['time on site per visit, seconds (mean)', o.avgSeconds],
        ['bounce rate', o.bounceRate],
        ['WhatsApp taps', o.whatsappTaps],
        ['visits that tapped WhatsApp', o.enquiringVisits],
        ['restock requests', o.restockRequests],
        ...o.topSources.map((s): Cell[] => [`visits from ${s.source}`, s.visits]),
      ]
      return toCsv(['metric', 'value'], rows)
    }
    case 'looks':
      return toCsv(
        ['piece', 'slug', 'views', 'viewers', 'mean dwell s', 'photo swipe rate', 'show details per view', 'opens per view', 'WhatsApp taps', 'shares', 'restock requests', 'hearts', 'popularity', 'enough data'],
        report.looks.rows.map((r) => [r.name, r.slug, r.views, r.viewers, r.meanDwell, r.photoSwipeRate, r.detailsRate, r.openRate, r.whatsapp, r.shares, r.restockRequests, r.hearts, r.popularity, r.enough]),
      )
    case 'photos':
      return toCsv(
        ['piece', 'slug', 'photo', 'image', 'views', 'viewers', 'dwells', 'mean s', 'reach', 'cover now', 'suggested cover', 'enough data'],
        report.photos.flatMap((p) =>
          p.photos.map((ph) => [
            p.name,
            p.slug,
            ph.index,
            ph.image,
            ph.views,
            ph.viewers,
            ph.dwellCount,
            ph.meanSeconds,
            ph.reach,
            ph.isCover,
            p.bestCover?.image === ph.image && p.bestCover.index === ph.index,
            ph.enough,
          ]),
        ),
      )
    case 'videos':
      return toCsv(
        ['piece', 'slug', 'starts', 'viewers', 'reached 25%', 'reached 50%', 'reached 75%', 'reached 100%', 'mean s watched', 'replays', 'enough data'],
        report.videos.map((v) => [v.name, v.slug, v.starts, v.viewers, ...v.completion, v.avgSeconds, v.replays, v.enough]),
      )
    case 'funnel': {
      const segs = [
        { group: 'all', s: report.funnel.all },
        ...report.funnel.byDevice.map((s) => ({ group: 'device', s })),
        ...report.funnel.bySource.map((s) => ({ group: 'source', s })),
      ]
      return toCsv(
        ['group', 'segment', 'step', 'visits', 'lost from step before', 'enough data'],
        segs.flatMap(({ group, s }) => report.funnel.steps.map((step, i) => [group, s.key, step, s.counts[i], s.lost[i], s.enough])),
      )
    }
    case 'depth':
      return toCsv(
        ['look', 'visits reaching it', 'share of visits'],
        [
          ...report.depth.reach.map((r): Cell[] => [r.look, r.visits, r.share]),
          ['end of feed', report.depth.endOfFeedVisits, report.depth.endOfFeedRate],
        ],
      )
    case 'demand':
      return toCsv(
        ['kind', 'piece', 'slug', 'option', 'value', 'picks', 'enquiries', 'restock requests', 'views'],
        [
          ...report.demand.soldOut.flatMap((p): Cell[][] => [
            ['sold out', p.name, p.slug, '', '', '', '', p.restockRequests, ''],
            ...p.sizes.map((s): Cell[] => ['sold out', p.name, p.slug, 'size', s.value, '', '', s.count, '']),
          ]),
          ...report.demand.options.flatMap((p) => [
            ...p.sizes.map((s): Cell[] => ['option', p.name, p.slug, 'size', s.value, s.selects, s.enquiries, s.restockRequests, '']),
            ...p.colours.map((s): Cell[] => ['option', p.name, p.slug, 'colour', s.value, s.selects, s.enquiries, s.restockRequests, '']),
          ]),
          ...report.demand.askForPrice.map((p): Cell[] => ['ask for price', p.name, p.slug, '', '', '', p.enquiries, '', p.views]),
        ],
      )
    case 'sources':
      return toCsv(
        ['source', 'campaign', 'visits', 'visits that tapped WhatsApp', 'WhatsApp taps'],
        [
          ...report.sources.bySource.map((s): Cell[] => [s.source, '(all)', s.visits, s.enquiringVisits, s.whatsappTaps]),
          ...report.sources.byCampaign.map((c): Cell[] => [c.source, c.campaign, c.visits, c.enquiringVisits, c.whatsappTaps]),
        ],
      )
    case 'heatmap':
      return toCsv(
        ['weekday', 'hour (Harare)', 'visits', 'WhatsApp taps'],
        report.sources.heatmap.map((c) => [WEEKDAYS[c.weekday], c.hour, c.visits, c.whatsappTaps]),
      )
    case 'health':
      return toCsv(
        ['day', 'slow loads', 'load errors', 'failed actions'],
        report.health.days.map((d) => [d.day, d.slowLoads, d.loadErrors, d.failedActions]),
      )
  }
}
