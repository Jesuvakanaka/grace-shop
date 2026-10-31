// Cached storefront reads (ZP-484). Server only.
//
// Exactly TWO cache entries exist, whatever the request: the public
// catalogue and the category list. Their keys take no arguments, so
// anonymous traffic (any category, page, sort or unknown slug) can never add
// entries. Everything else is answered in memory from those two (./catalogue).
// `cache` is unstable_cache in ./index; tests pass a recording stand-in.
import { isValidSlug } from '@/lib/storefront-model'
import type { Db } from '@/lib/storefront-model/db'
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
    (): Promise<PublicCatalogue> => loadPublicCatalogue(deps.db),
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

  return {
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
  }
}
