// Query allow-list for GET /api/public/products (ZP-484). Pure.
// Only these parameters are accepted, each at most once; anything else is a 400.
import { isValidSlug } from '@/lib/storefront-model'
import { isPublicProductSort, MAX_PAGE_SIZE, PUBLIC_PRODUCT_SORTS, type PublicProductSort } from './listing'

export type PublicProductsQuery = {
  categorySlug?: string
  newOnly?: boolean
  featuredOnly?: boolean
  hideSoldOut?: boolean
  sort: PublicProductSort
  page: number
  pageSize: number
}

export const PUBLIC_PRODUCTS_PARAMS = ['category', 'new', 'featured', 'hideSoldOut', 'sort', 'page', 'pageSize'] as const

const MAX_PAGE = 1000

function flag(value: string): boolean | null {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return null
}

function int(value: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(value)) return null
  const n = Number(value)
  return n >= min && n <= max ? n : null
}

export function parsePublicProductsQuery(
  params: URLSearchParams,
): { ok: true; options: PublicProductsQuery } | { ok: false; error: string } {
  const allowed = new Set<string>(PUBLIC_PRODUCTS_PARAMS)
  const seen = new Set<string>()
  for (const name of params.keys()) {
    if (!allowed.has(name)) return { ok: false, error: `Unknown parameter "${name.slice(0, 40)}"` }
    if (seen.has(name)) return { ok: false, error: `Repeated parameter "${name}"` }
    seen.add(name)
  }
  const options: PublicProductsQuery = { sort: 'featured', page: 1, pageSize: 24 }

  const category = params.get('category')
  if (category !== null) {
    if (!isValidSlug(category)) return { ok: false, error: 'Invalid category' }
    options.categorySlug = category
  }
  const flags = [
    ['new', 'newOnly'],
    ['featured', 'featuredOnly'],
    ['hideSoldOut', 'hideSoldOut'],
  ] as const
  for (const [param, key] of flags) {
    const raw = params.get(param)
    if (raw === null) continue
    const value = flag(raw)
    if (value === null) return { ok: false, error: `"${param}" must be 1, 0, true or false` }
    if (value) options[key] = true
  }
  const sort = params.get('sort')
  if (sort !== null) {
    if (!isPublicProductSort(sort)) return { ok: false, error: `"sort" must be one of ${PUBLIC_PRODUCT_SORTS.join(', ')}` }
    options.sort = sort
  }
  const page = params.get('page')
  if (page !== null) {
    const n = int(page, 1, MAX_PAGE)
    if (n === null) return { ok: false, error: `"page" must be 1-${MAX_PAGE}` }
    options.page = n
  }
  const pageSize = params.get('pageSize')
  if (pageSize !== null) {
    const n = int(pageSize, 1, MAX_PAGE_SIZE)
    if (n === null) return { ok: false, error: `"pageSize" must be 1-${MAX_PAGE_SIZE}` }
    options.pageSize = n
  }
  return { ok: true, options }
}
