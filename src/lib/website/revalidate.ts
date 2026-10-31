// Storefront cache revalidation shim (ZP-483). Server only.
//
// TODO(ZP-484): ZP-484 adds src/lib/storefront/cache-tags.ts with
// revalidateStorefront(scope). It was not on master when ZP-483 was built, so
// this file mirrors it exactly: the same tag names, the same scope shape and
// `revalidateTag(tag, { expire: 0 })`. Whichever branch merges second replaces
// the body of revalidateStorefront below with a call to the ZP-484 helper
// (keep the try/catch wrapper) and deletes the duplicated tag code.
import { revalidateTag } from 'next/cache'
import { isValidSlug } from '@/lib/storefront-model'

/** Same values as ZP-484's STOREFRONT_TAGS. */
export const STOREFRONT_TAGS = {
  all: 'storefront',
  products: 'storefront:products',
  categories: 'storefront:categories',
} as const

export const storefrontProductTag = (slug: string) => `storefront:product:${slug}`
export const storefrontCategoryTag = (slug: string) => `storefront:category:${slug}`

export type RevalidateScope = {
  /** Products that changed. Pass the old AND the new slug after a slug change. null/invalid slugs are skipped. */
  productSlugs?: readonly (string | null | undefined)[]
  /** Categories that changed. Pass the old AND the new slug after a slug change. */
  categorySlugs?: readonly (string | null | undefined)[]
}

const validSlugs = (slugs: readonly (string | null | undefined)[]) => slugs.filter((s): s is string => isValidSlug(s))

/** The tags ZP-484's revalidateStorefront would expire for this scope. */
export function storefrontTagsFor(scope?: RevalidateScope): string[] {
  const tags: string[] = []
  if (!scope) tags.push(STOREFRONT_TAGS.all)
  else {
    if (scope.productSlugs) tags.push(STOREFRONT_TAGS.products, ...validSlugs(scope.productSlugs).map(storefrontProductTag))
    if (scope.categorySlugs) tags.push(STOREFRONT_TAGS.categories, ...validSlugs(scope.categorySlugs).map(storefrontCategoryTag))
  }
  return [...new Set(tags)]
}

/**
 * Expire storefront cache entries after a successful admin change. Never
 * throws: the change is already committed, and a failed revalidation only
 * delays the public site. Outside a Next request (unit tests, scripts) there
 * is nothing to revalidate, and revalidateTag's "store missing" error is ignored.
 */
export function revalidateStorefront(scope?: RevalidateScope): string[] {
  const tags = storefrontTagsFor(scope)
  for (const tag of tags) {
    try {
      revalidateTag(tag, { expire: 0 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('static generation store missing')) {
        console.error('[website] revalidate failed:', tag, message)
      }
    }
  }
  return tags
}
