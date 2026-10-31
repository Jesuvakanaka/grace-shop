// Public data layer for the VYRA storefront (ZP-484). Server only.
//
// This is the module the public pages (src/app/site/**) and public API
// routes import. It is the security boundary between the private back office
// and the public site: it returns only allow-listed DTOs (./dto) of public
// products and categories. See docs/storefront/public-data-layer.md.
//
// Caching: the project does not enable Cache Components, so unstable_cache
// with tags. Exactly two entries (catalogue, categories; ./cached), so
// requests can never grow the cache. revalidateStorefront expires them.
import 'server-only'
import { unstable_cache } from 'next/cache'
import prisma from '@/lib/db'
import { createStorefront, type CacheFn } from './cached'

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
  CatalogueListOptions as ListPublishedProductsOptions,
  CatalogueReadOptions as ProductReadOptions,
  PublicProductPage,
  PublishedProductResult,
} from './catalogue'
export { PUBLIC_PRODUCT_SORTS, type PublicProductSort } from './listing'
export {
  revalidateStorefront,
  STOREFRONT_TAGS,
  STOREFRONT_REVALIDATE_SECONDS,
  storefrontProductTag,
  storefrontCategoryTag,
  type RevalidateScope,
} from './cache-tags'

const storefront = createStorefront({ db: prisma, cache: unstable_cache as unknown as CacheFn })

export const {
  listPublishedProducts,
  getPublishedProductBySlug,
  listRelatedProducts,
  listPublishedCategories,
  getPublishedCategory,
} = storefront
