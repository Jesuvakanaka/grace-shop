// ZP-506: the nightly ranking step. Server / job only.
//
// Runs after the analytics rollups (scripts/analytics-rollup.ts) and when the
// owner switches the feed back to "Rank automatically". It:
//  1. scores every public piece WITH A PHOTO (what the feed shows) from the
//     last 28 days of AnalyticsDailyPiece's distinct-visit columns, the
//     deduplicated hearts (ProductLove) and approved review stars (./score.ts),
//  2. orders today's feed (./order.ts: cold start, exploration seeded by the
//     analytics day, sold-out last; newest first while there is too little data),
//  3. replaces ProductPopularity with one row per public piece, and
//  4. with "Rank automatically", sets Product.featured to exactly the top
//     AUTO_FEATURED_COUNT (only rows whose flag changes are written).
// Everything is one transaction and depends only on the data and the day, so
// running it again the same day gives the same rows (idempotent). Runs are
// serialised with an advisory lock, and the SiteSettings row is locked FOR
// UPDATE for the whole run (the settings PUT takes the same row lock), so an
// owner's switch is never overwritten by a run that read the old mode.
//
// The storefront reads the ranks through a cached entry (60 s backstop,
// STOREFRONT_REVALIDATE_SECONDS); this job runs outside Next.js and cannot
// expire it, so a nightly change shows within a minute. The settings switch
// (an admin request) expires the storefront at once.
import type { Prisma, PrismaClient } from '@prisma/client'
import { analyticsDay, ANALYTICS_TIME_ZONE } from '@/lib/analytics/events'
import { getAvailability } from '@/lib/storefront-model/rules'
import { SITE_SETTINGS_ID } from '@/lib/site-settings/db'
import { rankForDay, type RankCandidate } from './order'
import { computeScores, rankingWindow, type LoveDay, type PieceDayRow, type ReviewStat } from './score'
import type { FeedRankingMode } from './feed-order'

/** Same as the storefront's visibility rule (src/lib/storefront/queries.ts PUBLIC_PRODUCT_WHERE). */
const PUBLIC_WHERE = {
  published: true,
  slug: { not: null },
  category: { is: { published: true } },
} satisfies Prisma.ProductWhereInput

export const RANKING_TRANSACTION = { timeout: 120_000, maxWait: 30_000 }
/** pg_advisory_xact_lock key: one ranking run at a time (any instance or job). */
export const RANKING_LOCK_KEY = 506_001

