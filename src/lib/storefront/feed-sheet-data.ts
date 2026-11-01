// ZP-510: the details sheet's extras for one piece. Server only.
//
// Only cached reads: the public catalogue (getPublishedProductBySlug and,
// ZP-513, the feed's order for "You may also like", answered in memory from
// the one cached entry), the reviews index, the public site settings and
// (ZP-513) the 5-minute "asked this week" counts. No per-visitor database
// query. The DTO is built by buildSheetExtras (./feed-sheet.ts, public fields only).
import 'server-only'
import { ASK_FOR_PRICE, formatPriceUsd } from '@/components/storefront/product'
import { getPublicSiteSettings } from '@/lib/site-settings/public'
import { isValidSlug } from '@/lib/storefront-model/slug'
import { getAskedBySlug } from './asked'
import { orderedFeedPieces } from './feed-data'
import { buildSheetExtras, pickAlsoLike, type AlsoLikePiece, type SheetExtras } from './feed-sheet'
import { getPublishedProductBySlug, getReviewsIndex, type PublicProduct } from './index'
import { buildStoreVisit } from './menu-model'

function toAlsoLike(p: PublicProduct): AlsoLikePiece {
  const first = p.images[0]
  return {
    slug: p.slug,
    name: p.name,
    price: formatPriceUsd(p.priceUsd) ?? ASK_FOR_PRICE,
    image: first ? { src: first.url, srcSet: first.srcSet, alt: first.alt } : null,
  }
}

/** The extras of a published piece, or null (unknown, unpublished or a renamed slug). */
export async function loadSheetExtras(slug: string, now: Date = new Date()): Promise<SheetExtras | null> {
  if (!isValidSlug(slug)) return null
  const [result, reviews, settings, ordered, asked] = await Promise.all([
    getPublishedProductBySlug(slug),
    getReviewsIndex(),
    getPublicSiteSettings(),
    orderedFeedPieces(),
    // The counts are a nicety: a failed query hides the line instead of failing the sheet.
    getAskedBySlug().catch(() => ({}) as Record<string, number>),
  ])
  if (!result || !('product' in result)) return null
  const product = result.product
  const alsoLike = pickAlsoLike(
    ordered.map((p) => ({ slug: p.slug, category: p.category.slug, soldOut: p.availability === 'SOLD_OUT', p })),
    { slug: product.slug, category: product.category.slug },
  ).map((x) => toAlsoLike(x.p))
  return buildSheetExtras(product, {
    contacts: settings.contacts,
    reviews: reviews.products[slug] ?? null,
    shop: reviews.shop,
    visit: buildStoreVisit(settings),
    now,
    defaultSizeChart: settings.buying.sizeChart,
    buying: { holdHours: settings.buying.holdHours, paymentMethods: settings.buying.paymentMethods },
    asked: asked[slug] ?? 0,
    alsoLike,
  })
}
