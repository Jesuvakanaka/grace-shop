// ZP-500: data for the flip-feed landing page. Server only.
//
// Only the existing cached reads: the public catalogue (listPublishedProducts,
// answered in memory from the one cached entry), the published categories and
// the public site settings, plus (ZP-506) the cached feed ranking. No
// per-visitor database query. Ordering, tabs and paging are the pure functions in ./feed.ts.
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
import { getFeedRanking, getReviewsIndex, listPublishedCategories, listPublishedProducts, type PublicProduct } from './index'
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

/**
 * The ordered feed and its tabs, once per request (React cache). ZP-506: the
 * order is the nightly popularity ranking (cached entry `getFeedRanking`;
 * newest first with "Newest first" or too little data). The ranks are for
 * the day, so the order is stable all day and the same for every visitor.
 */
const feedSource = cache(async (): Promise<{ ordered: PublicProduct[]; tabs: FeedTab[] }> => {
  const [products, categories, ranking] = await Promise.all([newestFirst(), listPublishedCategories(), getFeedRanking()])
  const ordered = feedProducts(products, ranking)
  return { ordered, tabs: feedTabs(categories, ordered) }
})

/** ZP-513: every feed piece in feed (ranking) order, for the details card's "You may also like". */
export async function orderedFeedPieces(): Promise<PublicProduct[]> {
  return (await feedSource()).ordered
}

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

/**
 * ZP-512: the slide of one piece outside a feed load (a /p/<slug> look
 * further down than one load reaches, or an owner preview of an unpublished
 * piece, which has no Share link: it is not public yet).
 */
export async function feedItemFor(product: PublicProduct, options: { preview: boolean }): Promise<FeedItem> {
  const [settings, base, h, reviews] = await Promise.all([getPublicSiteSettings(), getSiteBase(), headers(), getReviewsIndex()])
  const storefrontHosts = hostRoutingConfigFromEnv().storefrontHosts
  const host = h.get('host')
  const item = toFeedItem(product, {
    base,
    contacts: settings.contacts,
    productUrl: (slug: string) => productAbsoluteUrl({ slug, storefrontHosts, host }),
    rating: (slug: string) => (options.preview ? null : (reviews.products[slug]?.summary ?? null)),
  })
  return options.preview ? { ...item, shareUrl: null } : item
}
