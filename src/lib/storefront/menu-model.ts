// ZP-503: what the full-screen menu and the product page's "Try it on in
// store" row show, built from the public site settings and the feed's
// collections. Pure: no fetching, no React; safe on the client and server
// (the menu works out "today" in the browser, when Visit us is opened).
// Every block is null/empty when its data is missing, never "TBC".
// Tested in tests/storefront-menu-product.test.ts.
import { buildWhatsAppLink } from '@/lib/site-settings/whatsapp'
import type { PublicSiteSettings } from '@/lib/site-settings/dto'
import type { OpeningHours } from '@/lib/site-settings/schema'
import type { SocialLink } from '@/components/storefront/types'
import { FEED_NEW_TAB, FEED_TAB_PARAM, looksLabel, type FeedTab } from './feed'
import { FEED_GUIDE_PARAM } from './feed-guide'
import { SITE_ROUTES, sitePath, type SiteBase } from './paths'
import { buildShellModel, formatOpeningHours, VYRA_TAGLINE } from './shell-model'
import { addressLines, dayInTimeZone, directionsLink, meaningfulText, SHOP_TIME_ZONE } from './visit-model'

/** `/?guide=1` replays the first-visit guide on the landing feed (ZP-509 reads and removes it; one constant, from feed-guide). */
export const GUIDE_PARAM = FEED_GUIDE_PARAM

/** Longest About excerpt in the menu, in characters (an ellipsis is added when cut). */
export const ABOUT_EXCERPT_MAX = 180

// ------------------------------------------------------------------ hours

export type TodayLine = { text: string; open: boolean }

/** "Open today 09:00–17:30" or "Closed today", in the shop's time zone; null when no hours are set. */
export function todayLine(hours: OpeningHours | null, now: Date, timeZone: string = SHOP_TIME_ZONE): TodayLine | null {
  if (!hours) return null
  const h = hours[dayInTimeZone(now, timeZone)]
  if (!h || h.closed) return { text: 'Closed today', open: false }
  return { text: `Open today ${h.open}–${h.close}`, open: true }
}

// ------------------------------------------------------------------ about

/** The story's first paragraph, cut at a word to at most ABOUT_EXCERPT_MAX characters; null when not set. */
export function aboutExcerpt(story: string | null | undefined, max: number = ABOUT_EXCERPT_MAX): string | null {
  const first = (story ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => meaningfulText(p.replace(/\s+/g, ' ')))
    .find((p): p is string => p !== null)
  if (!first) return null
  if (first.length <= max) return first
  const cut = first.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`
}

// ------------------------------------------------------------------ visit

export type StoreVisit = {
  /** Raw hours for working out "today" where it is shown; null when not set. */
  hours: OpeningHours | null
  /** The week, consecutive days with the same hours grouped ("Mon–Fri 09:00–17:30"); [] when not set. */
  week: string[]
  /** Address lines, placeholders dropped; [] when not set. */
  address: string[]
  holidayNote: string | null
  /** Google Maps directions; null without coordinates, address or map link. */
  directionsHref: string | null
}

/** The shop's visit details, or null when none is set (hide the block). */
export function buildStoreVisit(settings: PublicSiteSettings): StoreVisit | null {
  const { visit } = settings
  const week = formatOpeningHours(visit.hours)
  const address = addressLines(visit.address)
  const holidayNote = meaningfulText(visit.holidayNote)
  const directionsHref = directionsLink(visit)
  if (week.length === 0 && address.length === 0 && !holidayNote && !directionsHref) return null
  return { hours: week.length > 0 ? visit.hours : null, week, address, holidayNote, directionsHref }
}

// ------------------------------------------------------------------- menu

export type MenuCollection = {
  id: string
  label: string
  href: string
  /** "12 looks"; null when there are none. */
  count: string | null
}

export type MenuModel = {
  homeHref: string
  /** New in (the landing feed), then each published category that has looks (`/?c=<slug>`). */
  collections: MenuCollection[]
  /** About excerpt; null shows "About VYRA" as a plain link to /about. */
  about: string | null
  aboutHref: string
  /** Null shows "Visit us" as a plain link to /visit. */
  visit: StoreVisit | null
  visitHref: string
  /** The landing page with ?guide=1. */
  guideHref: string
  /** General-enquiry wa.me link; null hides the button. */
  whatsappHref: string | null
  social: SocialLink[]
  tagline: string
}

export function buildMenuModel(input: {
  settings: PublicSiteSettings
  /** The feed's collections (feedTabs): New in, then categories with at least one look. */
  tabs: readonly FeedTab[]
  base: SiteBase
}): MenuModel {
  const { settings, tabs, base } = input
  const to = (path: string) => sitePath(base, path)
  const homeHref = to(SITE_ROUTES.home)
  return {
    homeHref,
    collections: tabs.map((t) => ({
      id: t.id,
      label: t.label,
      href: t.id === FEED_NEW_TAB ? homeHref : to(`/?${FEED_TAB_PARAM}=${encodeURIComponent(t.id)}`),
      count: t.count > 0 ? looksLabel(t.count) : null,
    })),
    about: aboutExcerpt(settings.about.story),
    aboutHref: to(SITE_ROUTES.about),
    visit: buildStoreVisit(settings),
    visitHref: to(SITE_ROUTES.visit),
    guideHref: to(`/?${GUIDE_PARAM}=1`),
    whatsappHref: buildWhatsAppLink(settings),
    // Same social list (labels, order) as the header and footer.
    social: buildShellModel({ settings, categories: [], base }).social,
    tagline: VYRA_TAGLINE,
  }
}
