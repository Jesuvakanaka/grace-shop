/* eslint-disable @typescript-eslint/no-explicit-any -- JSON response bodies in assertions */
// ZP-508: customer reviews against DATABASE_URL: the one-time link lifecycle
// (single use, expiry, atomic), the owner-only admin API, moderation, the
// approved-only rule on the public data layer and the public image route,
// and the public submit/photo endpoints (same-origin, token gate).
// Only touches rows it creates (item numbers "ZP508-*", category slugs
// "zp508-*") and removes them again.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

process.env.JWT_SECRET = 'zp508-reviews-tests-secret-0123456789abcdef'
const IMAGE_DIR = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'zp508-images-'))
process.env.GRACE_IMAGE_STORAGE = 'local'
process.env.GRACE_IMAGE_DIR = IMAGE_DIR

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import { getImageStorage } from '../src/lib/storage/images'
import { REVIEW_INVITE_DAYS } from '../src/lib/reviews/rules'
import { hashReviewToken } from '../src/lib/reviews/token'
import { createReviewInvite, readReviewInvite, submitReview } from '../src/lib/reviews/invites'
import { loadPublicReviews } from '../src/lib/storefront/reviews'
import { isPublicImageKey } from '../src/lib/storefront/queries'
import * as invitesRoute from '../src/app/api/website/reviews/invites/route'
import * as reviewsRoute from '../src/app/api/website/reviews/route'
import * as reviewRoute from '../src/app/api/website/reviews/[id]/route'
import * as countRoute from '../src/app/api/website/reviews/count/route'
import * as submitRoute from '../src/app/api/public/reviews/route'
import * as photoRoute from '../src/app/api/public/reviews/photo/route'

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
const h = (fn: unknown) => fn as Handler

let ownerToken = ''
let staffToken = ''
const DAY = 86_400_000
const ORIGIN = { origin: 'http://localhost:3455', host: 'localhost:3455' }

async function call(
  fn: unknown,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown; token?: string | null; headers?: Record<string, string>; form?: FormData } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { ...opts.headers }
  const token = opts.token === undefined ? ownerToken : opts.token
  if (token) headers.cookie = `auth-token=${token}`
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await h(fn)(new Request('http://localhost:3455/api/test', { method, headers, body }), {
    params: Promise.resolve(opts.params ?? {}),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json }
}

async function cleanup() {
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP508-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp508-' } } })
  await prisma.reviewInvite.deleteMany({ where: { createdBy: { startsWith: 'zp508' } } })
}

const HEX = (c: string) => c.repeat(32)
const KEY = (c: string) => `products/${HEX(c)}.webp`
let pub: { id: number; slug: string }
let hidden: { id: number }

const goodReview = { stars: 5, comment: 'Beautiful dress, fits well.', name: 'Tendai Moyo', photo: false, photoConsent: false }

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 50, channels: 3, background: { r: 120, g: 30, b: 40 } } })
    .withMetadata({ exif: { IFD0: { Artist: 'secret-artist' } } })
    .jpeg()
    .toBuffer()
}

