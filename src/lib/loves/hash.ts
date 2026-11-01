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
// Key: LOVES_HASH_SECRET (Secret Manager `grace-shop-uat-loves-hash-secret`
// on UAT, at least 32 characters).
// - Production: REQUIRED. Missing or too short throws (the endpoint answers
//   503): hearts fail closed rather than fall back to another secret.
// - Set but shorter than 32 characters: throws everywhere (never a silent fallback).
// - Development / test without it: a key derived from the session secret,
//   HMAC-SHA256(JWT secret, "vyra:loves:v1").
// Changing the secret restarts the dedupe (counts stay). Never logged.
import { createHmac } from 'node:crypto'
import { getJwtSecret } from '@/lib/auth'

export const LOVES_HASH_SECRET_MIN_LENGTH = 32
const DERIVATION_LABEL = 'vyra:loves:v1'

type Env = Partial<Record<'LOVES_HASH_SECRET' | 'JWT_SECRET' | 'NODE_ENV', string | undefined>>

/** The HMAC key for love hashes. Throws (fails closed) when it is not configured properly. */
export function loveHashKey(env: Env = process.env): Buffer {
  const own = env.LOVES_HASH_SECRET
  if (own !== undefined && own !== '') {
    if (own.length < LOVES_HASH_SECRET_MIN_LENGTH) {
      throw new Error(`LOVES_HASH_SECRET must be at least ${LOVES_HASH_SECRET_MIN_LENGTH} characters`)
    }
    return Buffer.from(own, 'utf8')
  }
  const isDevOrTest = env.NODE_ENV === 'development' || env.NODE_ENV === 'test'
  if (!isDevOrTest) throw new Error('LOVES_HASH_SECRET must be set outside development/test')
  return createHmac('sha256', getJwtSecret(env)).update(DERIVATION_LABEL).digest()
}

/** Lowercase hex HMAC-SHA256 of "<device id>:<product id>" (64 characters). */
export function loveHash(key: Buffer, deviceId: string, productId: number): string {
  return createHmac('sha256', key).update(`${deviceId.toLowerCase()}:${productId}`).digest('hex')
}
