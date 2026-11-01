// ZP-514: one view. The old storefront pages fold into the flip feed and
// keep their addresses: /shop and /new show the feed on New in,
// /collections the feed with the collections sheet open, /collections/<slug>
// the feed on that collection, /about and /visit the feed with the menu open
// on that section. Pure; safe on the client and server. Tested in
// tests/storefront-one-view.test.ts. See docs/storefront/feed.md.
import type { OpeningHours } from '@/lib/site-settings/schema'
import { FEED_NEW_TAB, FEED_TAB_PARAM } from './feed'
import { SHEET_PARAM } from './feed-sheet'
import { addressLines, meaningfulText } from './visit-model'
import { FEED_GUIDE_PARAM } from './feed-guide'

/** What opens over the feed: the collections sheet, or the menu on About / Visit us. */
export const FEED_OVERLAYS = ['collections', 'about', 'visit'] as const
export type FeedOverlay = (typeof FEED_OVERLAYS)[number]

/** The query parameter of an overlay opened by an address (`/?o=about`), like the details sheet's `?d=`. */
export const OVERLAY_PARAM = 'o'

export type FoldedRoute =
  | { route: 'shop' }
  | { route: 'new' }
  | { route: 'collections' }
  | { route: 'collection'; slug: string }
  | { route: 'about' }
  | { route: 'visit' }

/** The feed state an old address lands on. */
export function routeLanding(r: FoldedRoute): { tab: string; overlay: FeedOverlay | null } {
  switch (r.route) {
    case 'collection':
      return { tab: r.slug, overlay: null }
    case 'collections':
    case 'about':
    case 'visit':
      return { tab: FEED_NEW_TAB, overlay: r.route }
    default:
      return { tab: FEED_NEW_TAB, overlay: null }
  }
}

/**
 * The overlay `?o=` opens, or null. Review F3: never together with the guide
 * replay (`?guide=1`): the guide wins and the overlay is not opened.
 */
export function overlayFromSearch(search: string): FeedOverlay | null {
  const params = new URLSearchParams(search)
  if (params.get(FEED_GUIDE_PARAM) === '1') return null
  const value = params.get(OVERLAY_PARAM)
  return (FEED_OVERLAYS as readonly string[]).includes(value ?? '') ? (value as FeedOverlay) : null
}

/** The URL without `?o=` (other parameters and the hash kept). */
export function withoutOverlay(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search)
  params.delete(OVERLAY_PARAM)
  const query = params.toString()
  return `${pathname}${query ? `?${query}` : ''}${hash}`
}

/**
 * How an overlay opened by `?o=` leaves the URL when it closes. Review F1: when
 * it closes because a link inside it is followed, `o` is removed in place
 * ("replace") so the link's own navigation wins (a history.back() would race
 * it and win); a close control pops our entry when the feed entry is behind it.
 */
export function overlayClose(input: { cause: 'link' | 'control'; entryBehind: boolean }): 'back' | 'replace' {
  return input.cause === 'control' && input.entryBehind ? 'back' : 'replace'
}

/** The history state of an overlay entry we push (Next.js keeps it next to its own). */
export function overlayHistoryState(overlay: FeedOverlay): { vyraOverlay: FeedOverlay } {
  return { vyraOverlay: overlay }
}

export function isOwnOverlayEntry(state: unknown, overlay: FeedOverlay): boolean {
  return typeof state === 'object' && state !== null && (state as { vyraOverlay?: unknown }).vyraOverlay === overlay
}

/** Query parameters of the old pages that mean nothing to the feed. */
const DROPPED = [FEED_TAB_PARAM, SHEET_PARAM, OVERLAY_PARAM, 'preview', 'sort', 'page', 'size', 'colour', 'available']

/**
 * The history a folded address writes after hydration: its entry becomes
 * the feed URL (`<home>`, `?c=<tab>` for a collection; campaign parameters
 * kept), and with an overlay the overlay entry (`…?o=<overlay>`) is pushed
 * on top, so closing the menu or sheet, or back, leaves the visitor on the
 * feed instead of leaving the site.
 */
export function oneViewHistory(input: {
  homePath: string
  search: string
  tab: string
  overlay: FeedOverlay | null
}): { replace: string; push: string | null } {
  const params = new URLSearchParams(input.search)
  for (const k of DROPPED) params.delete(k)
  if (input.tab !== FEED_NEW_TAB) params.set(FEED_TAB_PARAM, input.tab)
  const base = params.toString()
  const replace = `${input.homePath}${base ? `?${base}` : ''}`
  if (!input.overlay) return { replace, push: null }
  params.set(OVERLAY_PARAM, input.overlay)
  return { replace, push: `${input.homePath}?${params.toString()}` }
}

// --------------------------------------------------------- LocalBusiness

const DAY_NAMES: Record<keyof OpeningHours, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

/**
 * Visit us's schema.org store (ClothingStore, a LocalBusiness): name, URL,
 * telephone, address, geo and opening hours (open days, consecutive days
 * with the same hours grouped). Parts without data are left out; null when
 * there is no address, phone, location or hours at all.
 */
export function localBusinessJsonLd(input: {
  url: string | null
  phone: string | null
  visit: { address: string | null; hours: OpeningHours | null; latitude: number | null; longitude: number | null }
}): Record<string, unknown> | null {
  const address = addressLines(input.visit.address)
  // Review F4: placeholders ("TBC") never reach the JSON-LD.
  const phone = meaningfulText(input.phone)
  const hasGeo = input.visit.latitude !== null && input.visit.longitude !== null
  const specs: { dayOfWeek: string[]; opens: string; closes: string }[] = []
  if (input.visit.hours) {
    for (const day of Object.keys(DAY_NAMES) as (keyof OpeningHours)[]) {
      const h = input.visit.hours[day]
      if (!h || h.closed) continue
      const last = specs[specs.length - 1]
      if (last && last.opens === h.open && last.closes === h.close && last.dayOfWeek.at(-1) === DAY_NAMES[prevDay(day)]) {
        last.dayOfWeek.push(DAY_NAMES[day])
      } else {
        specs.push({ dayOfWeek: [DAY_NAMES[day]], opens: h.open, closes: h.close })
      }
    }
  }
  if (address.length === 0 && !phone && !hasGeo && specs.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'ClothingStore',
    name: 'VYRA',
    ...(input.url ? { url: input.url } : {}),
    ...(phone ? { telephone: phone } : {}),
    ...(address.length > 0 ? { address: { '@type': 'PostalAddress', streetAddress: address.join(', ') } } : {}),
    ...(hasGeo ? { geo: { '@type': 'GeoCoordinates', latitude: input.visit.latitude, longitude: input.visit.longitude } } : {}),
    ...(specs.length > 0 ? { openingHoursSpecification: specs.map((s) => ({ '@type': 'OpeningHoursSpecification', ...s })) } : {}),
  }
}

function prevDay(day: keyof OpeningHours): keyof OpeningHours {
  const order = Object.keys(DAY_NAMES) as (keyof OpeningHours)[]
  return order[(order.indexOf(day) + order.length - 1) % order.length]
}
