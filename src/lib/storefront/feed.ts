// ZP-500: the flip-feed landing page, pure parts. Safe on the client and server.
//
// The landing page (/, /site on UAT) is a vertical feed: one published piece
// per full-screen slide. This module decides the order, the collection tabs,
// the paging and what one slide shows, from public DTOs only. Data loading is
// in ./feed-data.ts (server), the UI in src/components/storefront/feed/*.
// Tested in tests/storefront-feed.test.ts. See docs/storefront/feed.md.
import { ASK_FOR_PRICE, formatPriceUsd } from '@/components/storefront/product'
import { buildWhatsAppLink, type WhatsAppContactSettings } from '@/lib/site-settings/whatsapp'
import { isValidSlug } from '@/lib/storefront-model/slug'
import type { PublicCategory, PublicProduct } from './dto'
import { SITE_ROUTES, sitePath, type SiteBase } from './paths'
import { productEnquiryHref } from './product-enquiry'

/** Pieces rendered on the server; "load more" fetches this many at a time. */
export const FEED_PAGE_SIZE = 12
/** Upper bound for one load (also the "load through" result is a whole number of pages). */
export const FEED_MAX_PAGE_SIZE = 48
/**
 * Most pieces one "load through a remembered slide" may return (8 pages).
 * A slide further down than that is not restored; the feed opens at the
 * first slide of the load instead.
 */
export const FEED_MAX_THROUGH = 96
/** The first tab: every published piece. */
export const FEED_NEW_TAB = 'new'
export const FEED_NEW_TAB_LABEL = 'New in'
/** The query parameter that holds the tab (`/?c=dresses`). */
export const FEED_TAB_PARAM = 'c'

/**
 * The WhatsApp message for a sold-out piece ("Restock" on the rail). Filled in
 * by buildWhatsAppLink like the owner's enquiry template ({product}, {url};
 * the "({url})" part is dropped when the URL is unknown).
 */
export const RESTOCK_TEMPLATE = 'Hi VYRA, please let me know when the {product} is back in stock. ({url})'

// ------------------------------------------------------------------ order

/**
 * Feed order. `newestFirst` must be newest published first (the catalogue's
 * "newest" sort). Result: available featured pieces, then the other available
 * pieces, then sold-out pieces (featured first there too); the input order is
 * kept inside each group. Returns a new array.
 */
export function orderFeed<T extends Pick<PublicProduct, 'featured' | 'availability'>>(newestFirst: readonly T[]): T[] {
  const rank = (p: T) => (p.availability === 'SOLD_OUT' ? 2 : 0) + (p.featured ? 0 : 1)
  return newestFirst
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((e) => e.p)
}

/** The feed is photo-first: pieces without a photo are left out, the rest in feed order. */
export function feedProducts<T extends Pick<PublicProduct, 'featured' | 'availability' | 'images'>>(newestFirst: readonly T[]): T[] {
  return orderFeed(newestFirst.filter((p) => p.images.length > 0))
}

// ------------------------------------------------------------------- tabs

/** A collection of the feed: New in or a category, with its number of looks (for the collections sheet). */
export type FeedTab = { id: string; label: string; count: number }

/** "New in", then one tab per published category (display order) that has at least one piece. */
export function feedTabs(
  categories: readonly Pick<PublicCategory, 'slug' | 'name'>[],
  products: readonly Pick<PublicProduct, 'category'>[],
): FeedTab[] {
  const counts = new Map<string, number>()
  for (const p of products) counts.set(p.category.slug, (counts.get(p.category.slug) ?? 0) + 1)
  return [
    { id: FEED_NEW_TAB, label: FEED_NEW_TAB_LABEL, count: products.length },
    ...categories
      .filter((c) => counts.has(c.slug))
      .map((c) => ({ id: c.slug, label: c.name, count: counts.get(c.slug) as number })),
  ]
}

/** "1 look", "12 looks". */
export function looksLabel(count: number): string {
  return `${count} ${count === 1 ? 'look' : 'looks'}`
}

// ------------------------------------------------- details (clean view)

/**
 * sessionStorage key for the visitor's "Show details" choice. The feed opens
 * in clean view (photos only); the choice then holds for every slide while
 * browsing, so coming back from a product page keeps it.
 */
export const FEED_DETAILS_STORAGE_KEY = 'vyra:feed:details'

/** The stored value: only exactly "shown" means details are shown. */
export function parseDetailsPreference(raw: string | null | undefined): boolean {
  return raw === 'shown'
}

export function detailsPreferenceValue(shown: boolean): 'shown' | 'hidden' {
  return shown ? 'shown' : 'hidden'
}

/** The tab for a `?c=` value: a known tab id, else New in. */
export function resolveFeedTab(raw: unknown, tabs: readonly FeedTab[]): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value === '') return FEED_NEW_TAB
  return tabs.some((t) => t.id === value) ? value : FEED_NEW_TAB
}

/** The pieces of one tab, in feed order. New in is every piece. */
export function filterFeed<T extends Pick<PublicProduct, 'category'>>(ordered: readonly T[], tab: string): T[] {
  if (tab === FEED_NEW_TAB) return [...ordered]
  return ordered.filter((p) => p.category.slug === tab)
}

// ----------------------------------------------------------------- paging