export type RankingRunResult = {
  day: string
  mode: FeedRankingMode
  pieces: number
  totalViews: number
  /** false: too little data, the feed stays newest first (no ranks stored). */
  ranked: boolean
  /** The automatic Featured set (product ids, best first). Applied only with mode AUTO. */
  featured: number[]
  /** Products whose Featured flag this run changed (mode AUTO only). */
  featuredChanged: { id: number; slug: string | null; featured: boolean }[]
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export async function runRanking(db: PrismaClient, options: { now?: Date } = {}): Promise<RankingRunResult> {
  const now = options.now ?? new Date()
  const day = analyticsDay(now)
  const { first, last } = rankingWindow(day)

  return db.$transaction(async (tx) => {
    // One ranking at a time (nightly job, the owner's switch, a manual run):
    // a second run waits here until the first commits.
    // ($executeRaw: Prisma cannot read the function's `void` result.)
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${RANKING_LOCK_KEY})`)
    // Lock the settings row for the whole run: the mode read here is the one
    // in force when Featured is written. The settings PUT takes the same row
    // lock, so an owner's switch waits for the run (and vice versa).
    const [settings] = (await tx.$queryRawUnsafe(
      `SELECT "feedRanking", "fewLeftThreshold" FROM "SiteSettings" WHERE id = $1 FOR UPDATE`,
      SITE_SETTINGS_ID,
    )) as { feedRanking: FeedRankingMode; fewLeftThreshold: number }[]
    const mode: FeedRankingMode = settings?.feedRanking ?? 'AUTO'

    // Only pieces the feed shows: public AND with a photo (so exploration slots hold).
    const products = await tx.product.findMany({
      where: { ...PUBLIC_WHERE, images: { some: {} } },
      select: { id: true, publishedAt: true, currentQuantity: true },
    })
    const ids = products.map((p) => p.id)
    const windowFrom = new Date(`${first}T00:00:00Z`)

    const [pieceRows, loveRows, reviewRows] = await Promise.all([
      ids.length === 0
        ? Promise.resolve([])
        : tx.analyticsDailyPiece.findMany({
            where: { productId: { in: ids }, day: { gte: windowFrom, lte: new Date(`${last}T00:00:00Z`) } },
            select: {
              productId: true,
              day: true,
              viewers: true,
              dwellVisits: true,
              dwellVisitSeconds: true,
              swipeVisits: true,
              detailsVisits: true,
              openVisits: true,
              enquiryVisits: true,
              restockVisits: true,
              shareVisits: true,
            },
          }),
      // Hearts: the deduplicated ProductLove rows (one per device; an un-love deletes it), by Harare day.
      ids.length === 0
        ? Promise.resolve([] as LoveDay[])
        : (tx.$queryRawUnsafe(
            `SELECT "productId", to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE '${ANALYTICS_TIME_ZONE}', 'YYYY-MM-DD') AS day,
                    COUNT(*)::int AS loves
             FROM "ProductLove"
             WHERE "productId" = ANY($1::int[]) AND "createdAt" >= $2
             GROUP BY 1, 2`,
            ids,
            new Date(windowFrom.getTime() - 86_400_000),
          ) as Promise<LoveDay[]>),
      ids.length === 0
        ? Promise.resolve([])
        : tx.review.groupBy({
            by: ['productId'],
            where: { status: 'APPROVED', shopOnly: false, productId: { in: ids } },
            _count: { _all: true },
            _sum: { stars: true },
          }),
    ])
    const rows: PieceDayRow[] = pieceRows.map((r) => ({ ...r, day: isoDay(r.day) }))
    const reviews: ReviewStat[] = reviewRows
      .filter((r) => r.productId !== null)
      .map((r) => ({ productId: r.productId as number, count: r._count._all, starsSum: r._sum.stars ?? 0 }))

    const scores = computeScores({ productIds: ids, rows, loves: loveRows, reviews, today: day })
    const scoreById = new Map(scores.pieces.map((p) => [p.productId, p]))
    const newest = [...products].sort(
      (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || b.id - a.id,
    )
    const candidates: RankCandidate[] = newest.map((p, i) => {
      const s = scoreById.get(p.id)
      return {
        productId: p.id,
        score: s?.score ?? 100,
        views: s?.views ?? 0,
        publishedAt: p.publishedAt,
        soldOut: getAvailability(p.currentQuantity, settings?.fewLeftThreshold) === 'SOLD_OUT',
        hasPhoto: true,
        newestIndex: i,
      }
    })
    const ranking = rankForDay(candidates, { day, enough: scores.enough })
    const rankOf = new Map(ranking.order.map((id, i) => [id, i + 1]))
    const featuredSet = new Set(ranking.featured)

    await tx.productPopularity.deleteMany({})
    if (candidates.length > 0) {
      await tx.productPopularity.createMany({
        data: candidates.map((c) => {
          const s = scoreById.get(c.productId)
          return {
            productId: c.productId,
            day: new Date(`${day}T00:00:00Z`),
            score: c.score,
            parts: (s?.parts ?? {}) as Prisma.InputJsonValue,
            views: c.views,
            rank: ranking.ranked ? (rankOf.get(c.productId) ?? null) : null,
            coldStart: ranking.coldStart.has(c.productId),
            featured: featuredSet.has(c.productId),
            computedAt: now,
          }
        }),
      })
    }

    const featuredChanged: RankingRunResult['featuredChanged'] = []
    if (mode === 'AUTO') {
      const turnOn = await tx.product.findMany({
        where: { id: { in: ranking.featured }, featured: false },
        select: { id: true, slug: true },
      })
      const turnOff = await tx.product.findMany({
        where: { id: { notIn: ranking.featured }, featured: true },
        select: { id: true, slug: true },
      })
      if (turnOn.length) await tx.product.updateMany({ where: { id: { in: turnOn.map((p) => p.id) } }, data: { featured: true } })
      if (turnOff.length) await tx.product.updateMany({ where: { id: { in: turnOff.map((p) => p.id) } }, data: { featured: false } })
      featuredChanged.push(...turnOn.map((p) => ({ ...p, featured: true })), ...turnOff.map((p) => ({ ...p, featured: false })))
    }

    return {
      day,
      mode,
      pieces: candidates.length,
      totalViews: scores.totalViews,
      ranked: ranking.ranked,
      featured: ranking.featured,
      featuredChanged,
    }
  }, RANKING_TRANSACTION)
}

/** `--no-rank` for scripts/analytics-rollup.ts: skip the ranking step. The rest goes to parseRollupArgs. */
export function splitRankArg(argv: readonly string[]): { rank: boolean; rest: string[] } {
  return { rank: !argv.includes('--no-rank'), rest: argv.filter((a) => a !== '--no-rank') }
}

/** "Rank automatically" is on (Featured is read-only for the owner). */
export async function isAutoRanking(db: Pick<PrismaClient, 'siteSettings'> | Prisma.TransactionClient): Promise<boolean> {
  const row = await db.siteSettings.findUnique({ where: { id: SITE_SETTINGS_ID }, select: { feedRanking: true } })
  return (row?.feedRanking ?? 'AUTO') === 'AUTO'
}
