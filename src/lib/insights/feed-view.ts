// ZP-546: Insights "Clean vs Info view", the comparison of the feed-view A/B
// test (ZP-543 / ZP-544). Pure; safe anywhere.
//
// Input: AnalyticsDailyFeedView rows (test visits only) summed over the range.
// The main measure is the share of visits that tapped WhatsApp. A winner is
// named ONLY when each view has at least FEED_VIEW_MIN_VISITS visits AND a
// two-proportion z-test gives |z| >= FEED_VIEW_Z (about 95% confidence,
// two-sided). Otherwise the page says "Not enough visitors yet to call a
// winner". See docs/storefront/analytics.md.
import { FEED_VIEWS, type FeedView } from '@/lib/analytics/events'
import type { FeedViewColumn, FeedViewComparison, FeedViewVerdict } from './types'

/** Visits each view needs before a winner can be named. */
export const FEED_VIEW_MIN_VISITS = 200
/** |z| needed (two-sided, about 95%). */
export const FEED_VIEW_Z = 1.96

/**
 * Two-proportion z statistic with the pooled standard error:
 * z = (p1 - p2) / sqrt(p (1 - p) (1/n1 + 1/n2)), p = (x1 + x2) / (n1 + n2).
 * Positive when group 1's rate is higher. null when it is undefined: a group
 * with no visits, counts outside 0..n, or a pooled rate of 0 or 1 (nobody,
 * or everybody, tapped: no variance, so no evidence either way).
 */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): number | null {
  const valid = (x: number, n: number) => Number.isFinite(x) && Number.isFinite(n) && n > 0 && x >= 0 && x <= n
  if (!valid(x1, n1) || !valid(x2, n2)) return null
  const p = (x1 + x2) / (n1 + n2)
  if (p <= 0 || p >= 1) return null
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
  return (x1 / n1 - x2 / n2) / se
}

type Counts = { visits: number; whatsappVisits: number }

/** The honest rule: a winner only with FEED_VIEW_MIN_VISITS visits per view and |z| >= FEED_VIEW_Z. */
export function feedViewVerdict(clean: Counts, info: Counts): FeedViewVerdict {
  const z = twoProportionZ(info.whatsappVisits, info.visits, clean.whatsappVisits, clean.visits)
  if (clean.visits < FEED_VIEW_MIN_VISITS || info.visits < FEED_VIEW_MIN_VISITS || z === null || Math.abs(z) < FEED_VIEW_Z) {
    return { kind: 'not-enough' }
  }
  return {
    kind: 'ahead',
    winner: z > 0 ? 'info' : 'clean',
    infoRate: info.whatsappVisits / info.visits,
    cleanRate: clean.whatsappVisits / clean.visits,
  }
}

export type FeedViewRow = { view: string; visits: number; devices: number; openVisits: number; enquiringVisits: number; restockVisits: number }

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

/**
 * The section's data: one column per view (clean first), summed over the
 * rows (days); rows of an unknown view are ignored. null when the range has
 * no test visits (the page hides the section).
 */
export function compareFeedViews(rows: readonly FeedViewRow[]): FeedViewComparison | null {
  const sums = new Map<FeedView, Omit<FeedViewRow, 'view'>>(
    FEED_VIEWS.map((v) => [v, { visits: 0, devices: 0, openVisits: 0, enquiringVisits: 0, restockVisits: 0 }]),
  )
  for (const r of rows) {
    const s = sums.get(r.view as FeedView)
    if (!s) continue
    s.visits += r.visits
    s.devices += r.devices
    s.openVisits += r.openVisits
    s.enquiringVisits += r.enquiringVisits
    s.restockVisits += r.restockVisits
  }
  const columns = FEED_VIEWS.map((view): FeedViewColumn => {
    const s = sums.get(view) as Omit<FeedViewRow, 'view'>
    return {
      view,
      visits: s.visits,
      devices: s.devices,
      openVisits: s.openVisits,
      openRate: ratio(s.openVisits, s.visits),
      whatsappVisits: s.enquiringVisits,
      whatsappRate: ratio(s.enquiringVisits, s.visits),
      restockVisits: s.restockVisits,
    }
  }) as [FeedViewColumn, FeedViewColumn]
  if (columns.every((c) => c.visits === 0)) return null
  const [clean, info] = columns
  return {
    columns,
    z: twoProportionZ(info.whatsappVisits, info.visits, clean.whatsappVisits, clean.visits),
    verdict: feedViewVerdict(clean, info),
    minVisits: FEED_VIEW_MIN_VISITS,
  }
}

/** The sentence the page (and the CSV) shows for a verdict. */
export function verdictText(verdict: FeedViewVerdict): string {
  if (verdict.kind === 'not-enough') return 'Not enough visitors yet to call a winner'
  return verdict.winner === 'info' ? 'Info view is ahead' : 'Clean view is ahead'
}
