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
import { chartForSizes, type SizeChartRow } from '@/lib/storefront-model/size-chart'
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
/** Approved reviews shown when the sheet opens; "See all N reviews" shows more inside it. */
export const SHEET_TOP_REVIEWS = 2
/** ZP-512: reviews added per "See all" / "Show more reviews" tap. */
export const SHEET_REVIEWS_STEP = 5
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

const NEXT_STATE_KEYS = new Set(['__NA', '_N', '__PRIVATE_NEXTJS_INTERNALS_TREE'])

/**
 * Our part of a history entry's state (Next.js keys removed), or null. Pass
 * this, never `history.state` itself, to replaceState: Next.js skips its
 * router sync for a state carrying `__NA` (then useSearchParams misses the
 * change and a later router write can drop it). Next copies its keys back.
 */
export function customHistoryState(state: unknown): Record<string, unknown> | null {
  if (typeof state !== 'object' || state === null) return null
  const own = Object.fromEntries(Object.entries(state).filter(([k]) => !NEXT_STATE_KEYS.has(k)))
  return Object.keys(own).length > 0 ? own : null
}

/**
 * What to do with a landing `?d=<slug>`: "push" the sheet entry over the
 * feed (the look is loaded), "keep" (our own entry, the feed is already
 * behind it), "wait" (the look may arrive with a load through it), or
 * "drop" `d` in place (it cannot be in the feed: unknown, unpublished, too far).
 */
export function landingAction(input: { inItems: boolean; loadable: boolean; ownEntry: boolean }): 'push' | 'keep' | 'wait' | 'drop' {
  if (input.inItems) return input.ownEntry ? 'keep' : 'push'
  return input.loadable ? 'wait' : 'drop'
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

/** The "More" pill's text (also its accessible name): only the sections below that exist. */
export function morePillText(sections: { store: boolean; reviews: boolean }): string {
  const parts = [sections.store ? 'store' : null, sections.reviews ? 'reviews' : null].filter(Boolean)
  return parts.length > 0 ? `More: ${parts.join(' & ')}` : 'More'
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
  /** ZP-512: every approved review of the piece (display order, at most MAX_REVIEWS_PER_PIECE); the sheet shows 2, then more on request. */
  reviews: { summary: RatingSummary | null; list: SheetReview[]; shop: RatingSummary | null }
  /** "Try it on in store"; null hides the row. */
  visit: StoreVisit | null
  // ZP-513 details card.
  /** "Model is 1.70 m, wearing M · fits true to size"; null hides it. */
  fit: string | null
  fabric: string | null
  care: string | null
  /** The size guide rows for this piece's sizes (its chart, else the default); null hides "Size guide". */
  sizeChart: SizeChartRow[] | null
  /** Distinct visits that asked about it on WhatsApp in the last 7 days (the social line shows it from 3). */
  asked: number
  /** "How to buy": hold hours (null hides it) and payment methods (null hides "Pay in store"). */
  buying: { holdHours: number | null; paymentMethods: string | null }
  /** Up to 4 available pieces ("You may also like" / "Available now"); a tap goes to that look in the feed. */
  alsoLike: AlsoLikePiece[]
}

/** ZP-513: a "You may also like" piece (public fields only). */
export type AlsoLikePiece = {
  slug: string
  name: string
  /** "$65" or "Ask for price". */
  price: string
  image: { src: string; srcSet: string; alt: string } | null
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
    /** ZP-513 (all optional: an owner preview has none of them). */
    defaultSizeChart?: SizeChartRow[] | null
    buying?: { holdHours: number | null; paymentMethods: string | null }
    asked?: number
    alsoLike?: AlsoLikePiece[]
  },
): SheetExtras {
  const description = p.description?.trim() ? p.description : null
  const sizes = splitOptions(p.sizes)
  return {
    slug: p.slug,
    description,
    colours: splitOptions(p.colours),
    sizes,
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
      list: (ctx.reviews?.reviews ?? []).map((r) => toSheetReview(r, ctx.now)),
      shop: ctx.shop,
    },
    visit: ctx.visit,
    fit: p.fit ?? null,
    fabric: p.fabric ?? null,
    care: p.care ?? null,
    sizeChart: chartForSizes({ piece: p.sizeChart ?? null, fallback: ctx.defaultSizeChart ?? null, sizes }),
    // Review: below SOCIAL_MIN the number never leaves the server (it is only shown from 3).
    asked: publicAsked(ctx.asked ?? 0),
    buying: ctx.buying ?? { holdHours: null, paymentMethods: null },
    alsoLike: ctx.alsoLike ?? [],
  }
}

// ------------------------------------------------------- ZP-513 card model

/** The social line's parts show from this number on (never "1 person asked"). */
export const SOCIAL_MIN = 3

/** The asked count as the public DTO carries it: 0 below SOCIAL_MIN (review). */
function publicAsked(raw: number): number {
  const n = Math.max(0, Math.floor(raw))
  return n >= SOCIAL_MIN ? n : 0
}

/**
 * The colour that goes into the WhatsApp message: the one picked, else a
 * piece's only colour (no picker is shown for one colour, review), else none.
 */
export function chosenColour(input: { colours: readonly string[]; chosen: string | null }): string | null {
  return input.chosen ?? (input.colours.length === 1 ? input.colours[0] : null)
}

