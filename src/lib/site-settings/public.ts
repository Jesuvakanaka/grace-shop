// ZP-486: public read of the site settings for the storefront. SERVER ONLY
// (imports Prisma). The `server-only` package is not a dependency, so this is
// enforced by convention: import it from server components / route handlers.
//
//   const settings = await getPublicSiteSettings()
//   const link = buildWhatsAppLink(settings, { product, url })
import { unstable_cache } from 'next/cache'
import type { PrismaClient } from '@prisma/client'
import prisma from '@/lib/db'
import { readSiteSettings } from './db'
import { toPublicSiteSettings, type PublicSiteSettings } from './dto'
import { STOREFRONT_TAGS } from '@/lib/storefront/cache-tags'
import { SITE_SETTINGS_TAG } from './revalidate'

export type { PublicSiteSettings } from './dto'
export { buildWhatsAppLink } from './whatsapp'

/** Uncached: read the row and build the public DTO. */
export async function loadPublicSiteSettings(db: PrismaClient = prisma): Promise<PublicSiteSettings> {
  return toPublicSiteSettings(await readSiteSettings(db))
}

/**
 * Time-based backstop. revalidateTag only clears the cache of the instance
 * that handled the PUT, and Cloud Run runs up to 2 instances, each with its
 * own cache. Every instance therefore re-reads the settings at most 60 s
 * after a save: "the storefront reflects it within a minute".
 */
export const PUBLIC_SETTINGS_REVALIDATE_SECONDS = 60
export const PUBLIC_SETTINGS_CACHE_OPTIONS = Object.freeze({
  // "storefront" too: revalidateStorefront() with no scope clears every storefront entry.
  tags: [STOREFRONT_TAGS.all, SITE_SETTINGS_TAG],
  revalidate: PUBLIC_SETTINGS_REVALIDATE_SECONDS,
})

/**
 * Cached with the tag `storefront:settings` (PUT /api/website/settings
 * revalidates it on the instance that handled it) and a 60 s backstop for the
 * other instances. The project does not enable Cache Components, so this uses
 * unstable_cache rather than 'use cache' + cacheTag.
 */
export const getPublicSiteSettings: () => Promise<PublicSiteSettings> = unstable_cache(
  () => loadPublicSiteSettings(),
  ['site-settings:public:v1'],
  { tags: [...PUBLIC_SETTINGS_CACHE_OPTIONS.tags], revalidate: PUBLIC_SETTINGS_CACHE_OPTIONS.revalidate },
)
