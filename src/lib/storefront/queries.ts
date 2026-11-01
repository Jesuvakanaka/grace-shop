// Public storefront queries (ZP-484), uncached. Server only.
//
// loadPublicCatalogue and loadPublicCategories are the only database reads
// for public data; ./cached caches exactly these two. The list/lookup
// functions below are uncached conveniences (tests, scripts) that answer
// from a freshly loaded catalogue with the same in-memory code (./catalogue).
//
// Visibility rule: a product is public only when it is published, has a slug
// and its category is published. A category is public only when published.
import type { Prisma } from '@prisma/client'
import { isValidImageKey } from '@/lib/storage/keys'
import { isValidSlug } from '@/lib/storefront-model'
import type { Db } from '@/lib/storefront-model/db'
import { isSettingsImageKey } from '@/lib/site-settings/db'
import { toPublicCategory, type PublicCategory, type PublicProduct, type PublicProductRow } from './dto'
import {
  buildCatalogue,
  findProduct,
  relatedProducts,
  selectProducts,
  type CatalogueListOptions,
  type CatalogueReadOptions,
  type PublicCatalogue,
  type PublicProductPage,
  type PublishedProductResult,
} from './catalogue'

if (typeof window !== 'undefined') throw new Error('src/lib/storefront is server-only')

export type { PublicProductPage, PublishedProductResult } from './catalogue'

/** Where clause for "this product is on the public site". */
export const PUBLIC_PRODUCT_WHERE = {
  published: true,
  slug: { not: null },
  category: { is: { published: true } },
} satisfies Prisma.ProductWhereInput

export const PRODUCT_SELECT = {
  id: true,
  itemNumber: true,
  productName: true,
  publicName: true,
  slug: true,
  publicDescription: true,
  colours: true,
  sizes: true,
  featured: true,
  sortOrder: true,
  published: true,
  publishedAt: true,
  priceDisplay: true,
  sellingPriceUsd: true,
  currentQuantity: true,
  category: { select: { slug: true, name: true, published: true } },
  images: { select: { id: true, imageKey: true, alt: true, sortOrder: true, isPrimary: true } },
  // ZP-501: the DTO keeps only { src, poster, width, height } of a READY video.
  video: { select: { status: true, videoKey: true, posterKey: true, width: true, height: true } },
} satisfies Prisma.ProductSelect

const CATEGORY_SELECT = {
  slug: true,
  name: true,
  description: true,
  heroImageKey: true,
} satisfies Prisma.CategorySelect

export type CatalogueLoadOptions = {
  now?: Date
  /** "Few left" threshold; site settings in ZP-486 (which then revalidates the catalogue). */
  fewLeftThreshold?: number
}

/** Every public product as a DTO, plus the old slugs of public products. */
export async function loadPublicCatalogue(db: Db, options: CatalogueLoadOptions = {}): Promise<PublicCatalogue> {
  const [rows, redirects] = await Promise.all([
    db.product.findMany({ where: PUBLIC_PRODUCT_WHERE, select: PRODUCT_SELECT }) as Promise<PublicProductRow[]>,
    db.productSlugRedirect.findMany({
      where: { product: PUBLIC_PRODUCT_WHERE },
      select: { oldSlug: true, product: { select: { slug: true } } },
    }),
  ])
  return buildCatalogue(
    rows,
    redirects.map((r) => ({ oldSlug: r.oldSlug, slug: r.product.slug ?? '' })),
    { now: options.now ?? new Date(), fewLeftThreshold: options.fewLeftThreshold },
  )
}

/** Published categories, by sortOrder then name. */
export async function loadPublicCategories(db: Db): Promise<PublicCategory[]> {
  const rows = await db.category.findMany({
    where: { published: true },
    select: CATEGORY_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toPublicCategory)
}

// ─── Uncached conveniences (tests, scripts) ─────────────────────────────────

export type ProductReadOptions = CatalogueReadOptions & { fewLeftThreshold?: number }
export type ListPublishedProductsOptions = CatalogueListOptions & { fewLeftThreshold?: number }

export async function listPublishedProducts(
  db: Db,
  options: ListPublishedProductsOptions = {},
  now: Date = new Date(),
): Promise<PublicProductPage> {
  const catalogue = await loadPublicCatalogue(db, { now, fewLeftThreshold: options.fewLeftThreshold })
  return selectProducts(catalogue, options)
}

export async function getPublishedProductBySlug(
  db: Db,
  slug: string,
  options: ProductReadOptions = {},
  now: Date = new Date(),
): Promise<PublishedProductResult> {
  if (!isValidSlug(slug)) return null
  return findProduct(await loadPublicCatalogue(db, { now, fewLeftThreshold: options.fewLeftThreshold }), slug, options)
}

export async function listRelatedProducts(
  db: Db,
  slug: string,
  limit = 4,
  options: ProductReadOptions = {},
  now: Date = new Date(),
): Promise<PublicProduct[]> {
  if (!isValidSlug(slug)) return []
  const catalogue = await loadPublicCatalogue(db, { now, fewLeftThreshold: options.fewLeftThreshold })
  return relatedProducts(catalogue, slug, limit, options)
}

export const listPublishedCategories = loadPublicCategories

export async function getPublishedCategory(db: Db, slug: string): Promise<PublicCategory | null> {
  if (!isValidSlug(slug)) return null
  return (await loadPublicCategories(db)).find((c) => c.slug === slug) ?? null
}

/**
 * Whether an image key may be served publicly: it belongs to a ProductImage
 * of a public product (any one of them; keys are shared between products),
 * or it is the hero image of a published category, or it is one of the
 * CURRENT site settings pictures (hero desktop/mobile, about, share image;
 * settingsImageKeys, ZP-486). Not cached, so unpublishing or replacing a
 * picture takes effect at once for this check.
 */
export async function isPublicImageKey(db: Db, key: string): Promise<boolean> {
  if (!isValidImageKey(key)) return false
  const [image, category, settings] = await Promise.all([
    db.productImage.findFirst({ where: { imageKey: key, product: PUBLIC_PRODUCT_WHERE }, select: { id: true } }),
    db.category.findFirst({ where: { heroImageKey: key, published: true }, select: { id: true } }),
    isSettingsImageKey(db, key),
  ])
  return image !== null || category !== null || settings
}