/** "Loved by 24 · 6 people asked about it this week"; each part only from 3; null when neither. */
export function socialLine(input: { loves: number; asked: number }): string | null {
  const parts = [
    input.loves >= SOCIAL_MIN ? `Loved by ${input.loves}` : null,
    input.asked >= SOCIAL_MIN ? `${input.asked} people asked about it this week` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

export type HowToBuyCell = { kind: 'reserve' | 'pay' | 'collect'; title: string; text: string | null }

/**
 * The "How to buy" strip: Reserve on WhatsApp (with a WhatsApp number; "We
 * hold it for {h} h" when hold hours are set; sold out: Ask about restock,
 * "We message you when it's back"), Pay in store (payment methods), Collect
 * in store (today's hours). Cells without data are left out; [] hides the strip.
 */
export function howToBuy(input: {
  soldOut: boolean
  hasWhatsApp: boolean
  holdHours: number | null
  paymentMethods: string | null
  todayText: string | null
}): HowToBuyCell[] {
  const cells: HowToBuyCell[] = []
  if (input.hasWhatsApp) {
    cells.push(
      input.soldOut
        ? { kind: 'reserve', title: 'Ask about restock', text: 'We message you when it’s back' }
        : { kind: 'reserve', title: 'Reserve on WhatsApp', text: input.holdHours ? `We hold it for ${input.holdHours} h` : null },
    )
  }
  if (input.paymentMethods) cells.push({ kind: 'pay', title: 'Pay in store', text: input.paymentMethods })
  if (input.todayText) cells.push({ kind: 'collect', title: 'Collect in store', text: input.todayText })
  return cells
}

/**
 * The colour / size heading: a colour picker only with more than one colour;
 * one colour reads "Colour: Olive · Size". `label` is "Size" when there are
 * sizes. Null when the piece has neither.
 */
export function colourSizeLabel(
  colours: readonly string[],
  sizes: readonly string[],
): { picker: boolean; colour: string | null; label: string | null } | null {
  if (colours.length === 0 && sizes.length === 0) return null
  return {
    picker: colours.length > 1,
    colour: colours.length === 1 ? colours[0] : null,
    label: sizes.length > 0 ? 'Size' : null,
  }
}

/** A description longer than this (or over 2 lines) is clamped to 2 lines with "More". */
export const DESCRIPTION_CLAMP_CHARS = 110

/** The toggle under the 2-line description: "More · fabric & care", "More" (long text), or none. */
export function descriptionToggle(input: { description: string | null; fabric: string | null; care: string | null }): string | null {
  if (input.fabric || input.care) return 'More · fabric & care'
  const d = input.description ?? ''
  return d.length > DESCRIPTION_CLAMP_CHARS || d.split('\n').length > 2 ? 'More' : null
}

/** "Try it on: open today 09:00–17:30": today's line, lower-cased after the colon. */
export function tryItOnText(todayText: string | null): string | null {
  if (!todayText) return null
  return todayText.charAt(0).toLowerCase() + todayText.slice(1)
}

/** The also-like row's title: "Available now" on a sold-out piece. */
export function alsoLikeTitle(soldOut: boolean): string {
  return soldOut ? 'Available now' : 'You may also like'
}

export const ALSO_LIKE_MAX = 4

/**
 * "You may also like": up to 4 available (not sold out) pieces, never the
 * current one; same collection first, then the rest; feed (ranking) order
 * inside each group. `ordered` is the feed's order.
 */
export function pickAlsoLike<T extends { slug: string; category: string; soldOut: boolean }>(
  ordered: readonly T[],
  current: { slug: string; category: string },
): T[] {
  const pool = ordered.filter((p) => p.slug !== current.slug && !p.soldOut)
  const same = pool.filter((p) => p.category === current.category)
  const other = pool.filter((p) => p.category !== current.category)
  return [...same, ...other].slice(0, ALSO_LIKE_MAX)
}

// ----------------------------------------------------------------- model

export type SheetPrimary = { kind: 'enquire' | 'restock' | 'visit'; label: string }

export type SheetModel = {
  /** Stars (null until the extras arrive), the visible line and its accessible label; null without reviews. */
  rating: { stars: string | null; text: string; label: string } | null
  primary: SheetPrimary
  shopRating: { text: string; label: string } | null
  /** The reviews block shows (a piece or shop rating exists). */
  showReviews: boolean
}

/**
 * ZP-512: the reviews button under the shown reviews: "See all N reviews"
 * (N = the piece's review count) after the first 2, then "Show more reviews
 * (k)"; each tap shows SHEET_REVIEWS_STEP more. Null when all are shown.
 */
export function reviewsMore(input: { shown: number; total: number; count: number }): { label: string; next: number } | null {
  if (input.shown >= input.total) return null
  const next = Math.min(input.total, input.shown + SHEET_REVIEWS_STEP)
  const label = input.shown <= SHEET_TOP_REVIEWS ? `See all ${input.count} reviews` : `Show more reviews (${input.total - input.shown})`
  return { label, next }
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
  return {
    rating,
    primary,
    shopRating: shop ? { text: `VYRA shop rating ${formatAverage(shop.average)} ★`, label: shopRatingLine(shop) as string } : null,
    showReviews: Boolean(summary || shop),
  }
}
