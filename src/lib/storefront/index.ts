// Public data layer for the VYRA storefront (ZP-484). Server only.
//
// This is the module the public pages (src/app/site/**) and public API
// routes import. It is the security boundary between the private back office
// and the public site: it returns only allow-listed DTOs (./dto) of public
// products and categories (./queries), cached in the Next data cache with
// tags (./cache-tags). See docs/storefront/public-data-layer.md.
//
// The project does not enable Cache Components, so caching uses
// unstable_cache with tags; revalidateStorefront expires them.
import 'server-only'
import { unstable_cache } from 'next/cache'
import prisma from '@/lib/db'
import { isValidSlug } from '@/lib/storefront-model'
import * as queries from './queries'
import { STOREFRONT_TAGS, storefrontCategoryTag, storefrontProductTag } from './cache-tags'
import type { PublicCategory, PublicProduct } from './dto'

export { publicImageUrl, PUBLIC_IMAGE_URL_PREFIX } from './dto'
export {
  publicImageSrc,
  publicImageSrcSet,
  PUBLIC_IMAGE_WIDTHS,
  SRCSET_WIDTHS,
  type PublicImageWidth,
} from './image-sizes'
export type { PublicProduct, PublicCategory, PublicImage, PublicCategoryRef } from './dto'
export type {
  ListPublishedProductsOptions,
  ProductReadOptions,
  PublicProductPage,
  PublishedProductResult,
} from './queries'
export { PUBLIC_PRODUCT_SORTS, type PublicProductSort } from './listing'
export {
  revalidateStorefront,
  STOREFRONT_TAGS,
  storefrontProductTag,
  storefrontCategoryTag,
  type RevalidateScope,
} from './cache-tags'

/**
 * Backstop lifetime of every entry. On-demand revalidation does the real
 * work; this bounds a missed revalidation and keeps the derived `isNew`
 * flag (30 days after first publish) at most an hour late.
 */
export const STOREFRONT_REVALIDATE_SECONDS = 3600

const PRODUCT_TAGS = [STOREFRONT_TAGS.all, STOREFRONT_TAGS.products, STOREFRONT_TAGS.categories]
const CATEGORY_TAGS = [STOREFRONT_TAGS.all, STOREFRONT_TAGS.categories]
const revalidate = STOREFRONT_REVALIDATE_SECONDS

/** One page of public products (see queries.listPublishedProducts). */
export function listPublishedProducts(
  options: queries.ListPublishedProductsOptions = {},
): Promise<queries.PublicProductPage> {
  // An invalid category slug is answered uncached (always empty).
  if (options.categorySlug !== undefined && !isValidSlug(options.categorySlug)) {
    return queries.listPublishedProducts(prisma, options)
  }
  return unstable_cache(
    (o: queries.ListPublishedProductsOptions) => queries.listPublishedProducts(prisma, o),
    ['storefront', 'listPublishedProducts'],
    { tags: PRODUCT_TAGS, revalidate },
  )(options)
}

/** `{ product }`, `{ redirectTo }` for an old slug, or null. */
export async function getPublishedProductBySlug(
  slug: string,
  options: queries.ProductReadOptions = {},
): Promise<queries.PublishedProductResult> {
  // Junk from the URL never reaches the cache (keys and tags stay small).
  if (!isValidSlug(slug)) return null
  return unstable_cache(
    (s: string, o: queries.ProductReadOptions) => queries.getPublishedProductBySlug(prisma, s, o),
    ['storefront', 'getPublishedProductBySlug'],
    { tags: [...PRODUCT_TAGS, storefrontProductTag(slug)], revalidate },
  )(slug, options)
}

/** Other public products for a product page (same category first). */
export async function listRelatedProducts(
  slug: string,
  limit = 4,
  options: queries.ProductReadOptions = {},
): Promise<PublicProduct[]> {
  if (!isValidSlug(slug)) return []
  return unstable_cache(
    (s: string, l: number, o: queries.ProductReadOptions) => queries.listRelatedProducts(prisma, s, l, o),
    ['storefront', 'listRelatedProducts'],
    { tags: [...PRODUCT_TAGS, storefrontProductTag(slug)], revalidate },
  )(slug, limit, options)
}

/** Published categories in display order. */
export function listPublishedCategories(): Promise<PublicCategory[]> {
  return unstable_cache(() => queries.listPublishedCategories(prisma), ['storefront', 'listPublishedCategories'], {
    tags: CATEGORY_TAGS,
    revalidate,
  })()
}

/** A published category, or null. */
export async function getPublishedCategory(slug: string): Promise<PublicCategory | null> {
  if (!isValidSlug(slug)) return null
  return unstable_cache(
    (s: string) => queries.getPublishedCategory(prisma, s),
    ['storefront', 'getPublishedCategory'],
    { tags: [...CATEGORY_TAGS, storefrontCategoryTag(slug)], revalidate },
  )(slug)
}
