// Public storefront queries (ZP-484), uncached. Server only.
//
// Every function takes the Prisma client (or a transaction) so it can be
// tested and scripted; ./index wraps them in the Next cache. They select an
// explicit set of columns and return DTOs from ./dto, never raw rows.
//
// Visibility rule: a product is public only when it is published, has a slug
// and its category is published. A category is public only when published.
import type { Prisma } from '@prisma/client'
import { isValidImageKey } from '@/lib/storage/keys'
import { NEW_ARRIVAL_DAYS, isValidSlug } from '@/lib/storefront-model'
import { resolveProductSlug, type Db } from '@/lib/storefront-model/db'
import {
  toPublicCategory,
  toPublicProduct,
  type PublicCategory,
  type PublicProduct,
  type PublicProductRow,
} from './dto'
import { normalisePaging, sortProductRows, type PublicProductSort } from './listing'

if (typeof window !== 'undefined') throw new Error('src/lib/storefront is server-only')

const DAY_MS = 86_400_000

/** Where clause for "this product is on the public site". */
export const PUBLIC_PRODUCT_WHERE = {
  published: true,
  slug: { not: null },
  category: { is: { published: true } },
} satisfies Prisma.ProductWhereInput

const PRODUCT_SELECT = {
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
} satisfies Prisma.ProductSelect

const CATEGORY_SELECT = {
  slug: true,
  name: true,
  description: true,
  heroImageKey: true,
} satisfies Prisma.CategorySelect

export type ProductReadOptions = {
  /** "Few left" threshold (site settings in ZP-486). Default FEW_LEFT_THRESHOLD. */
  fewLeftThreshold?: number
  /** Include the item number in the DTO. Default off. */
  includeItemNumber?: boolean
}

export type ListPublishedProductsOptions = ProductReadOptions & {
  categorySlug?: string
  /** Published within NEW_ARRIVAL_DAYS. */
  newOnly?: boolean
  featuredOnly?: boolean
  hideSoldOut?: boolean
  sort?: PublicProductSort
  page?: number
  pageSize?: number
}

export type PublicProductPage = {
  items: PublicProduct[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

function dtoOptions(options: ProductReadOptions, now: Date) {
  return { now, fewLeftThreshold: options.fewLeftThreshold, includeItemNumber: options.includeItemNumber === true }
}

/**
 * One page of public products. Filters run in the database; sorting and
 * paging run in memory over the filtered set (the catalogue is a few hundred
 * products), so price sorts can use only public prices.
 */
export async function listPublishedProducts(
  db: Db,
  options: ListPublishedProductsOptions = {},
  now: Date = new Date(),
): Promise<PublicProductPage> {
  const { page, pageSize } = normalisePaging(options)
  const empty = { items: [], total: 0, page, pageSize, pageCount: 0 }
  if (options.categorySlug !== undefined && !isValidSlug(options.categorySlug)) return empty

  const where: Prisma.ProductWhereInput = {
    ...PUBLIC_PRODUCT_WHERE,
    ...(options.categorySlug !== undefined && { category: { is: { published: true, slug: options.categorySlug } } }),
    ...(options.featuredOnly && { featured: true }),
    ...(options.hideSoldOut && { currentQuantity: { gt: 0 } }),
    ...(options.newOnly && { publishedAt: { gte: new Date(now.getTime() - NEW_ARRIVAL_DAYS * DAY_MS) } }),
  }
  const rows: PublicProductRow[] = await db.product.findMany({ where, select: PRODUCT_SELECT })
  const sorted = sortProductRows(rows, options.sort)
  const start = (page - 1) * pageSize
  const opts = dtoOptions(options, now)
  return {
    items: sorted.slice(start, start + pageSize).map((r) => toPublicProduct(r, opts)),
    total: sorted.length,
    page,
    pageSize,
    pageCount: Math.ceil(sorted.length / pageSize),
  }
}

export type PublishedProductResult = { product: PublicProduct } | { redirectTo: string } | null

/**
 * A public product by slug. An old slug (ProductSlugRedirect) of a public
 * product returns `{ redirectTo: <current slug> }`. Unknown, invalid or
 * non-public slugs return null, whether live or old.
 */
export async function getPublishedProductBySlug(
  db: Db,
  slug: string,
  options: ProductReadOptions = {},
  now: Date = new Date(),
): Promise<PublishedProductResult> {
  if (!isValidSlug(slug)) return null
  const resolved = await resolveProductSlug(db, slug)
  if (!resolved) return null
  const row = await db.product.findFirst({
    where: { ...PUBLIC_PRODUCT_WHERE, id: resolved.productId },
    select: PRODUCT_SELECT,
  })
  if (!row) return null
  if (resolved.redirected) return { redirectTo: resolved.slug }
  return { product: toPublicProduct(row, dtoOptions(options, now)) }
}

export const MAX_RELATED = 12

/**
 * Other public products for a product page: same category first, then the
 * rest of the catalogue, both in the default order. Never the product itself
 * or sold-out products. A non-public slug gives [].
 */
export async function listRelatedProducts(
  db: Db,
  slug: string,
  limit = 4,
  options: ProductReadOptions = {},
  now: Date = new Date(),
): Promise<PublicProduct[]> {
  const take = Math.min(MAX_RELATED, Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0)))
  if (take === 0 || !isValidSlug(slug)) return []
  const self = await db.product.findFirst({
    where: { ...PUBLIC_PRODUCT_WHERE, slug },
    select: { id: true, category: { select: { slug: true } } },
  })
  if (!self) return []
  const rows: PublicProductRow[] = await db.product.findMany({
    where: { ...PUBLIC_PRODUCT_WHERE, id: { not: self.id }, currentQuantity: { gt: 0 } },
    select: PRODUCT_SELECT,
  })
  const sameCategory = (r: PublicProductRow) => r.category?.slug === self.category?.slug
  const ordered = sortProductRows(rows)
  const picked = [...ordered.filter(sameCategory), ...ordered.filter((r) => !sameCategory(r))].slice(0, take)
  const opts = dtoOptions(options, now)
  return picked.map((r) => toPublicProduct(r, opts))
}

/** Published categories, by sortOrder then name. */
export async function listPublishedCategories(db: Db): Promise<PublicCategory[]> {
  const rows = await db.category.findMany({
    where: { published: true },
    select: CATEGORY_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toPublicCategory)
}

/** A published category by slug, else null. */
export async function getPublishedCategory(db: Db, slug: string): Promise<PublicCategory | null> {
  if (!isValidSlug(slug)) return null
  const row = await db.category.findFirst({ where: { slug, published: true }, select: CATEGORY_SELECT })
  return row ? toPublicCategory(row) : null
}

/**
 * Whether an image key may be served publicly: it belongs to a ProductImage
 * of a public product (any one of them; keys are shared between products),
 * or it is the hero image of a published category. Not cached, so
 * unpublishing takes effect at once for this check.
 */
export async function isPublicImageKey(db: Db, key: string): Promise<boolean> {
  if (!isValidImageKey(key)) return false
  const [image, category] = await Promise.all([
    db.productImage.findFirst({ where: { imageKey: key, product: PUBLIC_PRODUCT_WHERE }, select: { id: true } }),
    db.category.findFirst({ where: { heroImageKey: key, published: true }, select: { id: true } }),
  ])
  return image !== null || category !== null
}
