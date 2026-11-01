// Cached storefront reads (ZP-484). Server only.
//
// Exactly FOUR cache entries exist, whatever the request: the public
// catalogue, the category list, (ZP-508) the approved reviews and (ZP-506)
// the feed ranking. Their keys take no arguments, so
// anonymous traffic (any category, page, sort or unknown slug) can never add
// entries. Everything else is answered in memory from those two (./catalogue).
// `cache` is unstable_cache in ./index; tests pass a recording stand-in.
import { isValidSlug } from '@/lib/storefront-model'
import type { Db } from '@/lib/storefront-model/db'
import { readFewLeftThreshold } from '@/lib/site-settings/db'
import { STOREFRONT_REVALIDATE_SECONDS, STOREFRONT_TAGS } from './cache-tags'
import {
  findProduct,
  relatedProducts,
  selectProducts,
  type CatalogueListOptions,
  type CatalogueReadOptions,
  type PublicCatalogue,
  type PublicProductPage,
  type PublishedProductResult,
} from './catalogue'
import type { PublicCategory, PublicProduct } from './dto'
import { loadPublicCatalogue, loadPublicCategories } from './queries'
import type { FeedRanking } from '@/lib/ranking/feed-order'
import { loadFeedRanking } from '@/lib/ranking/read'
import { loadPublicReviews, type PublicReviewsIndex } from './reviews'

if (typeof window !== 'undefined') throw new Error('src/lib/storefront is server-only')

/** The part of unstable_cache's signature this module uses. */
export type CacheFn = <T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
  keyParts: string[],
  options: { tags: string[]; revalidate: number },
) => T

/** Bump when the cached shape changes, so old entries are never read. */
const CACHE_VERSION = 'v1'

export function createStorefront(deps: { db: Db; cache: CacheFn }) {
  const catalogue = deps.cache(
    // The few-left threshold comes from site settings (ZP-486). A settings
    // save that changes it expires the whole storefront (no-scope revalidate).
    async (): Promise<PublicCatalogue> =>
      loadPublicCatalogue(deps.db, { fewLeftThreshold: await readFewLeftThreshold(deps.db) }),
    ['storefront', 'catalogue', CACHE_VERSION],
    {
      // Product DTOs embed category names and depend on category visibility.
      tags: [STOREFRONT_TAGS.all, STOREFRONT_TAGS.products, STOREFRONT_TAGS.categories],
      revalidate: STOREFRONT_REVALIDATE_SECONDS,
    },
  )
  const categories = deps.cache(
    (): Promise<PublicCategory[]> => loadPublicCategories(deps.db),
    ['storefront', 'categories', CACHE_VERSION],
    { tags: [STOREFRONT_TAGS.all, STOREFRONT_TAGS.categories], revalidate: STOREFRONT_REVALIDATE_SECONDS },
  )
  // ZP-508: a third argument-free entry: approved reviews and aggregates.
  // Keyed by product slug and limited to public pieces, so it also carries
  // the products and categories tags (a slug change or unpublish refreshes it).
  const reviews = deps.cache(
    (): Promise<PublicReviewsIndex> => loadPublicReviews(deps.db),
    ['storefront', 'reviews', CACHE_VERSION],
    {
      tags: [STOREFRONT_TAGS.all, STOREFRONT_TAGS.reviews, STOREFRONT_TAGS.products, STOREFRONT_TAGS.categories],
      revalidate: STOREFRONT_REVALIDATE_SECONDS,
    },
  )

  // ZP-506: a fourth argument-free entry: the feed ranking mode and today's
  // rank per public slug (written nightly). Settings tag: the "Newest first"
  // switch; products / categories tags: slugs and visibility.
  const ranking = deps.cache(
    (): Promise<FeedRanking> => loadFeedRanking(deps.db),
    ['storefront', 'ranking', CACHE_VERSION],
    {
      tags: [STOREFRONT_TAGS.all, STOREFRONT_TAGS.ranking, STOREFRONT_TAGS.settings, STOREFRONT_TAGS.products, STOREFRONT_TAGS.categories],
      revalidate: STOREFRONT_REVALIDATE_SECONDS,
    },
  )

  return {
    /** ZP-506: the feed order mode and today's ranks (src/lib/ranking/feed-order.ts). */
    getFeedRanking(): Promise<FeedRanking> {
      return ranking()
    },
    /** One page of public products. */
    async listPublishedProducts(options: CatalogueListOptions = {}): Promise<PublicProductPage> {
      return selectProducts(await catalogue(), options)
    },
    /** `{ product }`, `{ redirectTo }` for an old slug, or null. */
    async getPublishedProductBySlug(slug: string, options: CatalogueReadOptions = {}): Promise<PublishedProductResult> {
      if (!isValidSlug(slug)) return null
      return findProduct(await catalogue(), slug, options)
    },
    /** Other public products for a product page (same category first). */
    async listRelatedProducts(slug: string, limit = 4, options: CatalogueReadOptions = {}): Promise<PublicProduct[]> {
      if (!isValidSlug(slug)) return []
      return relatedProducts(await catalogue(), slug, limit, options)
    },
    /** Published categories in display order. */
    listPublishedCategories(): Promise<PublicCategory[]> {
      return categories()
    },
    /** A published category, or null. */
    async getPublishedCategory(slug: string): Promise<PublicCategory | null> {
      if (!isValidSlug(slug)) return null
      return (await categories()).find((c) => c.slug === slug) ?? null
    },
    /** ZP-508: approved reviews by product slug, plus the shop rating. */
    getReviewsIndex(): Promise<PublicReviewsIndex> {
      return reviews()
    },
  }
}
