// ZP-512: /p/<slug> (/site/p/<slug> on UAT) no longer has its own page: it
// renders the flip feed on that look with the details sheet open, exactly
// like `/?d=<slug>`. Pure; safe on the client and server. Tested in
// tests/storefront-product-landing.test.ts. See docs/storefront/feed.md.
import { STOREFRONT_PREFIX } from '@/lib/host-routing'
import { lookAnchorId } from './feed'
import { SHEET_PARAM } from './feed-sheet'

/** The URL segment of the product route under the storefront layout. */
export const PRODUCT_SEGMENT = 'p'

/**
 * The full-screen feed frame (no header / footer): the home page (segment
 * null on a home path) and the product route (segment "p", whatever the
 * address bar says after the landing rewrote it). A 404 renders with
 * segment null on its own path, so it keeps the header.
 */
export function isFeedFrame(input: { segment: string | null; pathname: string }): boolean {
  if (input.segment === PRODUCT_SEGMENT) return true
  return input.segment === null && (input.pathname === STOREFRONT_PREFIX || input.pathname === '/')
}

/**
 * The history entries a /p/<slug> landing writes (after hydration): the
 * feed on that look (`<home>#look-<slug>`) replaces the /p/<slug> entry and
 * the sheet entry (`<home>?d=<slug>#look-<slug>`) goes on top, so closing
 * or back leaves the visitor on that look in the feed. Campaign parameters
 * are kept; `preview` and any old `d` are dropped.
 */
export function productLandingHistory(input: { homePath: string; search: string; slug: string }): { replace: string; push: string } {
  const params = new URLSearchParams(input.search)
  params.delete('preview')
  params.delete(SHEET_PARAM)
  const hash = `#${lookAnchorId(input.slug)}`
  const base = params.toString()
  params.set(SHEET_PARAM, input.slug)
  return {
    replace: `${input.homePath}${base ? `?${base}` : ''}${hash}`,
    push: `${input.homePath}?${params.toString()}${hash}`,
  }
}

/**
 * The first load of a /p/<slug> feed (loaded through the look) with the
 * landing look in it: unchanged when it is there, else first (a look
 * further down than one load reaches).
 */
export function withLandingItem<T extends { slug: string }>(items: readonly T[], landing: T): T[] {
  return items.some((p) => p.slug === landing.slug) ? [...items] : [landing, ...items]
}