export type FeedPage<T> = {
  items: T[]
  /** Offset of the next load, or null when this was the last page. */
  nextOffset: number | null
  total: number
}

/**
 * One load of the feed. `offset` and `limit` are clamped to whole numbers
 * (offset >= 0, 1 <= limit <= FEED_MAX_PAGE_SIZE). With `through` (a slug the
 * visitor was on, e.g. after browser back), the load is extended by whole
 * pages until it includes that slug; an unknown slug changes nothing.
 */
export function feedPage<T extends { slug: string }>(
  items: readonly T[],
  options: { offset?: number; limit?: number; through?: string | null },
): FeedPage<T> {
  const int = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback)
  const offset = Math.max(0, int(options.offset, 0))
  const limit = Math.min(FEED_MAX_PAGE_SIZE, Math.max(1, int(options.limit, FEED_PAGE_SIZE)))
  let end = offset + limit
  if (options.through) {
    const at = items.findIndex((p) => p.slug === options.through)
    if (at >= end) end = Math.min(offset + FEED_MAX_THROUGH, offset + Math.ceil((at + 1 - offset) / limit) * limit)
  }
  const slice = items.slice(offset, end)
  return { items: slice, nextOffset: end < items.length ? end : null, total: items.length }
}

/** The index of the full-height slide under `scrollTop` (nearest), clamped to 0..count-1. */
export function slideIndexAt(scrollTop: number, slideHeight: number, count: number): number {
  if (!(slideHeight > 0) || count <= 0) return 0
  return Math.min(count - 1, Math.max(0, Math.round(scrollTop / slideHeight)))
}

// ------------------------------------------------------------------ slide

export type FeedBadge = { kind: 'sold-out' | 'few-left' | 'new'; label: string }

/** Sold out, else Few left, else New, else no tag. */
export function feedBadge(p: Pick<PublicProduct, 'availability' | 'isNew'>): FeedBadge | null {
  if (p.availability === 'SOLD_OUT') return { kind: 'sold-out', label: 'Sold out' }
  if (p.availability === 'FEW_LEFT') return { kind: 'few-left', label: 'Few left' }
  if (p.isNew) return { kind: 'new', label: 'New' }
  return null
}

export type FeedImage = { src: string; srcSet: string; alt: string }

/** What one slide shows. Built only from the public product DTO; sent to the browser. */
export type FeedItem = {
  slug: string
  name: string
  /** Category name ("Dresses"). */
  category: string
  /** "$65", or "Ask for price". */
  price: string
  badge: FeedBadge | null
  soldOut: boolean
  /** Primary photo first. */
  images: FeedImage[]
  /** The product page for this host (/p/<slug> or /site/p/<slug>). */
  href: string
  /** Absolute public product URL for Share, or null. */
  shareUrl: string | null
  /** wa.me link (enquiry, or the restock message when sold out); null when no WhatsApp number is set. */
  enquireHref: string | null
}

export type FeedItemContext = {
  base: SiteBase
  contacts: WhatsAppContactSettings
  /** Absolute public product URL (productAbsoluteUrl), or null. */
  productUrl: (slug: string) => string | null
}

export function toFeedItem(p: PublicProduct, ctx: FeedItemContext): FeedItem {
  const soldOut = p.availability === 'SOLD_OUT'
  const url = ctx.productUrl(p.slug)
  const enquireHref = soldOut
    ? buildWhatsAppLink({ contacts: { ...ctx.contacts, enquiryTemplate: RESTOCK_TEMPLATE } }, { product: p.name, url })
    : productEnquiryHref({ contacts: ctx.contacts }, { name: p.name, url })
  return {
    slug: p.slug,
    name: p.name,
    category: p.category.name,
    price: formatPriceUsd(p.priceUsd) ?? ASK_FOR_PRICE,
    badge: feedBadge(p),
    soldOut,
    images: p.images.map((i) => ({ src: i.url, srcSet: i.srcSet, alt: i.alt })),
    href: sitePath(ctx.base, SITE_ROUTES.product(p.slug)),
    shareUrl: url,
    enquireHref,
  }
}

// -------------------------------------------------------------- URL state

const LOOK_PREFIX = 'look-'

/** The id of a slide (`look-<slug>`), so `/#look-<slug>` opens on that piece. */
export function lookAnchorId(slug: string): string {
  return `${LOOK_PREFIX}${slug}`
}

/** The slug in a `#look-<slug>` hash, or null. */
export function parseLookHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  if (!h.startsWith(LOOK_PREFIX)) return null
  const slug = h.slice(LOOK_PREFIX.length)
  return isValidSlug(slug) ? slug : null
}

/**
 * The feed's URL for a tab and slide: `?c=<tab>` (none for New in, other
 * query parameters kept) and `#look-<slug>` (none for the first slide).
 */
export function feedLocation(pathname: string, search: string, tab: string, slug: string | null): string {
  const params = new URLSearchParams(search)
  if (tab === FEED_NEW_TAB) params.delete(FEED_TAB_PARAM)
  else params.set(FEED_TAB_PARAM, tab)
  const query = params.toString()
  return `${pathname}${query ? `?${query}` : ''}${slug ? `#${lookAnchorId(slug)}` : ''}`
}
