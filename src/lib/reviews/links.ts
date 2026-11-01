// ZP-508: the review link the owner sends, and its WhatsApp message. Pure.
//
// "Send on WhatsApp" opens wa.me WITHOUT a number: the owner picks the
// customer's chat in WhatsApp, so the site never stores a phone number.
import { STOREFRONT_PREFIX } from '@/lib/host-routing'
import { absoluteSiteUrl, primaryStorefrontHost } from '@/lib/storefront/public-url'
import { SITE_ROUTES } from '@/lib/storefront/paths'
import { isWellFormedReviewTokenShape } from './token-shape'

/**
 * The absolute review URL: the public storefront host when one is configured
 * (https://vyra.../review/<token>), else this host's /site/review/<token>
 * (UAT, local). Null when no URL can be built.
 */
export function reviewAbsoluteUrl(input: {
  token: string
  storefrontHosts: readonly string[]
  host: string | null | undefined
}): string | null {
  if (!isWellFormedReviewTokenShape(input.token)) return null
  const base = primaryStorefrontHost(input.storefrontHosts) ? '' : STOREFRONT_PREFIX
  return absoluteSiteUrl({ base, path: SITE_ROUTES.review(input.token), storefrontHosts: input.storefrontHosts, host: input.host })
}

/** The ready thank-you message with the link. */
export function reviewInviteMessage(input: { firstName: string | null; pieceName: string | null; url: string }): string {
  const hi = input.firstName ? `Hi ${input.firstName}, ` : 'Hi, '
  const what = input.pieceName ? `your ${input.pieceName}` : 'your visit to VYRA'
  return (
    `${hi}thank you for shopping with VYRA! We would love to hear what you think of ${what}. ` +
    `It takes a minute, and this link is just for you (it works once, for 30 days): ${input.url}`
  )
}

/** wa.me link with the message and no recipient number. */
export function reviewWhatsAppHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
