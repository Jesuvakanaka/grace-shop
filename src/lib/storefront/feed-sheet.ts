// ZP-510: the feed's details bottom sheet, pure parts. Safe on the client and server.
//
// Tapping Details (rail), the caption or the photo of a look opens a bottom
// sheet over it instead of navigating to /p/<slug>. This module holds the
// rules: the URL / history entry (`?d=<slug>`), the sheet mechanics (height,
// drag-to-close, the "More" pill), the lazily loaded extras DTO and the
// content model. UI: src/components/storefront/feed/DetailsSheet.tsx; data:
// ./feed-sheet-data.ts (server) and ./feed-sheet-actions.ts (server action).
// Tested in tests/storefront-feed-sheet.test.ts. See docs/storefront/feed.md.
import { SHEET_CLOSE_REASONS } from '@/lib/analytics/events'
import {
  formatAverage,
  ratingLabel,
  ratingSummaryText,
  relativeDate,
  shopRatingLine,
  starsText,
  type RatingSummary,
} from '@/lib/reviews/aggregate'
import type { WhatsAppContactSettings } from '@/lib/site-settings/whatsapp'
import { isValidSlug } from '@/lib/storefront-model/slug'
import type { Availability } from '@/lib/storefront-model/rules'
import type { PublicProduct, PublicReview } from './dto'
import type { FeedItem } from './feed'
import type { StoreVisit } from './menu-model'
import { ENQUIRE_LABEL, RESTOCK_LABEL, splitOptions } from './product-enquiry'

export { SHEET_CLOSE_REASONS }
export type SheetCloseReason = (typeof SHEET_CLOSE_REASONS)[number]

/** The query parameter that holds the open sheet's slug (`/?d=linen-dress`). */
export const SHEET_PARAM = 'd'
/** The sheet is at most this share of the visible viewport, so the top of the look stays visible. */
export const SHEET_MAX_HEIGHT_RATIO = 0.62
/** Dragging the handle down further than this closes the sheet. */
export const SHEET_DRAG_CLOSE_PX = 90
/** "More" shows until the inner scroll is this close to its end. */
export const SHEET_MORE_SLACK_PX = 24
/** The "More" pill scrolls this share of the visible height. */
export const SHEET_SCROLL_RATIO = 0.7
/** Approved reviews shown in the sheet; the rest are on the full page. */
export const SHEET_TOP_REVIEWS = 2
/** The anchor of the reviews section on the product page. */
export const SHEET_REVIEWS_ANCHOR = 'reviews'
export const VISIT_LABEL = 'Visit us'

// ------------------------------------------------------------------- URL

/** The slug in `?d=`, when it is a valid slug; else null. */
export function sheetSlugFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(SHEET_PARAM)
  return isValidSlug(value) ? value : null
}

/** The URL with `?d=<slug>` set (or removed for null); other parameters and the hash kept. */
export function sheetLocation(pathname: string, search: string, hash: string, slug: string | null): string {
  const params = new URLSearchParams(search)
  if (slug) params.set(SHEET_PARAM, slug)
  else params.delete(SHEET_PARAM)
  const query = params.toString()
  return `${pathname}${query ? `?${query}` : ''}${hash}`
}

/**
 * A page opened with `?d=<slug>` (a shared or reloaded link): replace the
 * entry with the feed without `d`, then push the sheet entry, so the browser
 * / Android back button closes the sheet instead of leaving the site.
 * Null when there is no valid `d`.
 */
export function landingSheetHistory(
  pathname: string,
  search: string,
  hash: string,
): { slug: string; replace: string; push: string } | null {
  const slug = sheetSlugFromSearch(search)
  if (!slug) return null
  return { slug, replace: sheetLocation(pathname, search, hash, null), push: sheetLocation(pathname, search, hash, slug) }
}

/**
 * The history state of the sheet entry we push (Next.js keeps custom state
 * next to its own). Coming back to it (browser back from the full page)
 * needs no landing replace + push: the feed entry is already behind it.
 */
export function sheetHistoryState(slug: string): { vyraSheet: string } {
  return { vyraSheet: slug }
}

export function isOwnSheetEntry(state: unknown, slug: string): boolean {
  return typeof state === 'object' && state !== null && (state as { vyraSheet?: unknown }).vyraSheet === slug
}

/**
 * How a close from the sheet's own controls leaves the URL: "back" (the
 * pushed sheet entry is popped, so back / forward stay clean) when the feed
 * entry is behind it, else "replace" (`d` removed in place).
 */
export function sheetCloseMethod(entryBehind: boolean): 'back' | 'replace' {
  return entryBehind ? 'back' : 'replace'
}

/** The close reason once `d` has left the URL: the control that started it, else the browser back button. */
export function sheetCloseReason(pending: SheetCloseReason | null): SheetCloseReason {
  return pending ?? 'back'
}

// ------------------------------------------------------------- mechanics

/**
 * The sheet's max height in px: 62% of what is on screen (visualViewport,
 * or innerHeight while pinch-zoomed or without it), so bottom toolbars and
 * the on-screen keyboard never push it over the top of the look. Null when
 * nothing is known (the CSS max-height applies).
 */
export function sheetMaxHeight(input: { innerHeight: number; visualHeight: number | null; visualScale: number }): number | null {
  const zoomed = Math.abs(input.visualScale - 1) > 0.01
  const visible = input.visualHeight && input.visualHeight > 0 && !zoomed ? input.visualHeight : input.innerHeight
  return visible > 0 ? Math.round(visible * SHEET_MAX_HEIGHT_RATIO) : null
}

