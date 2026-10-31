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
import { SITE_SETTINGS_TAG } from './revalidate'

export type { PublicSiteSettings } from './dto'
export { buildWhatsAppLink } from './whatsapp'

/** Uncached: read the row and build the public DTO. */
export async function loadPublicSiteSettings(db: PrismaClient = prisma): Promise<PublicSiteSettings> {
  return toPublicSiteSettings(await readSiteSettings(db))
}

/**
 * Cached with the tag `storefront:settings`; PUT /api/website/settings
 * revalidates it. The project does not enable Cache Components, so this uses
 * unstable_cache rather than 'use cache' + cacheTag.
 */
export const getPublicSiteSettings: () => Promise<PublicSiteSettings> = unstable_cache(
  () => loadPublicSiteSettings(),
  ['site-settings:public:v1'],
  { tags: [SITE_SETTINGS_TAG] },
)
