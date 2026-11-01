// ZP-500: data for the flip-feed landing page. Server only.
//
// Only the existing cached reads: the public catalogue (listPublishedProducts,
// answered in memory from the one cached entry), the published categories and
// the public site settings. No new cache entries and no per-visitor database
// query. Ordering, tabs and paging are the pure functions in ./feed.ts.
import 'server-only'
import { headers } from 'next/headers'
import { cache } from 'react'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import { getPublicSiteSettings } from '@/lib/site-settings/public'
import { MAX_PAGE_SIZE } from './listing'
import {
  feedPage,
  feedProducts,
  feedTabs,
  filterFeed,
  resolveFeedTab,
  toFeedItem,
  type FeedItem,
  type FeedPage,
  type FeedTab,
} from './feed'
import { getReviewsIndex, listPublishedCategories, listPublishedProducts, type PublicProduct } from './index'
import { productAbsoluteUrl } from './product-route'
import { getSiteBase } from './site-base'

/** Every public piece, newest published first, from the cached catalogue. */
async function newestFirst(): Promise<PublicProduct[]> {
  const all: PublicProduct[] = []
  for (let page = 1; ; page++) {
    const result = await listPublishedProducts({ sort: 'newest', page, pageSize: MAX_PAGE_SIZE })
    all.push(...result.items)
    if (page >= result.pageCount) return all
  }
}

/** The ordered feed and its tabs, once per request (React cache). */
const feedSource = cache(async (): Promise<{ ordered: PublicProduct[]; tabs: FeedTab[] }> => {
  const [products, categories] = await Promise.all([newestFirst(), listPublishedCategories()])
  const ordered = feedProducts(products)
  return { ordered, tabs: feedTabs(categories, ordered) }
})

export type FeedLoad = { tab: string; tabs: FeedTab[]; page: FeedPage<FeedItem> }

/**
 * One load of the feed for a tab (`raw` is the ?c= value; unknown means New
 * in). `through` extends the load to a remembered slide.
 */
export async function loadFeed(input: { tab: unknown; offset?: number; limit?: number; through?: string | null }): Promise<FeedLoad> {
  const [{ ordered, tabs }, settings, base, h, reviews] = await Promise.all([
    feedSource(),
    getPublicSiteSettings(),
    getSiteBase(),
    headers(),
    getReviewsIndex(), // ZP-508: cached entry; "★ 4.8 (12)" in the caption
  ])
  const tab = resolveFeedTab(input.tab, tabs)
  const storefrontHosts = hostRoutingConfigFromEnv().storefrontHosts
  const host = h.get('host')
  const page = feedPage(filterFeed(ordered, tab), input)
  const ctx = {
    base,
    contacts: settings.contacts,
    productUrl: (slug: string) => productAbsoluteUrl({ slug, storefrontHosts, host }),
    rating: (slug: string) => reviews.products[slug]?.summary ?? null,
  }
  return { tab, tabs, page: { ...page, items: page.items.map((p) => toFeedItem(p, ctx)) } }
}
