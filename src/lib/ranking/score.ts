// ZP-506: the popularity score of a published piece. Pure; safe anywhere.
//
// Computed nightly (src/lib/ranking/job.ts) from the daily rollups
// (AnalyticsDailyPiece) of the last RANKING_WINDOW_DAYS analytics days, with
// exponential decay. Every weight and threshold is a named constant here and
// documented in docs/storefront/ranking.md. Tested in tests/ranking.test.ts.
//
// Score = 100 x (0.40 Attention + 0.35 Curiosity + 0.25 Intent), where each
// part is an INDEX against the catalogue: 1 = as good as the average look, so
// a score of 100 is an average look, 120 is 20% better.
//
// Fair to position: only rates and mean dwell are used (never raw views), so
// the first look of the feed (which always gets the most views) has no
// advantage. The rollups do not keep the feed position of a view, so dwell
// is not normalised by position.
//
// No early stars: each signal's index is shrunk toward 1 (the catalogue mean)
// with the Bayesian / credibility weight n / (n + RANKING_MIN_VIEWS), where n
// is the signal's (decayed) denominator. With equal uncapped data this is
// exactly the smoothed rate (x + m·p) / (n + m) divided by the mean p. One
// extreme signal is capped at SIGNAL_INDEX_CAP before smoothing.
//
// Hard to game (ZP-506 review): every signal counts DISTINCT VISITS per piece
// per day (the rollup's *Visits columns), only for visits that saw the look,
// and dwell is capped at 60 s per visit and day; so one visit repeating events
// counts once. Hearts come from the deduplicated ProductLove rows (one per
// device), not from love_on events. "Views" below means visits that saw it.

/** Days of rollups used: the 28 analytics days ending yesterday (Harare). */
export const RANKING_WINDOW_DAYS = 28
/** A day's numbers count half as much after this many days. */
export const RANKING_HALF_LIFE_DAYS = 14
/** Views until a piece's own numbers outweigh the catalogue mean (smoothing strength); also ends the cold start. */
export const RANKING_MIN_VIEWS = 50
/** Below this many look views in the window (all pieces together) the feed stays newest first. */
export const RANKING_MIN_TOTAL_VIEWS = 200

/** The three parts of the score. */
export const SCORE_WEIGHTS = Object.freeze({ attention: 0.4, curiosity: 0.35, intent: 0.25 })
/** Curiosity: share of viewers who swiped to a 2nd photo, Show details per view, product opens per view. */
export const CURIOSITY_WEIGHTS = Object.freeze({ photoSwipe: 1 / 3, details: 1 / 3, open: 1 / 3 })
/** Intent: per view WhatsApp enquiries, restock requests, shares, net loves; plus smoothed review stars (small). */
export const INTENT_WEIGHTS = Object.freeze({ enquiries: 0.35, restocks: 0.15, shares: 0.15, loves: 0.2, stars: 0.15 })
/** No single signal can count for more than 3x the average look. */
export const SIGNAL_INDEX_CAP = 3
/** Review stars are smoothed toward the catalogue's mean stars as if every piece had this many extra average reviews. */
export const STARS_PRIOR_REVIEWS = 5

/** New pieces: a boost for their first 7 days (fading), until they have RANKING_MIN_VIEWS views. */
export const COLD_START_DAYS = 7
/** Score points added on the day a piece is published, fading linearly to 0 after COLD_START_DAYS. */
export const COLD_START_BOOST = 40
/** Every 5th feed slot is an exploration slot (a lower-ranked piece, picked per day). */
export const EXPLORATION_EVERY = 5
/** How many pieces are Featured automatically (top by score). */
export const AUTO_FEATURED_COUNT = 6

const DAY_MS = 86_400_000

/** Weight of a day `ageDays` before the last day of the window (0 = yesterday). */
export function decayWeight(ageDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / RANKING_HALF_LIFE_DAYS)
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** The window for a nightly run on analytics day `today`: the 28 days ending yesterday. */
export function rankingWindow(today: string): { first: string; last: string } {
  const last = addDays(today, -1)
  return { first: addDays(last, -(RANKING_WINDOW_DAYS - 1)), last }
}

