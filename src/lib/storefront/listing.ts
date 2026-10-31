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

type SortRow = Pick<
  PublicProductRow,
  'id' | 'featured' | 'sortOrder' | 'publishedAt' | 'priceDisplay' | 'sellingPriceUsd' | 'productName' | 'publicName'
>

const time = (d: Date | null) => (d ? d.getTime() : 0)

/** Default order: featured first, then sortOrder ascending, then most recently published; id breaks ties. */
function byDefault(a: SortRow, b: SortRow): number {
  return (
    Number(b.featured) - Number(a.featured) ||
    a.sortOrder - b.sortOrder ||
    time(b.publishedAt) - time(a.publishedAt) ||
    a.id - b.id
  )
}

/**
 * Sort rows for a public list. Price sorts only use prices that are public
 * (publicPriceUsd); products without a public price go last, in the default
 * order, so the order never hints at a hidden price.
 */
export function sortProductRows<T extends SortRow>(rows: readonly T[], sort: PublicProductSort = 'featured'): T[] {
  const sorted = [...rows]
  switch (sort) {
    case 'newest':
      return sorted.sort((a, b) => time(b.publishedAt) - time(a.publishedAt) || byDefault(a, b))
    case 'price-asc':
    case 'price-desc': {
      const dir = sort === 'price-asc' ? 1 : -1
      return sorted.sort((a, b) => {
        const pa = publicPriceUsd(a)
        const pb = publicPriceUsd(b)
        if (pa === null || pb === null) return Number(pa === null) - Number(pb === null) || byDefault(a, b)
        return (pa - pb) * dir || byDefault(a, b)
      })
    }
    case 'name':
      return sorted.sort(
        (a, b) => displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base' }) || byDefault(a, b),
      )
    default:
      return sorted.sort(byDefault)
  }
}

/** Page >= 1 and 1 <= pageSize <= MAX_PAGE_SIZE, as integers. */
export function normalisePaging(input: { page?: number; pageSize?: number }): { page: number; pageSize: number } {
  const int = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback)
  const page = Math.max(1, int(input.page, 1))
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, int(input.pageSize, DEFAULT_PAGE_SIZE)))
  return { page, pageSize }
}
