// Storefront revalidation for admin writes (ZP-483; consolidated in Phase 1).
// Server only.
//
// The tags and scope rules live in ONE place: revalidateStorefront in
// src/lib/storefront/cache-tags.ts (ZP-484). This module only adds the
// never-throwing wrapper the admin routes need: the change is already
// committed, so a failed revalidation must not turn it into an error.
// Imported from cache-tags directly (not '@/lib/storefront', which imports
// 'server-only' and Prisma) so it stays cheap to load in route handlers and tests.
import { revalidateTag } from 'next/cache'
import { revalidateStorefront as expireStorefrontTags, type RevalidateScope } from '@/lib/storefront/cache-tags'

export {
  STOREFRONT_TAGS,
  storefrontProductTag,
  storefrontCategoryTag,
  type RevalidateScope,
} from '@/lib/storefront/cache-tags'

type RevalidateTagFn = (tag: string, profile: { expire: number }) => void

/** Outside a Next request (unit tests, scripts) there is nothing to revalidate. */
const OUTSIDE_REQUEST = 'static generation store missing'

/** The tags revalidateStorefront expires for this scope (no side effects). */
export function storefrontTagsFor(scope?: RevalidateScope): string[] {
  return expireStorefrontTags(scope, { revalidateTag: () => {} })
}

/**
 * Expire storefront cache entries; never throws. Each tag is tried on its
 * own. The "outside a request" invariant error is ignored; any other error is
 * logged and its tag listed in `failed`.
 */
export function revalidateStorefrontSafely(
  scope?: RevalidateScope,
  revalidate: RevalidateTagFn = revalidateTag,
): { tags: string[]; failed: string[] } {
  const failed: string[] = []
  const tags = expireStorefrontTags(scope, {
    revalidateTag: (tag, profile) => {
      try {
        revalidate(tag, profile)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes(OUTSIDE_REQUEST)) return
        failed.push(tag)
        console.error('[storefront] revalidate failed:', tag, message)
      }
    },
  })
  return { tags, failed }
}

/** Expire storefront cache entries after a successful admin change. Never throws. Returns the tags. */
export function revalidateStorefront(scope?: RevalidateScope): string[] {
  return revalidateStorefrontSafely(scope).tags
}
