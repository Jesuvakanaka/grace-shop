// ZP-489: the listing pages (/shop, /collections/<slug>, /new). Pure.
//
// The URL query (?sort=newest&soldout=hide&page=2) is parsed leniently: any
// invalid value falls back to its default, so a hand-edited URL never 500s.
// Filtering, sorting and paging run in memory over the ONE cached catalogue
// (listPublishedProducts in ./cached), so no request adds a cache entry or a
// database query. See docs/storefront/collections.md.
import { isValidSlug } from '@/lib/storefront-model'
import type { CatalogueListOptions, PublicProductPage } from './catalogue'
import type { PublicCategory } from './dto'
import type { SiteBase } from './paths'

export const LISTING_PAGE_SIZE = 24

/** The sorts the pages offer (the data layer also has "name", not offered here). */
export const LISTING_SORTS = ['featured', 'newest', 'price-asc', 'price-desc'] as const
export type ListingSort = (typeof LISTING_SORTS)[number]

const SORT_LABELS: Record<ListingSort, string> = {
  featured: 'Featured',
  newest: 'Newest',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
}

export type ListingQuery = { sort: ListingSort; hideSoldOut: boolean; page: number }

export const DEFAULT_LISTING_QUERY: Readonly<ListingQuery> = Object.freeze({ sort: 'featured', hideSoldOut: false, page: 1 })

/** Pages beyond this are treated as page 1 (and then redirected if out of range). */
const MAX_PAGE = 1000

/** Next's page `searchParams` value, or URLSearchParams. */
export type ListingSearchParams = Record<string, string | string[] | undefined> | URLSearchParams

function first(params: ListingSearchParams, name: string): string | null {
  if (params instanceof URLSearchParams) return params.get(name)
  const v = params[name]
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : null
  return typeof v === 'string' ? v : null
}

function isListingSort(value: string | null): value is ListingSort {
  return value !== null && (LISTING_SORTS as readonly string[]).includes(value)
}

/** Lenient: unknown parameters are ignored, invalid values become the default. */
export function parseListingQuery(params: ListingSearchParams): ListingQuery {
  const sort = first(params, 'sort')
  const page = first(params, 'page')
  const n = page !== null && /^[1-9]\d{0,3}$/.test(page) ? Number(page) : 1
  return {
    sort: isListingSort(sort) ? sort : 'featured',
    hideSoldOut: first(params, 'soldout') === 'hide',
    page: n <= MAX_PAGE ? n : 1,
  }
}

/** `path` plus the non-default query values, in a fixed order (sort, soldout, page). */
export function listingHref(path: string, query: Partial<ListingQuery>): string {
  const q = new URLSearchParams()
  if (query.sort && query.sort !== 'featured') q.set('sort', query.sort)
  if (query.hideSoldOut) q.set('soldout', 'hide')
  if (query.page && query.page > 1) q.set('page', String(query.page))
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

const isPriceSort = (sort: ListingSort) => sort === 'price-asc' || sort === 'price-desc'

/** Price sorts only when every product in view shows a price (otherwise the order would hint at hidden prices). */
export function sortOptionsFor(allPriced: boolean): { label: string; value: ListingSort }[] {
  return LISTING_SORTS.filter((s) => allPriced || !isPriceSort(s)).map((value) => ({ label: SORT_LABELS[value], value }))
}

export function effectiveSort(sort: ListingSort, allPriced: boolean): ListingSort {
  return isPriceSort(sort) && !allPriced ? 'featured' : sort
}

/**
 * Out-of-range pages redirect to the last page (or page 1 when the list is
 * empty), so an old "page=3" link still lands somewhere useful after
 * products sell or are unpublished.
 */
export function resolvePage(requested: number, pageCount: number): { page: number; redirectTo: number | null } {
  const last = Math.max(1, pageCount)
  return requested > last ? { page: last, redirectTo: last } : { page: requested, redirectTo: null }
}

/** Page numbers to link: first, last, current ±1, with 'gap' between runs. */
export function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const keep = new Set([1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount))
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push('gap')
    out.push(n)
  })
  return out
}

const HOST = /^[a-z0-9.-]+(?::\d{1,5})?$|^\[[0-9a-f:.]+\](?::\d{1,5})?$/i

/** "https://host" from the request Host and X-Forwarded-Proto headers, or null for a missing or odd host. */
export function requestOrigin(host: string | null | undefined, forwardedProto: string | null | undefined): string | null {
  const h = host?.trim()
  if (!h || !HOST.test(h)) return null
  const proto = forwardedProto?.split(',')[0]?.trim().toLowerCase()
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h)
  const scheme = proto === 'http' || proto === 'https' ? proto : local ? 'http' : 'https'
  return `${scheme}://${h}`
}

/** The canonical URL of a listing: never carries sort, filter or page. Relative when the origin is unknown. */
export function canonicalUrl(origin: string | null, base: SiteBase, route: string): string {
  const path = route.split(/[?#]/)[0] || '/'
  const full = base === '' ? path : `${base}${path === '/' ? '' : path}`
  return origin ? `${origin}${full}` : full
}

export type ListingScope = { kind: 'all' } | { kind: 'new' } | { kind: 'category'; slug: string }

/** The part of the public data layer a listing needs (src/lib/storefront). */
export type ListingSource = {
  listPublishedProducts(options?: CatalogueListOptions): Promise<PublicProductPage>
  getPublishedCategory(slug: string): Promise<PublicCategory | null>
}

export type ListingResult =
  | { kind: 'notFound' }
  | { kind: 'redirect'; to: string }
  | {
      kind: 'ok'
      category: PublicCategory | null
      page: PublicProductPage
      /** The query actually applied (a price sort falls back to featured when a price is hidden). */
      query: ListingQuery
      allPriced: boolean
      sortOptions: { label: string; value: ListingSort }[]
    }

/**
 * Everything a listing page needs. `path` is this page's link (already
 * through sitePath), used for the out-of-range redirect.
 * - category scope: unknown or unpublished slug -> notFound (there are no
 *   category slug redirects in the data model).
 * - page past the end -> redirect to the last page, keeping sort and filter.
 */
export async function loadListing(
  source: ListingSource,
  scope: ListingScope,
  query: ListingQuery,
  path: string,
): Promise<ListingResult> {
  let category: PublicCategory | null = null
  if (scope.kind === 'category') {
    if (!isValidSlug(scope.slug)) return { kind: 'notFound' }
    category = await source.getPublishedCategory(scope.slug)
    if (!category) return { kind: 'notFound' }
  }
  const options = (sort: ListingSort, page: number): CatalogueListOptions => ({
    categorySlug: category?.slug,
    newOnly: scope.kind === 'new' || undefined,
    hideSoldOut: query.hideSoldOut || undefined,
    sort,
    page,
    pageSize: LISTING_PAGE_SIZE,
  })

  let page = await source.listPublishedProducts(options(query.sort, query.page))
  const sort = effectiveSort(query.sort, page.allPriced)
  const { redirectTo } = resolvePage(query.page, page.pageCount)
  if (redirectTo !== null) {
    return { kind: 'redirect', to: listingHref(path, { sort, hideSoldOut: query.hideSoldOut, page: redirectTo }) }
  }
  if (sort !== query.sort) page = await source.listPublishedProducts(options(sort, query.page))

  return {
    kind: 'ok',
    category,
    page,
    query: { ...query, sort },
    allPriced: page.allPriced,
    sortOptions: sortOptionsFor(page.allPriced),
  }
}
