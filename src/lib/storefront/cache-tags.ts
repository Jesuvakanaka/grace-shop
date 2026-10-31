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
} as const

export const storefrontProductTag = (slug: string) => `storefront:product:${slug}`
export const storefrontCategoryTag = (slug: string) => `storefront:category:${slug}`

export type RevalidateScope = {
  /** Products that changed. Pass the old AND the new slug after a slug change. */
  productSlugs?: readonly string[]
  /** Categories that changed (name, description, hero, published, order). */
  categorySlugs?: readonly string[]
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
  }
  const unique = [...new Set(tags)]
  for (const tag of unique) deps.revalidateTag(tag, { expire: 0 })
  return unique
}
