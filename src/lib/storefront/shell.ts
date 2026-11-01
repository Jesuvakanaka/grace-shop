// ZP-487: the data every storefront page's shell needs. Server only.
//
// Built only on the existing cached reads: getPublicSiteSettings() (one
// unstable_cache entry) and listPublishedCategories() (one unstable_cache
// entry, ZP-484). No new uncached database call per request. React cache()
// dedupes it within one render, so the layout, a page and not-found can all
// call it.
import 'server-only'
import { cache } from 'react'
import { getPublicSiteSettings, type PublicSiteSettings } from '@/lib/site-settings/public'
import { listPublishedCategories, type PublicCategory } from './index'
import { buildShellModel, type ShellModel } from './shell-model'
import { getSiteBase } from './site-base'

export type ShellData = ShellModel & {
  /** The full public settings (contacts, visit, social, about, home, seo). */
  settings: PublicSiteSettings
  /** Published categories in display order. */
  categories: PublicCategory[]
}

export const getShellData = cache(async (): Promise<ShellData> => {
  const [settings, categories, base] = await Promise.all([
    getPublicSiteSettings(),
    listPublishedCategories(),
    getSiteBase(),
  ])
  return { ...buildShellModel({ settings, categories, base }), settings, categories }
})
