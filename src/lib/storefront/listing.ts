// Sorting and paging for public product lists (ZP-484). Pure.
import { displayName, publicPriceUsd } from '@/lib/storefront-model'
import type { PublicProductRow } from './dto'

export const PUBLIC_PRODUCT_SORTS = ['featured', 'newest', 'price-asc', 'price-desc', 'name'] as const
export type PublicProductSort = (typeof PUBLIC_PRODUCT_SORTS)[number]

export function isPublicProductSort(value: unknown): value is PublicProductSort {
  return typeof value === 'string' && (PUBLIC_PRODUCT_SORTS as readonly string[]).includes(value)
}

export const DEFAULT_PAGE_SIZE = 24
export const MAX_PAGE_SIZE = 48

/**
 * What a product is sorted by. Only public values (the price is the PUBLIC
 * price or null) plus the database id as a stable tie-breaker; it is stored
 * in the cached catalogue, never sent to the client.
 */
export type ProductSortKey = {
  id: number
  featured: boolean
  sortOrder: number
  /** Epoch ms of the first publish, or null. */
  publishedAt: number | null
  priceUsd: number | null
  name: string
}

export function productSortKey(row: PublicProductRow): ProductSortKey {
  return {
    id: row.id,
    featured: row.featured,
    sortOrder: row.sortOrder,
    publishedAt: row.publishedAt ? row.publishedAt.getTime() : null,
    priceUsd: publicPriceUsd(row),
    name: displayName(row),
  }
}

const time = (t: number | null) => t ?? 0

/** Default order: featured first, then sortOrder ascending, then most recently published; id breaks ties. */
function byDefault(a: ProductSortKey, b: ProductSortKey): number {
  return (
    Number(b.featured) - Number(a.featured) ||
    a.sortOrder - b.sortOrder ||
    time(b.publishedAt) - time(a.publishedAt) ||
    a.id - b.id
  )
}

function compare(sort: PublicProductSort): (a: ProductSortKey, b: ProductSortKey) => number {
  switch (sort) {
    case 'newest':
      return (a, b) => time(b.publishedAt) - time(a.publishedAt) || byDefault(a, b)
    case 'price-asc':
    case 'price-desc': {
      const dir = sort === 'price-asc' ? 1 : -1
      // Products without a public price go last, in the default order, so the
      // order never hints at a hidden price.
      return (a, b) => {
        if (a.priceUsd === null || b.priceUsd === null) {
          return Number(a.priceUsd === null) - Number(b.priceUsd === null) || byDefault(a, b)
        }
        return (a.priceUsd - b.priceUsd) * dir || byDefault(a, b)
      }
    }
    case 'name':
      return (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || byDefault(a, b)
    default:
      return byDefault
  }
}

/** Sorted copy. */
export function sortProducts<T extends { sort: ProductSortKey }>(items: readonly T[], sort: PublicProductSort = 'featured'): T[] {
  const cmp = compare(sort)
  return [...items].sort((a, b) => cmp(a.sort, b.sort))
}

/** Page >= 1 and 1 <= pageSize <= MAX_PAGE_SIZE, as integers. */
export function normalisePaging(input: { page?: number; pageSize?: number }): { page: number; pageSize: number } {
  const int = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback)
  const page = Math.max(1, int(input.page, 1))
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, int(input.pageSize, DEFAULT_PAGE_SIZE)))
  return { page, pageSize }
}