/** How far the handle is dragged down (never up). */
export function sheetDragOffset(startY: number, y: number): number {
  return Math.max(0, y - startY)
}

export function sheetDragCloses(offset: number): boolean {
  return offset > SHEET_DRAG_CLOSE_PX
}

/** Content continues below the inner scroll (show the bottom fade and the "More" pill). */
export function sheetHasMore(el: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
  return el.scrollTop + el.clientHeight < el.scrollHeight - SHEET_MORE_SLACK_PX
}

export function sheetScrollStep(clientHeight: number): number {
  return Math.round(Math.max(0, clientHeight) * SHEET_SCROLL_RATIO)
}

/** A plain primary click (no modifier): it opens the sheet; other clicks keep the link's default (new tab). */
export function isPlainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}

// ---------------------------------------------------------------- extras

/** An approved review as the sheet shows it: formatted on the server, never its photo (details only). */
export type SheetReview = {
  stars: number
  starsText: string
  starsLabel: string
  comment: string
  name: string
  /** "2 weeks ago" */
  date: string
  /** ISO, for <time dateTime>. */
  dateTime: string
  reply: string | null
}

/**
 * What the sheet loads once per slug on top of the slide's FeedItem.
 * Public fields only: never the item number, stock, the phone number or a
 * review photo.
 */
export type SheetExtras = {
  slug: string
  description: string | null
  colours: string[]
  sizes: string[]
  /** ZP-504: the public enquiry ref ("V-0099"). */
  ref: string | null
  availability: Availability
  /** The WhatsApp fields of the public site settings (the message names the chosen size). */
  contacts: WhatsAppContactSettings
  reviews: { summary: RatingSummary | null; top: SheetReview[]; shop: RatingSummary | null }
  /** "Try it on in store"; null hides the row. */
  visit: StoreVisit | null
}

export function toSheetReview(r: PublicReview, now: Date): SheetReview {
  return {
    stars: r.stars,
    starsText: starsText(r.stars),
    starsLabel: `${r.stars} out of 5 stars`,
    comment: r.comment,
    name: r.name,
    date: relativeDate(r.date, now),
    dateTime: r.date,
    reply: r.reply,
  }
}

export function buildSheetExtras(
  p: PublicProduct,
  ctx: {
    contacts: WhatsAppContactSettings
    /** The piece's entry of the reviews index (display order), or null. */
    reviews: { summary: RatingSummary; reviews: PublicReview[] } | null
    shop: RatingSummary | null
    visit: StoreVisit | null
    now: Date
  },
): SheetExtras {
  const description = p.description?.trim() ? p.description : null
  return {
    slug: p.slug,
    description,
    colours: splitOptions(p.colours),
    sizes: splitOptions(p.sizes),
    ref: p.ref ?? null,
    availability: p.availability,
    // Copied field by field: the settings object also holds the phone number.
    contacts: {
      whatsappNumber: ctx.contacts.whatsappNumber,
      enquiryTemplate: ctx.contacts.enquiryTemplate,
      generalEnquiryMessage: ctx.contacts.generalEnquiryMessage,
    },
    reviews: {
      summary: ctx.reviews?.summary ?? null,
      top: (ctx.reviews?.reviews ?? []).slice(0, SHEET_TOP_REVIEWS).map((r) => toSheetReview(r, ctx.now)),
      shop: ctx.shop,
    },
    visit: ctx.visit,
  }
}

// ----------------------------------------------------------------- model

export type SheetPrimary = { kind: 'enquire' | 'restock' | 'visit'; label: string }

export type SheetModel = {
  /** Stars (null until the extras arrive), the visible line and its accessible label; null without reviews. */
  rating: { stars: string | null; text: string; label: string } | null
  primary: SheetPrimary
  fullPageHref: string
  /** "See all N reviews" to the full page's reviews, when there are more than the sheet shows. */
  seeAll: { text: string; href: string } | null
  shopRating: { text: string; label: string } | null
  /** The reviews block shows (a piece or shop rating exists). */
  showReviews: boolean
}

export function sheetModel(item: FeedItem, extras: SheetExtras | null): SheetModel {
  const summary = extras?.reviews.summary ?? null
  const shop = extras?.reviews.shop ?? null
  const rating = summary
    ? { stars: starsText(summary.average), text: ratingSummaryText(summary), label: ratingLabel(summary) }
    : !extras && item.rating
      ? { stars: null, text: item.rating.text, label: item.rating.label }
      : null
  const primary: SheetPrimary = !item.enquireHref
    ? { kind: 'visit', label: VISIT_LABEL }
    : item.soldOut
      ? { kind: 'restock', label: RESTOCK_LABEL }
      : { kind: 'enquire', label: ENQUIRE_LABEL }
  const shown = extras ? extras.reviews.top.length : 0
  return {
    rating,
    primary,
    fullPageHref: item.href,
    seeAll:
      summary && summary.count > Math.max(shown, SHEET_TOP_REVIEWS)
        ? { text: `See all ${summary.count} reviews`, href: `${item.href}#${SHEET_REVIEWS_ANCHOR}` }
        : null,
    shopRating: shop ? { text: `VYRA shop rating ${formatAverage(shop.average)} ★`, label: shopRatingLine(shop) as string } : null,
    showReviews: Boolean(summary || shop),
  }
}
