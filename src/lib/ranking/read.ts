// ZP-506: reading the stored ranking. Server only.
// - loadFeedRanking: the storefront's one argument-free cached entry
//   (src/lib/storefront/cached.ts `getFeedRanking`): the mode and today's rank
//   per public slug. No scores or parts leave the server through it.
// - loadPopularity: scores and parts for the admin (Insights).
import type { Prisma, PrismaClient } from '@prisma/client'
import { SITE_SETTINGS_ID } from '@/lib/site-settings/db'
import type { FeedRanking, FeedRankingMode } from './feed-order'
import type { ScoreParts } from './score'

type Db = PrismaClient | Prisma.TransactionClient

export async function loadFeedRanking(db: Db): Promise<FeedRanking> {
  const [settings, rows] = await Promise.all([
    db.siteSettings.findUnique({ where: { id: SITE_SETTINGS_ID }, select: { feedRanking: true } }),
    db.productPopularity.findMany({
      where: { rank: { not: null }, product: { published: true, slug: { not: null }, category: { is: { published: true } } } },
      select: { rank: true, product: { select: { slug: true } } },
    }),
  ])
  const ranks: Record<string, number> = {}
  for (const r of rows) if (r.product.slug && r.rank !== null) ranks[r.product.slug] = r.rank
  return { mode: (settings?.feedRanking ?? 'AUTO') as FeedRankingMode, ranks }
}

export type PopularityInfo = {
  productId: number
  score: number
  rank: number | null
  views: number
  coldStart: boolean
  featured: boolean
  parts: ScoreParts | null
  day: string
  computedAt: string
}

/** Stored popularity of these products (any that have a row). */
export async function loadPopularity(db: Db, ids: readonly number[]): Promise<Map<number, PopularityInfo>> {
  if (ids.length === 0) return new Map()
  const rows = await db.productPopularity.findMany({ where: { productId: { in: [...ids] } } })
  return new Map(
    rows.map((r) => [
      r.productId,
      {
        productId: r.productId,
        score: r.score,
        rank: r.rank,
        views: r.views,
        coldStart: r.coldStart,
        featured: r.featured,
        parts: r.parts && typeof r.parts === 'object' && 'signals' in (r.parts as object) ? (r.parts as unknown as ScoreParts) : null,
        day: r.day.toISOString().slice(0, 10),
        computedAt: r.computedAt.toISOString(),
      },
    ]),
  )
}

/** The latest run: when, and whether it ranked (enough data). null before the first run. */
export async function loadRankingStatus(db: Db): Promise<{ computedAt: string; day: string; ranked: boolean; mode: FeedRankingMode } | null> {
  const [settings, latest, ranked] = await Promise.all([
    db.siteSettings.findUnique({ where: { id: SITE_SETTINGS_ID }, select: { feedRanking: true } }),
    db.productPopularity.findFirst({ orderBy: { computedAt: 'desc' }, select: { computedAt: true, day: true } }),
    db.productPopularity.count({ where: { rank: { not: null } } }),
  ])
  if (!latest) return null
  return {
    computedAt: latest.computedAt.toISOString(),
    day: latest.day.toISOString().slice(0, 10),
    ranked: ranked > 0,
    mode: (settings?.feedRanking ?? 'AUTO') as FeedRankingMode,
  }
}