/** One AnalyticsDailyPiece row (the columns the score reads). `day` is "YYYY-MM-DD". */
export type PieceDayRow = {
  productId: number
  day: string
  /** Distinct visits with a look_view of the piece that day (the denominator). */
  viewers: number
  /** Of those visits: with a look_dwell, and their dwell seconds (capped at 60 s per visit). */
  dwellVisits: number
  dwellVisitSeconds: number
  /** Of those visits: swiped to a 2nd photo, Show details, opened, WhatsApp, restock request, shared. */
  swipeVisits: number
  detailsVisits: number
  openVisits: number
  enquiryVisits: number
  restockVisits: number
  shareVisits: number
}

/** Hearts of a piece made on an analytics day and still there (ProductLove rows: one per device, un-loves deleted). */
export type LoveDay = { productId: number; day: string; loves: number }

/** Approved reviews of a piece (any date). */
export type ReviewStat = { productId: number; count: number; starsSum: number }

export const SIGNALS = ['dwell', 'photoSwipe', 'details', 'open', 'enquiries', 'restocks', 'shares', 'loves', 'stars'] as const
export type SignalName = (typeof SIGNALS)[number]

/** One signal of a piece: its own (unsmoothed, decayed) value, and its smoothed index (1 = average). */
export type Signal = { raw: number | null; index: number }

/** Why a piece scores what it does (stored as JSON beside the score; shown in Insights). */
export type ScoreParts = {
  attention: number
  curiosity: number
  intent: number
  /** n / (n + RANKING_MIN_VIEWS) of the decayed views: 0 = only the catalogue mean, near 1 = its own numbers. */
  evidence: number
  signals: Record<SignalName, Signal>
}

export type PieceScore = { productId: number; score: number; views: number; parts: ScoreParts }

export type ScoreInput = {
  /** The pieces to score (published, public). Rows of other pieces are ignored. */
  productIds: readonly number[]
  rows: readonly PieceDayRow[]
  loves?: readonly LoveDay[]
  reviews?: readonly ReviewStat[]
  /** The analytics day of the run ("YYYY-MM-DD"); the window ends the day before. */
  today: string
}

export type ScoreResult = {
  /** Visits that saw a candidate in the window (daily distinct visits, summed; not decayed). */
  totalViews: number
  /** totalViews >= RANKING_MIN_TOTAL_VIEWS: otherwise the feed stays newest first. */
  enough: boolean
  pieces: PieceScore[]
}

const SUM_FIELDS = [
  'viewers',
  'dwellVisits',
  'dwellVisitSeconds',
  'swipeVisits',
  'detailsVisits',
  'openVisits',
  'enquiryVisits',
  'restockVisits',
  'shareVisits',
] as const
type Sums = Record<(typeof SUM_FIELDS)[number] | 'loves', number>

const emptySums = (): Sums => ({ ...(Object.fromEntries(SUM_FIELDS.map((f) => [f, 0])) as Record<(typeof SUM_FIELDS)[number], number>), loves: 0 })

/** Numerator / denominator of each signal (all per visit that saw the look). */
const RATE_SIGNALS: Record<Exclude<SignalName, 'stars'>, (s: Sums) => [number, number]> = {
  dwell: (s) => [s.dwellVisitSeconds, s.dwellVisits],
  photoSwipe: (s) => [s.swipeVisits, s.viewers],
  details: (s) => [s.detailsVisits, s.viewers],
  open: (s) => [s.openVisits, s.viewers],
  enquiries: (s) => [s.enquiryVisits, s.viewers],
  restocks: (s) => [s.restockVisits, s.viewers],
  shares: (s) => [s.shareVisits, s.viewers],
  loves: (s) => [s.loves, s.viewers],
}

/**
 * Smoothed index of a value against the catalogue mean: the raw index
 * (value / mean, capped) shrunk toward 1 with weight n / (n + prior).
 */
function smoothedIndex(value: number | null, mean: number, n: number, prior: number): number {
  if (value === null || !(mean > 0) || n <= 0) return 1
  const raw = Math.min(SIGNAL_INDEX_CAP, value / mean)
  const evidence = n / (n + prior)
  return 1 + evidence * (raw - 1)
}

