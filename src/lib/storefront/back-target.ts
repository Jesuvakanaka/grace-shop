// ZP-503: where the product page's back button goes. Pure; safe on the client
// and server. Tested in tests/storefront-menu-product.test.ts.
//
// The button is a real link to the landing feed at this look
// (`/#look-<slug>`, the feed opens on that slide). When the visitor came from
// the feed, a click uses history.back() instead, so the feed comes back with
// its collection, loaded looks and position as they left it.
import { lookAnchorId } from './feed'

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/** `pathname` is the landing page (`homeHref` is "/" or "/site"), ignoring a trailing slash. */
export function isHomePath(pathname: string, homeHref: string): boolean {
  return trimSlash(pathname) === trimSlash(homeHref)
}

/** The landing feed at this look. */
export function feedLookHref(homeHref: string, slug: string): string {
  return `${homeHref}#${lookAnchorId(slug)}`
}

export type BackInput = {
  /** The previous pathname of an in-app (client) navigation; null on the first page of a load. */
  previousPath: string | null
  /** document.referrer ("" when none). */
  referrer: string
  /** location.origin. */
  origin: string
  homeHref: string
  /** history.length. */
  historyLength: number
}

/** True: history.back() returns to the feed. False: follow the feed link. */
export function shouldGoBack(input: BackInput): boolean {
  if (input.historyLength <= 1) return false
  if (input.previousPath !== null) return isHomePath(input.previousPath, input.homeHref)
  if (!input.referrer) return false
  let url: URL
  try {
    url = new URL(input.referrer)
  } catch {
    return false
  }
  return url.origin === input.origin && isHomePath(url.pathname, input.homeHref)
}
