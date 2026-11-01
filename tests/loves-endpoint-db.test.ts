// ZP-507: POST /api/public/loves and the love counts, against DATABASE_URL.
// - 204; a love counts once per device and piece (salted hash, unique), an
//   un-love takes it back; the count never goes below 0; concurrent taps are safe.
// - Only published pieces (unpublished / unknown slug: 404, nothing stored).
// - Refused: cross-site (403), bad body (400), wrong content type (415), big
//   body (413), floods (429: per IP, per device, daily cap per device).
// - Bots: 204, nothing stored.
// - Nothing personal stored: ProductLove has only the hash, the product and the time.
// - The public DTO exposes the count as `loves`; the owner can reset it.
// Only touches rows it creates (item numbers "ZP507L-*", slugs "zp507l-*").
import { describe, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp507-loves-tests-secret-0123456789abcdef'

import prisma from '../src/lib/db'
import { POST } from '../src/app/api/public/loves/route'
import { DailyCounter, EventBudget } from '../src/lib/analytics/limits'
import { createLovesHandler, MAX_LOVE_BODY_BYTES } from '../src/lib/loves/ingest'
import { resetLoves, setLove } from '../src/lib/loves/db'
import { loveHash, loveHashKey } from '../src/lib/loves/hash'
import { loadPublicCatalogue } from '../src/lib/storefront/queries'
import { listWebsiteStatus, getWebsiteProduct } from '../src/lib/website/products'

const ORIGIN = 'http://localhost:3456'
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
const device = (n: number) => `7e7e7e7e-0000-4000-8000-${String(n).padStart(12, '0')}`
const SLUG = 'zp507l-linen'
const HIDDEN = 'zp507l-draft'

let productId = 0
let hiddenId = 0
let ipCounter = 0

function request(body: unknown, headers: Record<string, string> = {}) {
  ipCounter += 1
  return new Request(`${ORIGIN}/api/public/loves`, {
    method: 'POST',
    headers: {
      host: 'localhost:3456',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'user-agent': PHONE,
      'x-forwarded-for': `10.7.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** Generous limits so only the limit under test bites. */
function handlerWith(overrides: Partial<Parameters<typeof createLovesHandler>[0]> = {}) {
  return createLovesHandler({
    ipBudget: new EventBudget({ capacity: 10_000, refillPerSecond: 100 }),
    deviceBudget: new EventBudget({ capacity: 10_000, refillPerSecond: 100 }),
    deviceDaily: new DailyCounter({ limit: 100_000 }),
    ...overrides,
  })
}

const count = async (id = productId) => (await prisma.product.findUniqueOrThrow({ where: { id }, select: { loveCount: true } })).loveCount
const hashes = (id = productId) => prisma.productLove.count({ where: { productId: id } })

async function cleanup() {
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP507L-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp507l-' } } })
}

before(async () => {
  await cleanup()
  const cat = await prisma.category.create({ data: { name: 'zp507l cat', slug: 'zp507l-cat', published: true } })
  const p = await prisma.product.create({
    data: { itemNumber: 'ZP507L-1', productName: 'ZP507L Linen', categoryId: cat.id, published: true, publishedAt: new Date(), slug: SLUG },
  })
  productId = p.id
  const h = await prisma.product.create({
    data: { itemNumber: 'ZP507L-2', productName: 'ZP507L Draft', categoryId: cat.id, published: false, slug: HIDDEN },
  })
  hiddenId = h.id
})
after(async () => {
  await cleanup()
  await prisma.$disconnect()
})
beforeEach(async () => {
  await prisma.productLove.deleteMany({ where: { productId: { in: [productId, hiddenId] } } })
  await prisma.product.updateMany({ where: { id: { in: [productId, hiddenId] } }, data: { loveCount: 0 } })
})

describe('POST /api/public/loves', () => {
  test('love: 204, no body, counted once per device; un-love takes it back', async () => {
    const res = await POST(request({ slug: SLUG, on: true, device: device(1) }))
    assert.strictEqual(res.status, 204)
    assert.strictEqual(await res.text(), '')
    assert.strictEqual(res.headers.get('cache-control'), 'no-store')
    assert.strictEqual(await count(), 1)

    // Same device again: no change (server-side dedupe).
    assert.strictEqual((await POST(request({ slug: SLUG, on: true, device: device(1) }))).status, 204)
    assert.strictEqual(await count(), 1)
    // Another device: counted.
    assert.strictEqual((await POST(request({ slug: SLUG, on: true, device: device(2) }))).status, 204)
    assert.strictEqual(await count(), 2)
    // Un-love, twice: one less, never below what was given.
    await POST(request({ slug: SLUG, on: false, device: device(1) }))
    await POST(request({ slug: SLUG, on: false, device: device(1) }))
    assert.strictEqual(await count(), 1)
    assert.strictEqual(await hashes(), 1)
    // Un-love from a device that never loved: nothing changes.
    await POST(request({ slug: SLUG, on: false, device: device(3) }))
    assert.strictEqual(await count(), 1)
  })

  test('stores only a salted hash (no device id, IP or user agent)', async () => {
    await POST(request({ slug: SLUG, on: true, device: device(4) }))
    const rows = await prisma.productLove.findMany({ where: { productId } })
    assert.strictEqual(rows.length, 1)
    assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['createdAt', 'hash', 'id', 'productId'])
    assert.match(rows[0].hash, /^[0-9a-f]{64}$/)
    assert.strictEqual(rows[0].hash, loveHash(loveHashKey(), device(4), productId))
    const all = JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? String(v) : v))
    assert.ok(!all.includes(device(4)) && !all.includes(device(4).replace(/-/g, '')))
  })

  test('unpublished or unknown pieces: 404, nothing stored', async () => {
    assert.strictEqual((await POST(request({ slug: HIDDEN, on: true, device: device(5) }))).status, 404)
    assert.strictEqual((await POST(request({ slug: 'zp507l-nope', on: true, device: device(5) }))).status, 404)
    assert.strictEqual(await count(hiddenId), 0)
    assert.strictEqual(await hashes(hiddenId), 0)
  })

  test('cross-site or no Origin: 403', async () => {
    assert.strictEqual((await POST(request({ slug: SLUG, on: true, device: device(6) }, { origin: 'https://evil.example' }))).status, 403)
    assert.strictEqual((await POST(request({ slug: SLUG, on: true, device: device(6) }, { 'sec-fetch-site': 'cross-site' }))).status, 403)
    const noOrigin = request({ slug: SLUG, on: true, device: device(6) })
    noOrigin.headers.delete('origin')
    assert.strictEqual((await POST(noOrigin)).status, 403)
    assert.strictEqual(await count(), 0)
  })

  test('bots and headless browsers: 204, nothing stored', async () => {
    const bot = await POST(request({ slug: SLUG, on: true, device: device(7) }, { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' }))
    assert.strictEqual(bot.status, 204)
    const headless = await POST(request({ slug: SLUG, on: true, device: device(7) }, { 'user-agent': 'Mozilla/5.0 HeadlessChrome/120.0' }))
    assert.strictEqual(headless.status, 204)
    assert.strictEqual(await count(), 0)
  })

  test('bad bodies: 400; wrong content type: 415; too big: 413', async () => {
    for (const body of ['not json', { slug: SLUG, on: true }, { slug: SLUG, on: 'yes', device: device(8) }, { slug: SLUG, on: true, device: device(8), extra: 1 }]) {
      assert.strictEqual((await POST(request(body))).status, 400, JSON.stringify(body))
    }
    assert.strictEqual((await POST(request({ slug: SLUG, on: true, device: device(8) }, { 'content-type': 'multipart/form-data' }))).status, 415)
    const big = JSON.stringify({ slug: SLUG, on: true, device: device(8), pad: 'x'.repeat(MAX_LOVE_BODY_BYTES) })
    assert.strictEqual((await POST(request(big))).status, 413)
    assert.strictEqual(await count(), 0)
  })

  test('text/plain (keepalive beacon) is accepted', async () => {
    assert.strictEqual((await POST(request({ slug: SLUG, on: true, device: device(9) }, { 'content-type': 'text/plain;charset=UTF-8' }))).status, 204)
    assert.strictEqual(await count(), 1)
  })

  test('floods: per IP', async () => {
    const handle = handlerWith({ ipBudget: new EventBudget({ capacity: 3, refillPerSecond: 0 }) })
    const from = { 'x-forwarded-for': '10.99.0.1' }
    const statuses = []
    for (let i = 0; i < 5; i += 1) statuses.push((await handle(request({ slug: SLUG, on: i % 2 === 0, device: device(20 + i) }, from))).status)
    assert.deepStrictEqual(statuses, [204, 204, 204, 429, 429])
    const res = await handle(request({ slug: SLUG, on: true, device: device(30) }, from))
    assert.ok(Number(res.headers.get('retry-after')) >= 1)
  })

  test('floods: per device (any IP), and the daily cap per device', async () => {
    const perDevice = handlerWith({ deviceBudget: new EventBudget({ capacity: 2, refillPerSecond: 0 }) })
    const statuses = []
    for (let i = 0; i < 4; i += 1) statuses.push((await perDevice(request({ slug: SLUG, on: i % 2 === 0, device: device(40) }))).status)
    assert.deepStrictEqual(statuses, [204, 204, 429, 429])

    const daily = handlerWith({ deviceDaily: new DailyCounter({ limit: 3 }) })
    const dailyStatuses = []
    for (let i = 0; i < 5; i += 1) dailyStatuses.push((await daily(request({ slug: SLUG, on: i % 2 === 0, device: device(41) }))).status)
    assert.deepStrictEqual(dailyStatuses, [204, 204, 204, 429, 429])
    // Another device is not affected.
    assert.strictEqual((await daily(request({ slug: SLUG, on: true, device: device(42) }))).status, 204)
  })
})

describe('love counts', () => {
  test('concurrent loves from many devices count exactly', async () => {
    const key = loveHashKey()
    await Promise.all(Array.from({ length: 12 }, (_, i) => setLove(prisma, productId, loveHash(key, device(100 + i), productId), true)))
    assert.strictEqual(await count(), 12)
  })

  test('concurrent duplicate taps from one device count once', async () => {
    const hash = loveHash(loveHashKey(), device(200), productId)
    await Promise.all(Array.from({ length: 8 }, () => setLove(prisma, productId, hash, true)))
    assert.strictEqual(await count(), 1)
    await Promise.all(Array.from({ length: 8 }, () => setLove(prisma, productId, hash, false)))
    assert.strictEqual(await count(), 0)
  })

  test('never below 0 even if the count was reset under a loved hash', async () => {
    const hash = loveHash(loveHashKey(), device(201), productId)
    await setLove(prisma, productId, hash, true)
    await prisma.product.update({ where: { id: productId }, data: { loveCount: 0 } })
    const result = await setLove(prisma, productId, hash, false)
    assert.strictEqual(result.loves, 0)
    assert.strictEqual(await count(), 0)
  })

  test('the database refuses a negative count', async () => {
    await assert.rejects(prisma.product.update({ where: { id: productId }, data: { loveCount: -1 } }))
  })

  test('owner reset: count 0 and the hashes removed (devices can love again)', async () => {
    const key = loveHashKey()
    for (let i = 0; i < 3; i += 1) await setLove(prisma, productId, loveHash(key, device(300 + i), productId), true)
    assert.strictEqual(await count(), 3)
    const result = await resetLoves(prisma, productId)
    assert.deepStrictEqual(result, { removed: 3 })
    assert.strictEqual(await count(), 0)
    assert.strictEqual(await hashes(), 0)
    await setLove(prisma, productId, loveHash(key, device(300), productId), true)
    assert.strictEqual(await count(), 1)
  })

  test('public DTO: `loves`; admin: loves in the list and the editor', async () => {
    const key = loveHashKey()
    for (let i = 0; i < 4; i += 1) await setLove(prisma, productId, loveHash(key, device(400 + i), productId), true)
    const catalogue = await loadPublicCatalogue(prisma)
    const dto = catalogue.products.find((p) => p.product.slug === SLUG)?.product
    assert.ok(dto)
    assert.strictEqual(dto.loves, 4)
    assert.ok(!('loveCount' in dto))
    const list = await listWebsiteStatus(prisma)
    assert.strictEqual(list.find((r) => r.id === productId)?.loves, 4)
    assert.strictEqual((await getWebsiteProduct(prisma, productId))?.loveCount, 4)
  })
})
