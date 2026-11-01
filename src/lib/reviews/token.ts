// ZP-508: the one-time review link token. Server only (node:crypto).
//
// 32 random bytes, base64url (43 characters, no padding). Only its SHA-256
// hash is stored (ReviewInvite.tokenHash), so a database leak gives no
// working links. The lookup is by the hash (unique index); the stored hash
// is then compared again in constant time.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { isWellFormedReviewTokenShape } from './token-shape'

export const REVIEW_TOKEN_BYTES = 32

export const isWellFormedReviewToken = isWellFormedReviewTokenShape

/** sha256(token) as 64 lowercase hex. */
export function hashReviewToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function generateReviewToken(): { token: string; hash: string } {
  const token = randomBytes(REVIEW_TOKEN_BYTES).toString('base64url')
  return { token, hash: hashReviewToken(token) }
}

/** Constant-time equality of two hex hashes (false for different lengths). */
export function sameTokenHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}
