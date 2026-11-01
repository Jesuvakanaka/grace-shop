// ZP-490: product page routing decisions. Pure (dependencies are injected),
// so it is safe in the proxy, the page and the unit tests.
//
// decideProductRoute: what /p/<slug> shows.
//   1. invalid slug                      -> not-found (no lookup at all)
//   2. public product                    -> product   (a preview token is ignored)
//   3. old slug of a public product      -> redirect  (permanent, to the current slug)
//   4. not public + a preview token that verifies for exactly this product
//                                        -> preview   (owner only; banner, noindex, no-store)
//   5. anything else                     -> not-found (unpublished, unknown, wrong/expired token)
import { isValidSlug } from '@/lib/storefront-model/slug'
import { STOREFRONT_PREFIX } from '@/lib/host-routing'
import type { PublishedProductResult } from './catalogue'
import type { PublicProduct } from './dto'
import { SITE_ROUTES, sitePath } from './paths'

export type ProductRouteDecision =
  | { kind: 'product'; product: PublicProduct }
  | { kind: 'preview'; product: PublicProduct }
  | { kind: 'redirect'; slug: string }
  | { kind: 'not-found' }

export type PreviewCandidate = { productId: number; product: PublicProduct }

export type ProductRouteDeps = {
  /** The cached public lookup (getPublishedProductBySlug). */
  lookupPublished(slug: string): Promise<PublishedProductResult>
  /** Uncached: any product with this current slug, as a DTO plus its id. Only called with a token. */
  loadPreviewCandidate(slug: string): Promise<PreviewCandidate | null>
  /** verifyPreviewTokenFor from src/lib/website/preview-token.ts. */
  verifyPreviewTokenFor(token: string, productId: number): Promise<boolean>
}

export async function decideProductRoute(
  input: { slug: string; previewToken: string | null },
  deps: ProductRouteDeps,
): Promise<ProductRouteDecision> {
  if (!isValidSlug(input.slug)) return { kind: 'not-found' }

  const published = await deps.lookupPublished(input.slug)
  if (published && 'product' in published) return { kind: 'product', product: published.product }
  if (published && 'redirectTo' in published) return { kind: 'redirect', slug: published.redirectTo }

  if (!input.previewToken) return { kind: 'not-found' }
  const candidate = await deps.loadPreviewCandidate(input.slug)
  if (!candidate) return { kind: 'not-found' }
  if (!(await deps.verifyPreviewTokenFor(input.previewToken, candidate.productId))) return { kind: 'not-found' }
  return { kind: 'preview', product: candidate.product }
}

/** Longer than any token we issue (about 150 characters); anything bigger is not ours. */
const MAX_TOKEN_LENGTH = 2048

/** The `preview` search parameter as a token: exactly one non-empty, reasonably short value. */
export function previewTokenFrom(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value === '' || value.length > MAX_TOKEN_LENGTH) return null
  return value
}

// ─── Preview responses ──────────────────────────────────────────────────────

/**
 * Sent by src/proxy.ts on every product URL that carries `?preview=`, valid
 * or not: the token must never reach another site through the Referer header
 * (WhatsApp, image hosts) or land in a shared cache. A page component cannot
 * set response headers in Next 16, so the proxy does it.
 */
export const PREVIEW_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
})

const PRODUCT_PATH = new RegExp(`^(?:${STOREFRONT_PREFIX})?/p/[^/]+/?$`)

/** A product page URL (admin `/site/p/x` or storefront `/p/x`) with a `preview` parameter. */
export function isProductPreviewRequest(pathname: string, searchParams: URLSearchParams): boolean {
  return searchParams.has('preview') && PRODUCT_PATH.test(pathname)
}

// ─── Absolute product URL (for the enquiry message and Share) ───────────────

/** host[:port]: DNS name or IPv4, or a bracketed IPv6 address; port 1-65535. */
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/
const LOCAL = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$|\.localhost(?::\d+)?$/

function cleanHost(host: string | null | undefined): string | null {
  const h = (host ?? '').trim().toLowerCase()
  const m = HOST.exec(h)
  if (!m) return null
  if (m[1] !== undefined) {
    const port = Number(m[1])
    if (port < 1 || port > 65535) return null
  }
  return h
}

/**
 * The public URL of a product page, or null.
 *
 * - A configured storefront host (GRACE_STOREFRONT_HOSTS, first entry) is the
 *   public origin: `https://<host>/p/<slug>`.
 * - Otherwise (UAT) the request's Host header, validated as a plain host[:port]:
 *   `https://<host>/site/p/<slug>` (http for localhost). X-Forwarded-Host and
 *   X-Forwarded-Proto are never read.
 * - Anything malformed gives null, and the enquiry message simply leaves the
 *   URL out.
 */
export function productAbsoluteUrl(input: {
  slug: string
  storefrontHosts: readonly string[]
  host: string | null | undefined
}): string | null {
  if (!isValidSlug(input.slug)) return null
  const path = SITE_ROUTES.product(input.slug)
  const configured = input.storefrontHosts.map(cleanHost).find((h): h is string => h !== null)
  if (configured) return `https://${configured}${sitePath('', path)}`
  const host = cleanHost(input.host)
  if (!host) return null
  return `${LOCAL.test(host) ? 'http' : 'https'}://${host}${sitePath(STOREFRONT_PREFIX, path)}`
}
