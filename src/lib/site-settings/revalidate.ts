// ZP-486: storefront cache invalidation after the owner saves site settings.
// Uses the one storefront helper (revalidateStorefront in
// src/lib/storefront/cache-tags.ts, through the never-throwing wrapper in
// src/lib/website/revalidate.ts), so the tag names live in one place.
import { revalidateTag } from 'next/cache'
import { STOREFRONT_TAGS, type RevalidateScope } from '@/lib/storefront/cache-tags'
import { revalidateStorefrontSafely } from '@/lib/website/revalidate'
import type { SiteSettingsData } from './schema'

export const SITE_SETTINGS_TAG = STOREFRONT_TAGS.settings
export const STOREFRONT_HOME_TAG = STOREFRONT_TAGS.home
export const SITE_SETTINGS_REVALIDATE_TAGS = Object.freeze([SITE_SETTINGS_TAG, STOREFRONT_HOME_TAG] as const)

type Revalidate = (tag: string, profile: { expire: number }) => void

/**
 * What a save must expire. The few-left threshold is baked into every product
 * DTO in the cached catalogue, so changing it expires the whole storefront
 * (no scope). Anything else only touches the settings and home entries.
 */
export function settingsRevalidateScope(before: SiteSettingsData, after: SiteSettingsData): RevalidateScope | undefined {
  return before.fewLeftThreshold !== after.fewLeftThreshold ? undefined : { settings: true }
}

/**
 * Expire the storefront entries for `scope` immediately ({ expire: 0 }).
 * Never throws: the settings are already saved. Outside a Next request the
 * "store missing" error is ignored; any other failure gives ok: false.
 */
export function revalidateSiteSettings(
  scope: RevalidateScope | undefined,
  revalidate: Revalidate = revalidateTag,
): { ok: boolean; tags: string[] } {
  const { tags, failed } = revalidateStorefrontSafely(scope, revalidate)
  return { ok: failed.length === 0, tags }
}