describe('reviews (database)', () => {
  before(async () => {
    await cleanup()
    const owner = await prisma.user.upsert({
      where: { username: 'zp508owner' },
      create: { username: 'zp508owner', password: 'x', fullName: 'Owner', role: 'OWNER' },
      update: { role: 'OWNER', active: true },
    })
    const staff = await prisma.user.upsert({
      where: { username: 'zp508staff' },
      create: { username: 'zp508staff', password: 'x', fullName: 'Staff', role: 'STAFF' },
      update: { role: 'STAFF', active: true },
    })
    ownerToken = await createToken(owner.id, owner.username, 'OWNER')
    staffToken = await createToken(staff.id, staff.username, 'STAFF')
    const cat = await prisma.category.create({ data: { slug: 'zp508-dresses', name: 'ZP508 Dresses', published: true } })
    const p = await prisma.product.create({
      data: {
        itemNumber: 'ZP508-1',
        productName: 'ZP508 Velvet',
        publicName: 'Velvet Midi',
        slug: 'zp508-velvet',
        published: true,
        publishedAt: new Date(),
        categoryId: cat.id,
        currentQuantity: 3,
        images: { create: [{ imageKey: KEY('1'), isPrimary: true, sortOrder: 0 }] },
      },
    })
    pub = { id: p.id, slug: 'zp508-velvet' }
    hidden = await prisma.product.create({ data: { itemNumber: 'ZP508-2', productName: 'ZP508 Draft' } })
  })

  after(async () => {
    await cleanup()
    await prisma.user.deleteMany({ where: { username: { in: ['zp508owner', 'zp508staff'] } } })
    await prisma.$disconnect()
    fs.rmSync(IMAGE_DIR, { recursive: true, force: true })
  })

  describe('invite lifecycle', () => {
    test(`stores only the hash; expires in ${REVIEW_INVITE_DAYS} days`, async () => {
      const now = new Date('2026-11-01T10:00:00Z')
      const { token, inviteId } = await createReviewInvite(prisma, { productId: pub.id, createdBy: 'zp508owner', now })
      const row = await prisma.reviewInvite.findUniqueOrThrow({ where: { id: inviteId } })
      assert.strictEqual(row.tokenHash, hashReviewToken(token))
      assert.ok(!JSON.stringify(row).includes(token))
      assert.strictEqual(row.expiresAt.getTime(), now.getTime() + REVIEW_INVITE_DAYS * DAY)
    })

    test('single use, enforced atomically under concurrency', async () => {
      const { token } = await createReviewInvite(prisma, { productId: pub.id, createdBy: 'zp508owner' })
      const value = { stars: 5, shopStars: null, comment: 'Lovely quality.', displayName: 'A B.', firstName: 'A', photo: false, photoConsent: false }
      const results = await Promise.all(Array.from({ length: 5 }, () => submitReview(prisma, token, value)))
      assert.strictEqual(results.filter((r) => r.ok).length, 1)
      assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.state === 'used'))
      const used = await readReviewInvite(prisma, token)
      assert.strictEqual(used.state, 'used')
      assert.strictEqual(await prisma.review.count({ where: { invite: { tokenHash: hashReviewToken(token) } } }), 1)
    })

    test('expired and unknown tokens', async () => {
      const past = new Date(Date.now() - (REVIEW_INVITE_DAYS + 1) * DAY)
      const { token } = await createReviewInvite(prisma, { productId: pub.id, createdBy: 'zp508owner', now: past })
      assert.strictEqual((await readReviewInvite(prisma, token)).state, 'expired')
      const value = { stars: 4, shopStars: null, comment: 'Lovely quality.', displayName: 'A B.', firstName: 'A', photo: false, photoConsent: false }
      const r = await submitReview(prisma, token, value)
      assert.ok(!r.ok && r.state === 'expired')
      assert.strictEqual((await readReviewInvite(prisma, 'x'.repeat(43))).state, 'invalid')
      assert.strictEqual((await readReviewInvite(prisma, 'not a token')).state, 'invalid')
    })

    test('open invite shows the piece (public photo only for a public piece) or the shop', async () => {
      const a = await createReviewInvite(prisma, { productId: pub.id, customerHint: 'Tendai', createdBy: 'zp508owner' })
      const open = await readReviewInvite(prisma, a.token)
      assert.strictEqual(open.state, 'open')
      if (open.state !== 'open') return
      assert.strictEqual(open.product?.name, 'Velvet Midi')
      assert.strictEqual(open.product?.image?.url, `/api/images/public/${HEX('1')}.webp`)
      assert.strictEqual(open.customerHint, 'Tendai')
      const b = await createReviewInvite(prisma, { productId: hidden.id, createdBy: 'zp508owner' })
      const draft = await readReviewInvite(prisma, b.token)
      assert.ok(draft.state === 'open' && draft.product?.image === null)
      const c = await createReviewInvite(prisma, { productId: null, createdBy: 'zp508owner' })
      const shop = await readReviewInvite(prisma, c.token)
      assert.ok(shop.state === 'open' && shop.product === null)
    })
  })

  describe('admin API (OWNER only)', () => {
    test('staff and anonymous are refused on every review route', async () => {
      for (const token of [staffToken, null]) {
        const expected = token ? 403 : 401
        assert.strictEqual((await call(invitesRoute.POST, 'POST', { token, body: { productId: pub.id } })).status, expected)
        assert.strictEqual((await call(reviewsRoute.GET, 'GET', { token })).status, expected)
        assert.strictEqual((await call(countRoute.GET, 'GET', { token })).status, expected)
        assert.strictEqual((await call(reviewRoute.PATCH, 'PATCH', { token, params: { id: '1' }, body: { action: 'approve' } })).status, expected)
        assert.strictEqual((await call(reviewRoute.DELETE, 'DELETE', { token, params: { id: '1' } })).status, expected)
      }
    })

    test('create a link: URL, WhatsApp link without a number, expiry; unknown product 404', async () => {
      const r = await call(invitesRoute.POST, 'POST', { body: { productId: pub.id, customerName: 'Tendai' }, headers: { host: 'localhost:3455' } })
      assert.strictEqual(r.status, 201)
      assert.match(r.json.url, /^http:\/\/localhost:3455\/site\/review\/[A-Za-z0-9_-]{43}$/)
      assert.ok(r.json.whatsappHref.startsWith('https://wa.me/?text='))
      assert.ok(decodeURIComponent(r.json.whatsappHref).includes(r.json.url))
      assert.ok(decodeURIComponent(r.json.whatsappHref).includes('Velvet Midi'))
      assert.ok(r.json.expiresAt)
      const shop = await call(invitesRoute.POST, 'POST', { body: { productId: null }, headers: { host: 'localhost:3455' } })
      assert.strictEqual(shop.status, 201)
      assert.strictEqual((await call(invitesRoute.POST, 'POST', { body: { productId: 99999999 } })).status, 404)
      assert.strictEqual((await call(invitesRoute.POST, 'POST', { body: { productId: 'x' } })).status, 400)
      assert.strictEqual((await call(invitesRoute.POST, 'POST', { body: { productId: pub.id, extra: 1 } })).status, 400)
    })

    test('the admin cannot author a review (no create route, no status in submit)', async () => {
      assert.strictEqual((reviewsRoute as Record<string, unknown>).POST, undefined)
      assert.strictEqual((reviewRoute as Record<string, unknown>).POST, undefined)
      assert.strictEqual((reviewRoute as Record<string, unknown>).PUT, undefined)
    })
  })

  describe('submit, moderate, display', () => {
    let token = ''
    let reviewId = 0

    test('public submit: same-origin and JSON required', async () => {
      ;({ token } = await createReviewInvite(prisma, { productId: pub.id, createdBy: 'zp508owner' }))
      const cross = await call(submitRoute.POST, 'POST', { token: null, body: { token, ...goodReview }, headers: { origin: 'https://evil.example', host: 'localhost:3455' } })
      assert.strictEqual(cross.status, 403)
      const none = await call(submitRoute.POST, 'POST', { token: null, body: { token, ...goodReview }, headers: { host: 'localhost:3455' } })
      assert.strictEqual(none.status, 403)
      const bad = await call(submitRoute.POST, 'POST', { token: null, body: { token, ...goodReview, comment: 'short' }, headers: ORIGIN })
      assert.strictEqual(bad.status, 400)
      assert.ok(bad.json.errors.comment)
      // Nothing was used up by the refused attempts.
      assert.strictEqual((await readReviewInvite(prisma, token)).state, 'open')
    })

    test('photo upload: token-gated, re-encoded without metadata, kept on the invite', async () => {
      const form = new FormData()
      form.set('token', token)
      form.set('file', new Blob([new Uint8Array(await jpeg())], { type: 'image/jpeg' }), 'me.jpg')
      const r = await call(photoRoute.POST, 'POST', { token: null, form, headers: ORIGIN })
      assert.strictEqual(r.status, 200, JSON.stringify(r.json))
      assert.deepStrictEqual(Object.keys(r.json).sort(), ['ok'])
      const invite = await prisma.reviewInvite.findUniqueOrThrow({ where: { tokenHash: hashReviewToken(token) } })
      assert.match(invite.photoKey ?? '', /^products\/[a-f0-9]{32}\.webp$/)
      const stored = await getImageStorage().get(invite.photoKey as string)
      assert.ok(stored)
      const bytes = Buffer.from(await new Response(stored.stream).arrayBuffer())
      const meta = await sharp(bytes).metadata()
      assert.strictEqual(meta.format, 'webp')
      assert.strictEqual(meta.exif, undefined)
      assert.ok(!bytes.includes(Buffer.from('secret-artist')))
      // Bad token, not a picture, cross-site: refused.
      const f2 = new FormData()
      f2.set('token', 'y'.repeat(43))
      f2.set('file', new Blob([new Uint8Array(await jpeg())]), 'x.jpg')
      assert.strictEqual((await call(photoRoute.POST, 'POST', { token: null, form: f2, headers: ORIGIN })).status, 410)
      const f3 = new FormData()
      f3.set('token', token)
      f3.set('file', new Blob([new TextEncoder().encode('<svg></svg>')]), 'x.svg')
      assert.strictEqual((await call(photoRoute.POST, 'POST', { token: null, form: f3, headers: ORIGIN })).status, 400)
      const f4 = new FormData()
      f4.set('token', token)
      f4.set('file', new Blob([new Uint8Array(await jpeg())]), 'x.jpg')
      assert.strictEqual((await call(photoRoute.POST, 'POST', { token: null, form: f4, headers: { origin: 'https://evil.example', host: 'localhost:3455' } })).status, 403)
    })

    test('submit succeeds once; the second time is "used"', async () => {
      const r = await call(submitRoute.POST, 'POST', {
        token: null,
        body: { token, ...goodReview, shopStars: 4, photo: true, photoConsent: true },
        headers: ORIGIN,
      })
      assert.strictEqual(r.status, 201, JSON.stringify(r.json))
      assert.deepStrictEqual(r.json, { ok: true, firstName: 'Tendai' })
      const again = await call(submitRoute.POST, 'POST', { token: null, body: { token, ...goodReview }, headers: ORIGIN })
      assert.strictEqual(again.status, 410)
      assert.strictEqual(again.json.reason, 'used')
      const review = await prisma.review.findFirstOrThrow({ where: { invite: { tokenHash: hashReviewToken(token) } } })
      reviewId = review.id
      assert.strictEqual(review.status, 'PENDING')
      assert.strictEqual(review.displayName, 'Tendai M.')
      assert.ok(!JSON.stringify(review).includes('Moyo'))
      assert.ok(review.photoKey)
    })

    test('pending: nothing public (index, image route), count shows 1+', async () => {
      const index = await loadPublicReviews(prisma)
      assert.strictEqual(index.products[pub.slug], undefined)
      const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })
      assert.strictEqual(await isPublicImageKey(prisma, review.photoKey as string), false)
      const count = await call(countRoute.GET, 'GET')
      assert.strictEqual(count.status, 200)
      assert.ok(count.json.pending >= 1)
      const list = await call(reviewsRoute.GET, 'GET')
      const mine = list.json.reviews.find((r: any) => r.id === reviewId)
      assert.ok(mine)
      assert.strictEqual(mine.status, 'PENDING')
      assert.strictEqual(mine.productName, 'Velvet Midi')
      assert.match(mine.photoUrl, /^\/api\/images\/[a-f0-9]{32}\.webp$/)
    })

    test('approve + reply: public with aggregates; photo public with consent', async () => {
      assert.strictEqual((await call(reviewRoute.PATCH, 'PATCH', { params: { id: String(reviewId) }, body: { action: 'approve' } })).status, 200)
      const reply = await call(reviewRoute.PATCH, 'PATCH', { params: { id: String(reviewId) }, body: { action: 'reply', reply: 'Thank you, Tendai!' } })
      assert.strictEqual(reply.status, 200)
      const index = await loadPublicReviews(prisma)
      const entry = index.products[pub.slug]
      assert.deepStrictEqual(entry.summary, { average: 5, count: 1 })
      assert.strictEqual(entry.reviews[0].reply, 'Thank you, Tendai!')
      assert.strictEqual(entry.reviews[0].name, 'Tendai M.')
      assert.ok(entry.reviews[0].photo)
      assert.ok(index.shop && index.shop.count >= 1)
      const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })
      assert.strictEqual(await isPublicImageKey(prisma, review.photoKey as string), true)
    })

    test('consent withdrawn (no consent): photo never public even when approved', async () => {
      await prisma.review.update({ where: { id: reviewId }, data: { photoConsent: false } })
      const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })
      assert.strictEqual(await isPublicImageKey(prisma, review.photoKey as string), false)
      assert.strictEqual((await loadPublicReviews(prisma)).products[pub.slug].reviews[0].photo, null)
      await prisma.review.update({ where: { id: reviewId }, data: { photoConsent: true } })
    })

    test('unpublish and hide take it off the site; private note never public', async () => {
      assert.strictEqual((await call(reviewRoute.PATCH, 'PATCH', { params: { id: String(reviewId) }, body: { action: 'unpublish' } })).status, 200)
      assert.strictEqual((await loadPublicReviews(prisma)).products[pub.slug], undefined)
      const hide = await call(reviewRoute.PATCH, 'PATCH', { params: { id: String(reviewId) }, body: { action: 'hide', note: 'zp508 private' } })
      assert.strictEqual(hide.status, 200)
      const row = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })
      assert.strictEqual(row.status, 'HIDDEN')
      assert.strictEqual(row.privateNote, 'zp508 private')
      const index = await loadPublicReviews(prisma)
      assert.ok(!JSON.stringify(index).includes('zp508 private'))
      assert.strictEqual(index.products[pub.slug], undefined)
    })

    test('reviews of an unpublished piece are not public', async () => {
      await call(reviewRoute.PATCH, 'PATCH', { params: { id: String(reviewId) }, body: { action: 'approve' } })
      await prisma.product.update({ where: { id: pub.id }, data: { published: false } })
      assert.strictEqual((await loadPublicReviews(prisma)).products[pub.slug], undefined)
      await prisma.product.update({ where: { id: pub.id }, data: { published: true } })
      assert.ok((await loadPublicReviews(prisma)).products[pub.slug])
    })

    test('delete removes it; unknown id 404; bad action 400', async () => {
      assert.strictEqual((await call(reviewRoute.PATCH, 'PATCH', { params: { id: String(reviewId) }, body: { action: 'publish-all' } })).status, 400)
      assert.strictEqual((await call(reviewRoute.DELETE, 'DELETE', { params: { id: String(reviewId) } })).status, 200)
      assert.strictEqual(await prisma.review.count({ where: { id: reviewId } }), 0)
      assert.strictEqual((await call(reviewRoute.DELETE, 'DELETE', { params: { id: String(reviewId) } })).status, 404)
      assert.strictEqual((await call(reviewRoute.PATCH, 'PATCH', { params: { id: 'abc' }, body: { action: 'approve' } })).status, 404)
      assert.strictEqual((await loadPublicReviews(prisma)).products[pub.slug], undefined)
    })

    test('profanity is flagged for the owner', async () => {
      const { token: t } = await createReviewInvite(prisma, { productId: null, createdBy: 'zp508owner' })
      const r = await call(submitRoute.POST, 'POST', { token: null, body: { token: t, ...goodReview, comment: 'This shop is shit honestly' }, headers: ORIGIN })
      assert.strictEqual(r.status, 201)
      const review = await prisma.review.findFirstOrThrow({ where: { invite: { tokenHash: hashReviewToken(t) } } })
      assert.strictEqual(review.flagged, true)
      assert.strictEqual(review.productId, null)
      assert.strictEqual(review.shopStars, null)
    })
  })
})
