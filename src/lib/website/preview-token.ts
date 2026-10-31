// Storefront preview tokens (ZP-483). Server only.
//
// The owner presses "Preview on site" in the back office. The server issues a
// short-lived JWT ({ productId, purpose: 'preview' }) signed with the same
// secret as sessions (getJwtSecret). The storefront product page (ZP-490)
// verifies it with verifyPreviewToken and may then show that one product even
// while it is unpublished.
//
// A preview token is never a session: verifyToken requires userId/username/
// role, which a preview token does not carry. A session token is never a
// preview token: verifyPreviewToken requires purpose 'preview' and a productId.
import { SignJWT, jwtVerify } from 'jose'
import { getJwtSecret } from '@/lib/auth'
import { STOREFRONT_PREFIX } from '@/lib/host-routing'

export const PREVIEW_TOKEN_PURPOSE = 'preview'
/** 30 minutes. */
export const PREVIEW_TOKEN_TTL_SECONDS = 30 * 60

export { STOREFRONT_PRODUCT_PAGE_READY } from './preview-config'

const seconds = (d: Date) => Math.floor(d.getTime() / 1000)

export async function signPreviewToken(
  productId: number,
  options: { now?: Date; ttlSeconds?: number } = {},
): Promise<{ token: string; expiresAt: Date }> {
  if (!Number.isInteger(productId) || productId <= 0) throw new Error('Invalid product id')
  const now = options.now ?? new Date()
  const exp = seconds(now) + (options.ttlSeconds ?? PREVIEW_TOKEN_TTL_SECONDS)
  const token = await new SignJWT({ productId, purpose: PREVIEW_TOKEN_PURPOSE })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(seconds(now))
    .setExpirationTime(exp)
    .sign(getJwtSecret())
  return { token, expiresAt: new Date(exp * 1000) }
}

/** `{ productId }` for a valid, unexpired preview token, else null. */
export async function verifyPreviewToken(
  token: string | null | undefined,
  options: { now?: Date } = {},
): Promise<{ productId: number } | null> {
  if (typeof token !== 'string' || token === '') return null
  // Outside the try: a missing secret is a misconfiguration, not "invalid token".
  const key = getJwtSecret()
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat'],
      currentDate: options.now,
    })
    if (payload.purpose !== PREVIEW_TOKEN_PURPOSE) return null
    const productId = payload.productId
    if (typeof productId !== 'number' || !Number.isInteger(productId) || productId <= 0) return null
    return { productId }
  } catch {
    return null
  }
}

/**
 * For the storefront product page (ZP-490): true only when `token` is a valid,
 * unexpired preview token issued for exactly `productId` (the product the
 * page resolved from its slug). A token for another product is false.
 * The preview response must also send `Cache-Control: private, no-store` and
 * `Referrer-Policy: no-referrer`, so the token never reaches a cache or
 * another site through the Referer header.
 */
export async function verifyPreviewTokenFor(
  token: string | null | undefined,
  productId: number,
  options: { now?: Date } = {},
): Promise<boolean> {
  if (!Number.isInteger(productId) || productId <= 0) return false
  const verified = await verifyPreviewToken(token, options)
  return verified !== null && verified.productId === productId
}

/** Storefront URL of a product with a preview token (admin host path). */
export function previewUrlFor(slug: string, token: string): string {
  return `${STOREFRONT_PREFIX}/p/${encodeURIComponent(slug)}?preview=${encodeURIComponent(token)}`
}
