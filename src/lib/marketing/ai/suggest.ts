// VYRA Marketing hub (ZP-1200): which products to promote this week. Pure code on data
// already in the database; no AI call. Server only.
import { displayName, NEW_ARRIVAL_DAYS } from '@/lib/storefront-model/rules'
import type { Db } from '../audit'

const DAY_MS = 86_400_000
/** A product promoted within this many days ranks lower. */
export const RECENT_PROMO_DAYS = 14
/** A pre-order counts as "closing soon" when it ships within this many days. */
export const PREORDER_SOON_DAYS = 30

export interface Suggestion {
  productId: number
  name: string
  slug: string | null
  score: number
  /** Plain words for the owner. */
  reason: string
  reasons: string[]
}

export interface SuggestInput {
  limit?: number
  now?: Date
}

export async function suggestProducts(db: Db, input: SuggestInput = {}): Promise<Suggestion[]> {
  const now = input.now ?? new Date()
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 10) || 10, 1), 50)
  const products = await db.product.findMany({
    where: { published: true },
    select: {
      id: true, productName: true, publicName: true, slug: true, publishedAt: true, currentQuantity: true,
      listingType: true, preorderShipFrom: true, loveCount: true, popularity: { select: { score: true } },
    },
    take: 1000,
  })
  const since = new Date(now.getTime() - RECENT_PROMO_DAYS * DAY_MS)
  const recent = await db.marketingContent.findMany({
    where: { productId: { not: null }, createdAt: { gte: since } },
    select: { productId: true },
  })
  const promoted = new Set(recent.map((r) => r.productId))

  const out: Suggestion[] = []
  for (const p of products) {
    const reasons: string[] = []
    let score = 0
    const preorder = p.listingType === 'PRE_ORDER'
    if (preorder) {
      const ship = p.preorderShipFrom
      const days = ship ? Math.ceil((ship.getTime() - now.getTime()) / DAY_MS) : null
      if (days !== null && days >= 0 && days <= PREORDER_SOON_DAYS) {
        score += 25
        reasons.push(days === 0 ? 'Pre-order ships from today' : `Pre-order ships in ${days} day${days === 1 ? '' : 's'}`)
      } else {
        score += 8
        reasons.push('Open for pre-order')
      }
    } else if (p.currentQuantity > 0) {
      score += 15
      reasons.push(p.currentQuantity <= 3 ? 'Only a few left in stock' : 'In stock')
    } else {
      continue // nothing to sell
    }
    if (p.publishedAt) {
      const age = (now.getTime() - p.publishedAt.getTime()) / DAY_MS
      if (age >= 0 && age <= NEW_ARRIVAL_DAYS) {
        score += Math.round(30 * (1 - age / NEW_ARRIVAL_DAYS)) + 5
        reasons.push(age < 1 ? 'New today' : `New arrival, ${Math.floor(age)} day${Math.floor(age) === 1 ? '' : 's'} on the site`)
      }
    }
    const pop = p.popularity?.score
    if (typeof pop === 'number' && pop > 100) {
      score += Math.min(20, Math.round((pop - 100) / 5))
      reasons.push('Popular with visitors')
    }
    if (p.loveCount > 0) {
      score += Math.min(10, Math.ceil(p.loveCount / 2))
      reasons.push(`${p.loveCount} love${p.loveCount === 1 ? '' : 's'}`)
    }
    if (promoted.has(p.id)) {
      score -= 25
      reasons.push(`Already promoted in the last ${RECENT_PROMO_DAYS} days`)
    }
    out.push({ productId: p.id, name: displayName(p), slug: p.slug, score, reason: reasons.join('; '), reasons })
  }
  out.sort((a, b) => b.score - a.score || a.productId - b.productId)
  return out.slice(0, limit)
}
