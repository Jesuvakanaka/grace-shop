// ZP-506: the storefront feed order from the nightly ranking. Pure; safe on
// the client and the server. Tested in tests/ranking.test.ts.
//
// The nightly step stores each public piece's rank for the day
// (ProductPopularity.rank). The feed reads them through one cached entry
// (src/lib/storefront/cached.ts, `getFeedRanking`) and orders with this.

/** "AUTO" = Rank automatically (default), "NEWEST" = Newest first (the owner's emergency switch). */
export type FeedRankingMode = 'AUTO' | 'NEWEST'
export const FEED_RANKING_MODES: readonly FeedRankingMode[] = ['AUTO', 'NEWEST']

/**
 * What the feed needs: the mode and today's rank (1 = first) per piece, keyed
 * by the public ref ("V-0099", derived from the product id), not the slug, so
 * a piece renamed since the cached answer keeps its place.
 */
export type FeedRanking = { mode: FeedRankingMode; ranks: Record<string, number> }

/**
 * Feed order. `newestFirst` must be newest published first.
 * - NEWEST, or no ranks yet (too little data): newest first, sold-out last.
 *   Featured gives no precedence (owner decision 2026-11-01).
 * - AUTO: available pieces by rank, with pieces published since the nightly
 *   run (no rank yet) first (they are new: cold start); then sold-out
 *   pieces by rank. Availability is today's, so a piece that sold out since
 *   the run moves to the end at once.
 */
export function orderFeedByRanking<T extends { ref?: string; availability: string }>(
  newestFirst: readonly T[],
  ranking: FeedRanking,
): T[] {
  const available = newestFirst.filter((p) => p.availability !== 'SOLD_OUT')
  const soldOut = newestFirst.filter((p) => p.availability === 'SOLD_OUT')
  const ranks = ranking.ranks
  const has = (p: T) => typeof p.ref === 'string' && Object.prototype.hasOwnProperty.call(ranks, p.ref)
  if (ranking.mode === 'NEWEST' || Object.keys(ranks).length === 0) return [...available, ...soldOut]
  const byRank = (list: T[]) => list.filter(has).sort((a, b) => ranks[a.ref as string] - ranks[b.ref as string])
  const unranked = (list: T[]) => list.filter((p) => !has(p))
  return [...unranked(available), ...byRank(available), ...byRank(soldOut), ...unranked(soldOut)]
}
