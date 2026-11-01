// ZP-507: the anonymous dedupe key of a heart. Server only.
//
// The server never stores the device id. It keeps HMAC-SHA256(key,
// "<device id>:<product id>") as hex: one row per device and piece, so a
// second love from the same phone changes nothing, and nothing in the table
// can be traced back to a phone without the key (the hashes of one phone for
// different pieces cannot even be linked to each other).
// The product id (not the slug) is hashed, so renaming a piece's slug keeps
// its hearts deduplicated.
//
// Key: LOVES_HASH_SECRET (at least 32 characters) when set; otherwise derived
// from the session secret (getJwtSecret, which fails closed in production)
// as HMAC-SHA256(JWT secret, "vyra:loves:v1"), so the JWT secret itself is
// never used directly. Changing either secret starts dedupe afresh (old
// hearts stay counted; un-loving them then changes nothing). Never logged.
import { createHmac } from 'node:crypto'
import { getJwtSecret } from '@/lib/auth'

export const LOVES_HASH_SECRET_MIN_LENGTH = 32
const DERIVATION_LABEL = 'vyra:loves:v1'

type Env = Partial<Record<'LOVES_HASH_SECRET' | 'JWT_SECRET' | 'NODE_ENV', string | undefined>>

/** The HMAC key for love hashes. Throws (fails closed) in production when no secret is configured. */
export function loveHashKey(env: Env = process.env): Buffer {
  const own = env.LOVES_HASH_SECRET
  if (own && own.length >= LOVES_HASH_SECRET_MIN_LENGTH) return Buffer.from(own, 'utf8')
  return createHmac('sha256', getJwtSecret(env)).update(DERIVATION_LABEL).digest()
}

/** Lowercase hex HMAC-SHA256 of "<device id>:<product id>" (64 characters). */
export function loveHash(key: Buffer, deviceId: string, productId: number): string {
  return createHmac('sha256', key).update(`${deviceId.toLowerCase()}:${productId}`).digest('hex')
}
