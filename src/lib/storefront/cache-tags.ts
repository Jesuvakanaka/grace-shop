// Cache tags and revalidation for the public data layer (ZP-484).
// The admin (ZP-483) calls revalidateStorefront after publish or edit.
import { revalidateTag } from 'next/cache'
import { isValidSlug } from '@/lib/storefront-model'

export const STOREFRONT_TAGS = {
  /** On every storefront cache entry. */
  all: 'storefront',
  /** On every entry that contains product data (lists, detail, related). */
  products: 'storefront:products',
  /** On every entry that contains category data, including product entries (category name and visibility). */
  categories: 'storefront:categories',
  /** Site settings (getPublicSiteSettings, ZP-486). */
  settings: 'storefront:settings',
  /** Home page entries that embed settings (hero, statement, trust strip). */
  home: 'storefront:home',
} as const

/**
 * Backstop lifetime (seconds) of every storefront cache entry.
 * revalidateTag only clears the Next data cache of the instance that handled
 * the admin request; other Cloud Run instances (UAT runs up to 2) only see
 * the change when their entry expires. 60 s bounds that, any missed
 * revalidation, and how late the derived `isNew` flag can be.
 */
export const STOREFRONT_REVALIDATE_SECONDS = 60

export const storefrontProductTag = (slug: string) => `storefront:product:${slug}`
export const storefrontCategoryTag = (slug: string) => `storefront:category:${slug}`

export type RevalidateScope = {
  /** Products that changed. Pass the old AND the new slug after a slug change. null/invalid slugs are skipped. */
  productSlugs?: readonly (string | null | undefined)[]
  /** Categories that changed (name, description, hero, published, order). */
  categorySlugs?: readonly (string | null | undefined)[]
  /** Site settings changed (ZP-486): `storefront:settings` and `storefront:home`. */
  settings?: boolean
}

type RevalidateDeps = { revalidateTag: (tag: string, profile: { expire: number }) => void }

/**
 * Expire storefront cache entries. Call it from a Route Handler or Server
 * Action after a write, never during render.
 *
 * - No scope: every storefront entry.
 * - productSlugs: every product entry (`storefront:products`, because lists
 *   and related products embed the product) plus each `storefront:product:<slug>`.
 * - categorySlugs: every entry with category data (`storefront:categories`,
 *   which product entries also carry) plus each `storefront:category:<slug>`.
 * - settings: `storefront:settings` and `storefront:home` (ZP-486). A settings
 *   change that alters product DTOs (the few-left threshold) passes no scope.
 *
 * Throws whatever revalidateTag throws (e.g. outside a request); admin routes
 * use the never-throwing wrapper in src/lib/website/revalidate.ts.
 *
 * Uses `{ expire: 0 }`: the next request recomputes instead of being served
 * stale data, so an unpublished product disappears at once. Invalid slugs
 * are skipped. Returns the tags it expired.
 */
export function revalidateStorefront(scope?: RevalidateScope, deps: RevalidateDeps = { revalidateTag }): string[] {
  const tags: string[] = []
  if (!scope) {
    tags.push(STOREFRONT_TAGS.all)
  } else {
    if (scope.productSlugs) {
      tags.push(STOREFRONT_TAGS.products, ...scope.productSlugs.filter(isValidSlug).map(storefrontProductTag))
    }
    if (scope.categorySlugs) {
      tags.push(STOREFRONT_TAGS.categories, ...scope.categorySlugs.filter(isValidSlug).map(storefrontCategoryTag))
    }
    if (scope.settings) tags.push(STOREFRONT_TAGS.settings, STOREFRONT_TAGS.home)
  }
  const unique = [...new Set(tags)]
  for (const tag of unique) deps.revalidateTag(tag, { expire: 0 })
  return unique
}
