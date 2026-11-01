// ZP-508: the review token's shape (43 base64url characters). Pure, no
// node:crypto, so client code and links.ts can use it.
export const REVIEW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function isWellFormedReviewTokenShape(token: unknown): token is string {
  return typeof token === 'string' && REVIEW_TOKEN_RE.test(token)
}
