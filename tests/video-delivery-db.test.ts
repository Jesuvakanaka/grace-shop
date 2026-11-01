// ZP-501: video delivery against DATABASE_URL and a temp local storage.
// - Public route: only READY videos/posters of PUBLIC products (published,
//   slug, published category); everything else is the same plain 404.
// - HTTP Range: 206 + Content-Range, 416 for bad ranges, Accept-Ranges always.
// - Headers: video/mp4, nosniff, long immutable cache.
// - Private route: signed-in only.
// - The storefront host lets /api/videos/public/* through and 404s /api/videos/*.
// Only touches rows it creates (item numbers "ZP501D-*", category slugs "zp501d-*").
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.JWT_SECRET = 'zp501-video-delivery-tests-secret-0123456789abcdef'
const DIR = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'zp501-delivery-'))
process.env.GRACE_IMAGE_STORAGE = 'local'
process.env.GRACE_IMAGE_DIR = DIR

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import { getVideoStorage } from '../src/lib/storage/videos'
import * as publicRoute from '../src/app/api/videos/public/[key]/route'
import * as privateRoute from '../src/app/api/videos/[key]/route'
import { decideHostRouting } from '../src/lib/host-routing'

const HEX = (c: string) => c.repeat(32)
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
const POSTER = Buffer.from('RIFF....WEBPVP8 fake poster')

type Handler = (req: Request, ctx: { params: Promise<{ key: string }> }) => Promise<Response>

async function get(handler: unknown, key: string, headers: Record<string, string> = {}) {
  const res = await (handler as Handler)(new Request(`http://localhost/api/videos/x/${key}`, { headers }), {
    params: Promise.resolve({ key }),
  })
  return { res, body: Buffer.from(await res.arrayBuffer()) }
}

let n = 0
async function productWithVideo(opts: {
  letter: string
  published?: boolean
  categoryPublished?: boolean
  status?: 'READY' | 'PROCESSING' | 'FAILED'
  slug?: boolean
}) {
  n += 1
  const cat = await prisma.category.create({
    data: { name: `zp501d cat ${n}`, slug: `zp501d-cat-${n}`, published: opts.categoryPublished ?? true },
  })
  const p = await prisma.product.create({
    data: {
      itemNumber: `ZP501D-${n}`,
      productName: `ZP501D ${n}`,
      categoryId: cat.id,
      published: opts.published ?? true,
      publishedAt: new Date(),
      slug: opts.slug === false ? null : `zp501d-${n}`,
      images: { create: { imageKey: `products/${HEX('f')}.webp`, isPrimary: true } },
    },
  })
  const storage = getVideoStorage()
  const videoKey = `videos/${HEX(opts.letter)}.mp4`
  const posterKey = `videos/${HEX(opts.letter)}.webp`
  await storage.putBytes(videoKey, BYTES, 'video/mp4')
  await storage.putBytes(posterKey, POSTER, 'image/webp')
  await prisma.productVideo.create({
    data: {
      productId: p.id,
      status: opts.status ?? 'READY',
      videoKey,
      posterKey,
      width: 720,
      height: 1280,
      durationMs: 5000,
      sizeBytes: BYTES.length,
    },
  })
  return { product: p, mp4: `${HEX(opts.letter)}.mp4`, webp: `${HEX(opts.letter)}.webp` }
}

async function cleanup() {
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP501D-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp501d-' } } })
}

