// ZP-506: the day's feed order and the automatic Featured set, from the
// scores (./score.ts). Pure; tested in tests/ranking.test.ts.
//
// - Available pieces by effective score (score + cold-start boost), best first.
// - Every EXPLORATION_EVERY-th slot (5th, 10th, ...) takes a lower-ranked
//   piece picked with a random generator seeded by the analytics day: the
//   order never freezes, yet it is the same all day (stable and cacheable),
//   and running the nightly step again gives the same result.
// - Sold-out pieces last, by score.
// - Not enough data (see RANKING_MIN_TOTAL_VIEWS): newest first, no ranks.
// - Featured = the top AUTO_FEATURED_COUNT available pieces with a photo by
//   score (no cold-start boost, no exploration); newest when not enough data.
import { AUTO_FEATURED_COUNT, COLD_START_BOOST, COLD_START_DAYS, EXPLORATION_EVERY, RANKING_MIN_VIEWS } from './score'

const DAY_MS = 86_400_000

export type RankCandidate = {
  productId: number
  score: number
  /** Raw look views in the window. */
  views: number
  publishedAt: Date | null
  soldOut: boolean
  hasPhoto: boolean
  /** 0 = the most recently published piece. */
  newestIndex: number
}

/**
 * Start of an analytics day ("YYYY-MM-DD") as an instant: midnight in
 * Africa/Harare, which is UTC+2 all year (no daylight saving).
 */
export function analyticsDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+02:00`)
}

/**
 * Score points a new piece gets: COLD_START_BOOST on its first day, fading to
 * 0 after COLD_START_DAYS, and 0 from RANKING_MIN_VIEWS views. The age is
 * measured at `at`: rankForDay passes the start of the analytics day, so the
 * night run, a rerun and the owner's switch give the same order all day.
 */
export function coldStartBoost(c: Pick<RankCandidate, 'publishedAt' | 'views'>, at: Date): number {
  if (!c.publishedAt || c.views >= RANKING_MIN_VIEWS) return 0
  const age = Math.max(0, (at.getTime() - c.publishedAt.getTime()) / DAY_MS)
  if (age >= COLD_START_DAYS) return 0
  return COLD_START_BOOST * (1 - age / COLD_START_DAYS)
}

/** Slot i (0-based) is an exploration slot: the 5th, 10th, 15th, ... */
export function explorationSlot(i: number): boolean {
  return (i + 1) % EXPLORATION_EVERY === 0
}

/** A deterministic random generator in [0, 1) for a seed (FNV-1a hash + mulberry32). */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type DayRanking = {
  /** Product ids in feed order (available first, sold-out last). */
  order: number[]
  /** false = not enough data: `order` is newest first and no ranks are stored. */
  ranked: boolean
  /** Pieces that got a cold-start boost. */
  coldStart: Set<number>
  /** Featured automatically, best first. */
  featured: number[]
  /** Score + cold-start boost, per piece. */
  effective: Map<number, number>
}

export function rankForDay(candidates: readonly RankCandidate[], options: { day: string; enough: boolean }): DayRanking {
  const byNewest = (a: RankCandidate, b: RankCandidate) => a.newestIndex - b.newestIndex || a.productId - b.productId
  const effective = new Map<number, number>()
  const coldStart = new Set<number>()
  const dayStart = analyticsDayStart(options.day)
  for (const c of candidates) {
    const boost = coldStartBoost(c, dayStart)
    if (boost > 0) coldStart.add(c.productId)
    effective.set(c.productId, c.score + boost)
  }
  const eligible = candidates.filter((c) => !c.soldOut && c.hasPhoto)

  if (!options.enough) {
    const newest = [...candidates].sort(byNewest)
    return {
      order: [...newest.filter((c) => !c.soldOut), ...newest.filter((c) => c.soldOut)].map((c) => c.productId),
      ranked: false,
      coldStart: new Set(),
      featured: [...eligible].sort(byNewest).slice(0, AUTO_FEATURED_COUNT).map((c) => c.productId),
      effective,
    }
  }

  const byEffective = (a: RankCandidate, b: RankCandidate) =>
    (effective.get(b.productId) as number) - (effective.get(a.productId) as number) || byNewest(a, b)
  const remaining = candidates.filter((c) => !c.soldOut).sort(byEffective)
  const random = seededRandom(`vyra-feed:${options.day}`)
  const order: number[] = []
  for (let i = 0; remaining.length > 0; i++) {
    const pick = explorationSlot(i) && remaining.length > 1 ? 1 + Math.floor(random() * (remaining.length - 1)) : 0
    order.push(remaining.splice(pick, 1)[0].productId)
  }
  for (const c of candidates.filter((x) => x.soldOut).sort(byEffective)) order.push(c.productId)

  const featured = [...eligible]
    .sort((a, b) => b.score - a.score || byNewest(a, b))
    .slice(0, AUTO_FEATURED_COUNT)
    .map((c) => c.productId)
  return { order, ranked: true, coldStart, featured, effective }
}
