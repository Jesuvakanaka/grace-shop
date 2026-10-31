// ZP-483: short-lived, owner-issued storefront preview tokens. Pure (no DB).
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { SignJWT } from 'jose'

process.env.JWT_SECRET = 'zp483-preview-token-tests-secret-0123456789abcdef'

import { createToken, getJwtSecret, verifyToken } from '../src/lib/auth'
import {
  PREVIEW_TOKEN_TTL_SECONDS,
  previewUrlFor,
  signPreviewToken,
  verifyPreviewToken,
  verifyPreviewTokenFor,
} from '../src/lib/website/preview-token'

const T0 = new Date('2026-11-01T10:00:00Z')
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

describe('preview token (ZP-483)', () => {
  test('lasts 30 minutes', () => {
    assert.strictEqual(PREVIEW_TOKEN_TTL_SECONDS, 30 * 60)
  })

  test('sign then verify returns the product id', async () => {
    const { token, expiresAt } = await signPreviewToken(42, { now: T0 })
    assert.strictEqual(expiresAt.toISOString(), at(PREVIEW_TOKEN_TTL_SECONDS).toISOString())
    assert.deepStrictEqual(await verifyPreviewToken(token, { now: at(60) }), { productId: 42 })
  })

  test('is rejected after it expires', async () => {
    const { token } = await signPreviewToken(42, { now: T0 })
    assert.strictEqual(await verifyPreviewToken(token, { now: at(PREVIEW_TOKEN_TTL_SECONDS + 1) }), null)
  })

  test('a tampered token is rejected', async () => {
    const { token } = await signPreviewToken(42, { now: T0 })
    const [h, p, s] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ productId: 7, purpose: 'preview', iat: 0, exp: 9e9 })).toString('base64url')
    assert.strictEqual(await verifyPreviewToken(`${h}.${forged}.${s}`, { now: at(1) }), null)
    assert.strictEqual(await verifyPreviewToken(`${h}.${p}.${s}x`, { now: at(1) }), null)
    assert.strictEqual(await verifyPreviewToken('', { now: at(1) }), null)
    assert.strictEqual(await verifyPreviewToken('not-a-jwt', { now: at(1) }), null)
  })

  test('a token with the wrong purpose is rejected', async () => {
    const wrong = await new SignJWT({ productId: 42, purpose: 'session' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(T0.getTime() / 1000))
      .setExpirationTime(Math.floor(T0.getTime() / 1000) + 600)
      .sign(getJwtSecret())
    assert.strictEqual(await verifyPreviewToken(wrong, { now: at(1) }), null)
  })

  test('a token without an expiry is rejected', async () => {
    const noExp = await new SignJWT({ productId: 42, purpose: 'preview' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(T0.getTime() / 1000))
      .sign(getJwtSecret())
    assert.strictEqual(await verifyPreviewToken(noExp, { now: at(1) }), null)
  })

  test('a session token is not a preview token, and a preview token is not a session', async () => {
    const session = await createToken(1, 'owner', 'OWNER')
    assert.strictEqual(await verifyPreviewToken(session), null)
    const { token } = await signPreviewToken(42)
    assert.strictEqual(await verifyToken(token), null)
  })

  test('a token signed with another secret is rejected', async () => {
    const other = await new SignJWT({ productId: 42, purpose: 'preview' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('another-secret-another-secret-another-secret'))
    assert.strictEqual(await verifyPreviewToken(other), null)
  })

  test('invalid product ids cannot be signed', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await assert.rejects(() => signPreviewToken(bad))
    }
  })

  test('verifyPreviewTokenFor is true only for the product the token was issued for', async () => {
    const { token } = await signPreviewToken(42, { now: T0 })
    assert.strictEqual(await verifyPreviewTokenFor(token, 42, { now: at(60) }), true)
    assert.strictEqual(await verifyPreviewTokenFor(token, 43, { now: at(60) }), false)
    assert.strictEqual(await verifyPreviewTokenFor(token, 42, { now: at(PREVIEW_TOKEN_TTL_SECONDS + 1) }), false)
    assert.strictEqual(await verifyPreviewTokenFor(null, 42), false)
    assert.strictEqual(await verifyPreviewTokenFor(token, Number.NaN, { now: at(60) }), false)
  })

  test('previewUrlFor builds the storefront product URL', () => {
    assert.strictEqual(previewUrlFor('gold-evening-dress', 'a.b.c'), '/site/p/gold-evening-dress?preview=a.b.c')
  })
})
