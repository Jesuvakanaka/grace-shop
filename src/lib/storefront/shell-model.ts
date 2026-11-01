// ZP-487: what the storefront shell (header, footer, privacy page) shows,
// built from the public site settings and the published categories. Pure:
// the data comes in, nothing is fetched here (see ./shell.ts for that).
import type { NavItem, SocialLink } from '@/components/storefront/types'
import { buildWhatsAppLink } from '@/lib/site-settings/whatsapp'
import type { PublicSiteSettings } from '@/lib/site-settings/dto'
import { DAYS, type Day, type OpeningHours } from '@/lib/site-settings/schema'
import type { PublicCategory } from './dto'
import { SITE_ROUTES, sitePath, type SiteBase } from './paths'
import { addressLines, meaningfulText } from './visit-model'

/** The one VYRA tagline (docs/storefront/brand-refinements.md, rule 1). */
export const VYRA_TAGLINE = 'WEAR DIFFERENT.'

export type ShellModel = {
  base: SiteBase
  homeHref: string
  /** Shop · Collections (sub-menu of published categories) · New Arrivals · About · Visit Us. */
  nav: NavItem[]
  /** wa.me link with the general enquiry message; null when no WhatsApp number is set (hide the button). */
  whatsappHref: string | null
  /** Only the profiles that are set, in a fixed order. */
  social: SocialLink[]
  /** Address lines; [] when not set. */
  address: string[]
  /** Grouped opening hours ("Mon–Fri 09:00–17:30"); [] when not set. */
  hours: string[]
  holidayNote: string | null
  phone: string | null
  email: string | null
  tagline: string
}

const SHORT_DAY: Record<Day, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

/** Opening hours as lines, consecutive days with the same hours grouped. [] when not set. */
export function formatOpeningHours(hours: OpeningHours | null): string[] {
  if (!hours) return []
  const describe = (day: Day) => {
    const h = hours[day]
    return h.closed ? 'closed' : `${h.open}–${h.close}`
  }
  const lines: string[] = []
  let start = 0
  for (let i = 1; i <= DAYS.length; i++) {
    if (i < DAYS.length && describe(DAYS[i]) === describe(DAYS[start])) continue
    const from = SHORT_DAY[DAYS[start]]
    const to = SHORT_DAY[DAYS[i - 1]]
    lines.push(`${from === to ? from : `${from}–${to}`} ${describe(DAYS[start])}`)
    start = i
  }
  return lines
}

// The multi-line address as trimmed lines (moved to ./visit-model, ZP-491).
export { splitAddress } from './visit-model'

export function buildShellModel(input: {
  settings: PublicSiteSettings
  categories: readonly PublicCategory[]
  base: SiteBase
}): ShellModel {
  const { settings, categories, base } = input
  const to = (path: string) => sitePath(base, path)

  // ZP-514: only what remains (the menu's fallback without its provider): the feed's
  // collections (New in, then ?c=<slug>), About and Visit us (they open the menu), Privacy.
  const nav: NavItem[] = [
    { label: 'New in', href: to(SITE_ROUTES.home) },
    ...categories.map((c) => ({ label: c.name, href: to(`/?c=${encodeURIComponent(c.slug)}`) })),
    { label: 'About', href: to(SITE_ROUTES.about) },
    { label: 'Visit us', href: to(SITE_ROUTES.visit) },
    { label: 'Privacy', href: to(SITE_ROUTES.privacy) },
  ]

  const social: SocialLink[] = []
  if (settings.social.instagram) social.push({ label: 'VYRA on Instagram', href: settings.social.instagram, icon: 'instagram' })
  if (settings.social.facebook) social.push({ label: 'VYRA on Facebook', href: settings.social.facebook, icon: 'facebook' })
  if (settings.social.tiktok) social.push({ label: 'VYRA on TikTok', href: settings.social.tiktok, icon: 'tiktok' })

  return {
    base,
    homeHref: to(SITE_ROUTES.home),
    nav,
    whatsappHref: buildWhatsAppLink(settings),
    social,
    // Placeholders ("TBC") count as not set (shared with the home page and Visit us).
    address: addressLines(settings.visit.address),
    hours: formatOpeningHours(settings.visit.hours),
    holidayNote: meaningfulText(settings.visit.holidayNote),
    phone: settings.contacts.phone,
    email: settings.contacts.email,
    tagline: VYRA_TAGLINE,
  }
}