export function computeScores(input: ScoreInput): ScoreResult {
  const { first, last } = rankingWindow(input.today)
  const candidates = new Set(input.productIds)
  const sums = new Map<number, Sums>(input.productIds.map((id) => [id, emptySums()]))
  const rawViews = new Map<number, number>(input.productIds.map((id) => [id, 0]))

  // Floating-point sums depend on the order of the additions: always add in
  // (productId, day) order, so a rerun gives bit-identical scores whatever
  // order the database returned the rows in.
  const byPieceDay = <T extends { productId: number; day: string }>(list: readonly T[]) =>
    [...list].sort((a, b) => a.productId - b.productId || (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  const sortedIds = [...input.productIds].sort((a, b) => a - b)
  for (const r of byPieceDay(input.rows)) {
    if (!candidates.has(r.productId) || r.day < first || r.day > last) continue
    const w = decayWeight(daysBetween(r.day, last))
    const s = sums.get(r.productId) as Sums
    for (const f of SUM_FIELDS) s[f] += w * r[f]
    rawViews.set(r.productId, (rawViews.get(r.productId) ?? 0) + r.viewers)
  }
  for (const l of byPieceDay(input.loves ?? [])) {
    if (!candidates.has(l.productId) || l.day < first || l.day > last) continue
    ;(sums.get(l.productId) as Sums).loves += decayWeight(daysBetween(l.day, last)) * Math.max(0, l.loves)
  }

  // Catalogue means (pooled over every candidate).
  const means = {} as Record<Exclude<SignalName, 'stars'>, number>
  for (const name of Object.keys(RATE_SIGNALS) as (keyof typeof RATE_SIGNALS)[]) {
    let num = 0
    let den = 0
    for (const id of sortedIds) {
      const [x, n] = RATE_SIGNALS[name](sums.get(id) as Sums)
      num += x
      den += n
    }
    means[name] = den > 0 ? num / den : 0
  }
  const reviews = new Map<number, ReviewStat>()
  let starsSum = 0
  let starsCount = 0
  for (const r of [...(input.reviews ?? [])].sort((a, b) => a.productId - b.productId)) {
    if (!candidates.has(r.productId) || r.count <= 0) continue
    reviews.set(r.productId, r)
    starsSum += r.starsSum
    starsCount += r.count
  }
  const meanStars = starsCount > 0 ? starsSum / starsCount : 0

  const pieces: PieceScore[] = input.productIds.map((productId) => {
    const s = sums.get(productId) as Sums
    const signals = {} as Record<SignalName, Signal>
    for (const name of Object.keys(RATE_SIGNALS) as (keyof typeof RATE_SIGNALS)[]) {
      const [x, n] = RATE_SIGNALS[name](s)
      const raw = n > 0 ? x / n : null
      signals[name] = { raw, index: smoothedIndex(raw, means[name], n, RANKING_MIN_VIEWS) }
    }
    const rev = reviews.get(productId)
    const stars = rev ? rev.starsSum / rev.count : null
    signals.stars = { raw: stars, index: smoothedIndex(stars, meanStars, rev?.count ?? 0, STARS_PRIOR_REVIEWS) }

    const attention = signals.dwell.index
    const curiosity =
      CURIOSITY_WEIGHTS.photoSwipe * signals.photoSwipe.index +
      CURIOSITY_WEIGHTS.details * signals.details.index +
      CURIOSITY_WEIGHTS.open * signals.open.index
    const intent =
      INTENT_WEIGHTS.enquiries * signals.enquiries.index +
      INTENT_WEIGHTS.restocks * signals.restocks.index +
      INTENT_WEIGHTS.shares * signals.shares.index +
      INTENT_WEIGHTS.loves * signals.loves.index +
      INTENT_WEIGHTS.stars * signals.stars.index
    const score = 100 * (SCORE_WEIGHTS.attention * attention + SCORE_WEIGHTS.curiosity * curiosity + SCORE_WEIGHTS.intent * intent)
    return {
      productId,
      score,
      views: rawViews.get(productId) ?? 0,
      parts: { attention, curiosity, intent, evidence: s.viewers / (s.viewers + RANKING_MIN_VIEWS), signals },
    }
  })

  const totalViews = [...rawViews.values()].reduce((a, b) => a + b, 0)
  return { totalViews, enough: totalViews >= RANKING_MIN_TOTAL_VIEWS, pieces }
}
