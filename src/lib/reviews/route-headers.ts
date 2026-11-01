// ZP-508: response headers for the one-time review page /review/<token>
// (and /site/review/<token>). Pure. src/proxy.ts adds them, because a page
// cannot set response headers in Next 16. The page's <meta name="referrer">
// says the same; the header also covers subresources and old browsers.
// Note: Cloud Run request logs still contain the path (and so the token);
// see docs/storefront/reviews.md.

export const REVIEW_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
})

/** The review page on either front door (not the API). */
export function isReviewPagePath(pathname: string): boolean {
  return /^(?:\/site)?\/review(?:\/|$)/i.test(pathname)
}
