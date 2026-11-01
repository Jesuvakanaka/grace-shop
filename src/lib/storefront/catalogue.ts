// The public catalogue (ZP-484): every public product as a DTO, plus old
// slugs, built once and cached as ONE entry (./cached). Lists, slug lookups
// and related products are answered from it in memory, so no request
// argument (category, page, unknown slug) ever creates a cache entry. Pure.
import { isValidSlug } from '@/lib/storefront-model'
import { toPublicProduct, type ProductDtoOptions, type PublicProduct, type PublicProductRow } from './dto'
import { normalisePaging, productSortKey, sortProducts, type ProductSortKey, type PublicProductSort } from './listing'

export type CatalogueProduct = {
  /** Allow-listed DTO, without the item number. */
  product: PublicProduct
  /** Kept beside the DTO and added only when a caller opts in. */
  itemNumber: string
  sort: ProductSortKey
}

export type PublicCatalogue = {
  /** In the default order. */
  products: CatalogueProduct[]
  /** Old slug -> current slug, only for public products. */
  redirects: Record<string, string>
}

export function buildCatalogue(
  rows: readonly PublicProductRow[],
  redirects: readonly { oldSlug: string; slug: string }[],
  options: Pick<ProductDtoOptions, 'now' | 'fewLeftThreshold'>,
): PublicCatalogue {
  const products = sortProducts(
    rows.map((row) => ({
      product: toPublicProduct(row, { now: options.now, fewLeftThreshold: options.fewLeftThreshold }),
      itemNumber: row.itemNumber,
      sort: productSortKey(row),
    })),
  )
  const map: Record<string, string> = {}
  for (const r of redirects) if (isValidSlug(r.oldSlug) && isValidSlug(r.slug)) map[r.oldSlug] = r.slug
  return { products, redirects: map }
}

export type CatalogueReadOptions = {
  /** Include the item number in the DTO. Default off. */
  includeItemNumber?: boolean
}

export type CatalogueListOptions = CatalogueReadOptions & {
  categorySlug?: string
  /** New arrivals (isNew). */
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
  /** Every matching product (on all pages) shows a public price. ZP-489 offers price sorts only then. */
  allPriced: boolean
}

export type PublishedProductResult = { product: PublicProduct } | { redirectTo: string } | null

function out(entry: CatalogueProduct, options: CatalogueReadOptions): PublicProduct {
  return options.includeItemNumber ? { ...entry.product, itemNumber: entry.itemNumber } : entry.product
}

export function selectProducts(catalogue: PublicCatalogue, options: CatalogueListOptions = {}): PublicProductPage {
  const { page, pageSize } = normalisePaging(options)
  const matches = catalogue.products.filter(
    ({ product: p }) =>
      (options.categorySlug === undefined || p.category.slug === options.categorySlug) &&
      (!options.newOnly || p.isNew) &&
      (!options.featuredOnly || p.featured) &&
      (!options.hideSoldOut || p.availability !== 'SOLD_OUT'),
  )
  const sorted = options.sort && options.sort !== 'featured' ? sortProducts(matches, options.sort) : matches
  const start = (page - 1) * pageSize
  return {
    items: sorted.slice(start, start + pageSize).map((e) => out(e, options)),
    total: sorted.length,
    page,
    pageSize,
    pageCount: Math.ceil(sorted.length / pageSize),
    allPriced: sorted.every((e) => e.product.priceUsd !== null),
  }
}

/** `{ product }`, `{ redirectTo }` for an old slug of a public product, else null. */
export function findProduct(
  catalogue: PublicCatalogue,
  slug: string,
  options: CatalogueReadOptions = {},
): PublishedProductResult {
  if (!isValidSlug(slug)) return null
  const live = catalogue.products.find((e) => e.product.slug === slug)
  if (live) return { product: out(live, options) }
  const target = Object.prototype.hasOwnProperty.call(catalogue.redirects, slug) ? catalogue.redirects[slug] : undefined
  if (target && catalogue.products.some((e) => e.product.slug === target)) return { redirectTo: target }
  return null
}

export const MAX_RELATED = 12

/**
 * Other public products for a product page: same category first, then the
 * rest, in the default order. Never the product itself or sold-out products.
 * A non-public slug gives [].
 */
export function relatedProducts(
  catalogue: PublicCatalogue,
  slug: string,
  limit = 4,
  options: CatalogueReadOptions = {},
): PublicProduct[] {
  const take = Math.min(MAX_RELATED, Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0)))
  if (take === 0 || !isValidSlug(slug)) return []
  const self = catalogue.products.find((e) => e.product.slug === slug)
  if (!self) return []
  const others = catalogue.products.filter((e) => e !== self && e.product.availability !== 'SOLD_OUT')
  const same = (e: CatalogueProduct) => e.product.category.slug === self.product.category.slug
  return [...others.filter(same), ...others.filter((e) => !same(e))].slice(0, take).map((e) => out(e, options))
}