describe('video delivery (ZP-501)', () => {
  before(cleanup)
  after(async () => {
    await cleanup()
    await prisma.$disconnect()
    fs.rmSync(DIR, { recursive: true, force: true })
  })

  test('a READY video of a public product: 200, video/mp4, nosniff, immutable, Accept-Ranges', async () => {
    const v = await productWithVideo({ letter: 'a' })
    const { res, body } = await get(publicRoute.GET, v.mp4)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get('content-type'), 'video/mp4')
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff')
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes')
    assert.match(res.headers.get('cache-control') ?? '', /public.*max-age=31536000.*immutable/)
    assert.strictEqual(res.headers.get('content-length'), '1000')
    assert.ok(body.equals(BYTES))

    const poster = await get(publicRoute.GET, v.webp)
    assert.strictEqual(poster.res.status, 200)
    assert.strictEqual(poster.res.headers.get('content-type'), 'image/webp')
    assert.ok(poster.body.equals(POSTER))
  })

  test('Range: 206 with Content-Range and exactly those bytes; 416 for bad ranges', async () => {
    const v = await productWithVideo({ letter: 'b' })
    const first = await get(publicRoute.GET, v.mp4, { range: 'bytes=0-1' })
    assert.strictEqual(first.res.status, 206)
    assert.strictEqual(first.res.headers.get('content-range'), 'bytes 0-1/1000')
    assert.strictEqual(first.res.headers.get('content-length'), '2')
    assert.ok(first.body.equals(BYTES.subarray(0, 2)))

    const tail = await get(publicRoute.GET, v.mp4, { range: 'bytes=900-' })
    assert.strictEqual(tail.res.status, 206)
    assert.strictEqual(tail.res.headers.get('content-range'), 'bytes 900-999/1000')
    assert.ok(tail.body.equals(BYTES.subarray(900)))

    const suffix = await get(publicRoute.GET, v.mp4, { range: 'bytes=-10' })
    assert.strictEqual(suffix.res.status, 206)
    assert.ok(suffix.body.equals(BYTES.subarray(990)))

    for (const bad of ['bytes=1000-', 'bytes=5-1', 'bytes=0-1,4-5', 'bytes=abc']) {
      const r = await get(publicRoute.GET, v.mp4, { range: bad })
      assert.strictEqual(r.res.status, 416, bad)
      assert.strictEqual(r.res.headers.get('content-range'), 'bytes */1000', bad)
    }
  })

  test('unpublished product, hidden category, no slug, PROCESSING or FAILED: 404 for video and poster', async () => {
    const cases = [
      await productWithVideo({ letter: 'c', published: false }),
      await productWithVideo({ letter: 'd', categoryPublished: false }),
      await productWithVideo({ letter: 'e', slug: false }),
      await productWithVideo({ letter: '1', status: 'PROCESSING' }),
      await productWithVideo({ letter: '2', status: 'FAILED' }),
    ]
    for (const v of cases) {
      for (const key of [v.mp4, v.webp]) {
        const { res, body } = await get(publicRoute.GET, key, { range: 'bytes=0-1' })
        assert.strictEqual(res.status, 404, key)
        assert.strictEqual(body.toString(), 'Not Found')
        assert.strictEqual(res.headers.get('cache-control'), 'no-store')
      }
    }
  })

  test('unpublishing takes effect at once', async () => {
    const v = await productWithVideo({ letter: '3' })
    assert.strictEqual((await get(publicRoute.GET, v.mp4)).res.status, 200)
    await prisma.product.update({ where: { id: v.product.id }, data: { published: false } })
    assert.strictEqual((await get(publicRoute.GET, v.mp4)).res.status, 404)
  })

  test('bad, traversal and unknown names are 404', async () => {
    for (const key of [`${HEX('9')}.mp4`, `../${HEX('a')}.mp4`, `${HEX('a')}.mov`, `${HEX('A')}.mp4`, 'x', '']) {
      assert.strictEqual((await get(publicRoute.GET, key)).res.status, 404, key)
    }
  })

  test('HEAD answers with headers only', async () => {
    const v = await productWithVideo({ letter: '4' })
    const res = await (publicRoute.HEAD as unknown as Handler)(
      new Request(`http://localhost/api/videos/public/${v.mp4}`, { method: 'HEAD' }),
      { params: Promise.resolve({ key: v.mp4 }) },
    )
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get('content-length'), '1000')
    assert.strictEqual((await res.arrayBuffer()).byteLength, 0)
  })

  test('private route: 401 signed out; signed in serves any stored video (owner preview) with Range', async () => {
    const v = await productWithVideo({ letter: '5', published: false })
    assert.strictEqual((await get(privateRoute.GET, v.mp4)).res.status, 401)
    const token = await createToken(900501, 'zp501-owner', 'OWNER')
    const r = await get(privateRoute.GET, v.mp4, { cookie: `auth-token=${token}`, range: 'bytes=10-19' })
    assert.strictEqual(r.res.status, 206)
    assert.match(r.res.headers.get('cache-control') ?? '', /^private/)
    assert.ok(r.body.equals(BYTES.subarray(10, 20)))
  })

  test('storefront host: /api/videos/public/* passes, the private route is 404', () => {
    const config = { storefrontHosts: ['shop.localhost'], adminHosts: [] }
    const at = (pathname: string) => decideHostRouting({ host: 'shop.localhost', pathname }, config)
    assert.deepStrictEqual(at(`/api/videos/public/${HEX('a')}.mp4`), { action: 'next', noindex: false })
    assert.deepStrictEqual(at(`/api/videos/${HEX('a')}.mp4`), { action: 'not-found' })
    assert.deepStrictEqual(at('/api/videos/publicx/1'), { action: 'not-found' })
  })
})
