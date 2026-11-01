// ZP-503: data for the full-screen menu (layout, every storefront page).
// Server only.
//
// Only existing cached reads: getShellData() (settings + categories) and the
// public catalogue (listPublishedProducts, answered in memory from the one
// cached entry). The "N looks" counts are the feed's own (feedProducts +
// feedTabs), so the menu and the feed's collections sheet always agree.
import 'server-only'
import { cache } from 'react'
import { feedProducts, feedTabs } from './feed'
import { getReviewsIndex, listPublishedProducts, type PublicProduct } from './index'
import { MAX_PAGE_SIZE } from './listing'
import { buildMenuModel, type MenuModel } from './menu-model'
import { getShellData } from './shell'

async function allPublished(): Promise<PublicProduct[]> {
  const all: PublicProduct[] = []
  for (let page = 1; ; page++) {
    const result = await listPublishedProducts({ sort: 'newest', page, pageSize: MAX_PAGE_SIZE })
    all.push(...result.items)
    if (page >= result.pageCount) return all
  }
}

export const getMenuData = cache(async (): Promise<MenuModel> => {
  const [shell, products, reviews] = await Promise.all([getShellData(), allPublished(), getReviewsIndex()])
  const tabs = feedTabs(shell.categories, feedProducts(products))
  // ZP-508: the shop rating box (cached reviews entry).
  return buildMenuModel({ settings: shell.settings, tabs, base: shell.base, shopRating: reviews.shop })
})
