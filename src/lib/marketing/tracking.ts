// VYRA Marketing hub (ZP-1200): per-post tracking tags and links. Pure apart from randomness.
// The tag must survive the analytics normalizeTag unchanged (lowercase [a-z0-9-], <= 40 chars).
import { randomBytes } from 'node:crypto'
import { STOREFRONT_PREFIX } from '@/lib/host-routing'
import { SITE_ROUTES } from '@/lib/storefront/paths'
import { absoluteSiteUrl, primaryStorefrontHost } from '@/lib/storefront/public-url'
import { productAbsoluteUrl } from '@/lib/storefront/product-route'

export const TRACKING_TAG = /^mk[a-z0-9]{6,36}$/

/** "mk" + 12 hex characters, e.g. mk3f9a1c07be42. */
export function generateTrackingTag(): string {
  return `mk${randomBytes(6).toString('hex')}`
}

export interface LinkInput {
  /** The product's storefront slug; null links to the home page. */
  slug: string | null
  trackingTag: string
  storefrontHosts: readonly string[]
  host: string | null | undefined
}

/** The absolute landing link with ?src=<tag>, or null when no site URL can be built. */
export function buildTrackedLink(input: LinkInput): string | null {
  let url: string | null = null
  if (input.slug) url = productAbsoluteUrl({ slug: input.slug, storefrontHosts: input.storefrontHosts, host: input.host })
  if (!url) {
    url = absoluteSiteUrl({
      base: primaryStorefrontHost(input.storefrontHosts) ? '' : STOREFRONT_PREFIX,
      path: SITE_ROUTES.home,
      storefrontHosts: input.storefrontHosts,
      host: input.host,
    })
  }
  return url ? `${url}${url.includes('?') ? '&' : '?'}src=${encodeURIComponent(input.trackingTag)}` : null
}
