// ZP-486: storefront cache invalidation after the owner saves site settings.
//
// TODO(consolidate): ZP-484 builds revalidation helpers in src/lib/storefront/*
// and ZP-483 may add src/lib/website/revalidate.ts. This module calls Next's
// revalidateTag directly to avoid editing their files; fold it into the shared
// helper once both have landed. The tag names must match theirs.
import { revalidateTag } from 'next/cache'

export const SITE_SETTINGS_TAG = 'storefront:settings'
export const STOREFRONT_HOME_TAG = 'storefront:home'
export const SITE_SETTINGS_REVALIDATE_TAGS = Object.freeze([SITE_SETTINGS_TAG, STOREFRONT_HOME_TAG] as const)

type Revalidate = (tag: string, profile: { expire: number }) => void

/**
 * Expire the settings and home caches immediately ({ expire: 0 }), so the next
 * storefront request shows the owner's change. Never throws: the settings are
 * already saved, and a failed invalidation only delays the change. Outside a
 * Next.js request (tests, scripts) revalidateTag throws an invariant error,
 * which is reported as { ok: false }.
 */
export function revalidateSiteSettings(revalidate: Revalidate = revalidateTag): { ok: true } | { ok: false; error: string } {
  try {
    for (const tag of SITE_SETTINGS_REVALIDATE_TAGS) revalidate(tag, { expire: 0 })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[site-settings] storefront revalidation failed:', message)
    return { ok: false, error: message }
  }
}
