// ZP-490: "You may also like" on the product page. Pure.
import type { PublicProduct } from './dto'

export const RELATED_LIMIT = 4

/**
 * Up to `limit` other products from the same category as `current`, in the
 * order given (the catalogue's default order). Sold-out pieces are left out
 * when there are enough others, otherwise they fill the remaining places,
 * last. Never the product itself; each slug once.
 */
export function pickRelated(
  candidates: readonly PublicProduct[],
  current: Pick<PublicProduct, 'slug' | 'category'>,
  limit: number = RELATED_LIMIT,
): PublicProduct[] {
  const take = Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0))
  if (take === 0 || !current.category.slug) return []
  const seen = new Set<string>([current.slug])
  const available: PublicProduct[] = []
  const soldOut: PublicProduct[] = []
  for (const p of candidates) {
    if (p.category.slug !== current.category.slug || seen.has(p.slug)) continue
    seen.add(p.slug)
    ;(p.availability === 'SOLD_OUT' ? soldOut : available).push(p)
  }
  return [...available, ...soldOut].slice(0, take)
}
