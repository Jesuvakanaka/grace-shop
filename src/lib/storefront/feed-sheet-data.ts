// ZP-510: the details sheet's extras for one piece. Server only.
//
// Only the existing cached reads: the public catalogue
// (getPublishedProductBySlug, answered in memory from the one cached entry),
// the reviews index and the public site settings. No new cache entry and no
// per-visitor database query. The DTO is built by buildSheetExtras
// (./feed-sheet.ts, public fields only).
import 'server-only'
import { getPublicSiteSettings } from '@/lib/site-settings/public'
import { isValidSlug } from '@/lib/storefront-model/slug'
import { buildSheetExtras, type SheetExtras } from './feed-sheet'
import { getPublishedProductBySlug, getReviewsIndex } from './index'
import { buildStoreVisit } from './menu-model'

/** The extras of a published piece, or null (unknown, unpublished or a renamed slug). */
export async function loadSheetExtras(slug: string, now: Date = new Date()): Promise<SheetExtras | null> {
  if (!isValidSlug(slug)) return null
  const [result, reviews, settings] = await Promise.all([getPublishedProductBySlug(slug), getReviewsIndex(), getPublicSiteSettings()])
  if (!result || !('product' in result)) return null
  return buildSheetExtras(result.product, {
    contacts: settings.contacts,
    reviews: reviews.products[slug] ?? null,
    shop: reviews.shop,
    visit: buildStoreVisit(settings),
    now,
  })
}
