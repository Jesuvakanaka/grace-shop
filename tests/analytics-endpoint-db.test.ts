// ZP-493: POST /api/public/events against DATABASE_URL.
// - 204 and rows stored for a valid batch (sendBeacon text/plain or fetch JSON).
// - Slugs must be published pieces: other events are dropped, not the batch.
// - Rejected: unknown events / fields (400), > 50 events (400), oversized
//   body (413), wrong content type (415), cross-site (403), floods (429).
// - Dropped without storing (204): GPC / DNT, bots and headless browsers.
// - Nothing personal stored: no IP or user agent column, ids are random UUIDs.
// Only touches rows it creates (item numbers "ZP493E-*", slugs "zp493e-*",
// analytics rows of the visit ids below).
import { describe, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import { POST } from '../src/app/api/public/events/route'
import { createEventsHandler, MAX_BODY_BYTES } from '../src/lib/analytics/ingest'
import { TokenBucketLimiter } from '../src/lib/storefront/rate-limit'

const VISITS = Array.from({ length: 12 }, (_, i) => `7a7a7a7a-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
const DEVICE = '7d7d7d7d-0000-4000-8000-000000000001'
const ORIGIN = 'http://localhost:3454'
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'

let publicId = 0
let hiddenSlug = ''

function body(visit: string, events: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ v: 1, visit, device: DEVICE, events, ...extra })
}
function ev(type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { type, at: Date.now() - 1_000, page: '/', props, ...extra }
}
let ipCounter = 0
function request(raw: string, headers: Record<string, string> = {}) {
  ipCounter += 1
  return new Request(`${ORIGIN}/api/public/events`, {
    method: 'POST',
    headers: {
      host: 'localhost:3454',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'text/plain;charset=UTF-8',
      'user-agent': PHONE,
      'x-forwarded-for': `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
      ...headers,
    },
    body: raw,
  })
}
async function rows(visit: string) {
  return prisma.analyticsEvent.findMany({ where: { visitId: visit }, orderBy: { id: 'asc' } })
}

async function cleanup() {
  await prisma.analyticsEvent.deleteMany({ where: { visitId: { in: VISITS } } })
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP493E-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp493e-' } } })
}

before(async () => {
  await cleanup()
  const cat = await prisma.category.create({ data: { name: 'zp493e cat', slug: 'zp493e-cat', published: true } })
  const p = await prisma.product.create({
    data: { itemNumber: 'ZP493E-1', productName: 'ZP493E 1', categoryId: cat.id, published: true, publishedAt: new Date(), slug: 'zp493e-linen' },
  })
  publicId = p.id
  await prisma.product.create({
    data: { itemNumber: 'ZP493E-2', productName: 'ZP493E 2', categoryId: cat.id, published: false, slug: 'zp493e-draft' },
  })
  hiddenSlug = 'zp493e-draft'
})
after(async () => {
  await cleanup()
  await prisma.$disconnect()
})
beforeEach(async () => {
  await prisma.analyticsEvent.deleteMany({ where: { visitId: { in: VISITS } } })
})

describe('POST /api/public/events', () => {
  test('stores a sendBeacon batch (text/plain) and answers 204 with no body', async () => {
    const visit = VISITS[0]
    const res = await POST(
      request(
        body(visit, [
          ev('visit_start', { ref: 'direct', device: 'phone', vw: 390, vh: 844, lang: 'en', landing: '/', returning: false }),
          ev('look_view', { position: 0 }, { slug: 'zp493e-linen', collection: 'new' }),
          ev('look_dwell', { seconds: 3.5 }, { slug: 'zp493e-linen', collection: 'new' }),
        ]),
      ) as never,
    )
    assert.strictEqual(res.status, 204)
    assert.strictEqual(await res.text(), '')
    assert.strictEqual(res.headers.get('cache-control'), 'no-store')
    const stored = await rows(visit)
    assert.deepStrictEqual(stored.map((r) => r.type), ['visit_start', 'look_view', 'look_dwell'])
    const view = stored[1]
    assert.strictEqual(view.slug, 'zp493e-linen')
    assert.strictEqual(view.productId, publicId)
    assert.strictEqual(view.collection, 'new')
    assert.strictEqual(view.deviceId, DEVICE)
    assert.strictEqual(view.page, '/')
    assert.ok(view.day instanceof Date)
    assert.deepStrictEqual(stored[2].props, { seconds: 3.5 })
    // Nothing personal: the table has no IP / user agent / referrer URL columns.
    const columns = Object.keys(stored[0]).sort()
    assert.deepStrictEqual(columns, [
      'collection', 'day', 'deviceId', 'id', 'occurredAt', 'page', 'productId', 'props', 'receivedAt', 'slug', 'type', 'visitId',
    ])
  })

  test('accepts fetch with application/json', async () => {
    const res = await POST(request(body(VISITS[1], [ev('guide_shown')]), { 'content-type': 'application/json' }) as never)
    assert.strictEqual(res.status, 204)
    assert.strictEqual((await rows(VISITS[1])).length, 1)
  })

  test('events about unpublished or unknown pieces are dropped, the rest kept', async () => {
    const visit = VISITS[2]
    const res = await POST(
      request(
        body(visit, [
          ev('look_view', {}, { slug: hiddenSlug }),
          ev('look_view', {}, { slug: 'zp493e-never-existed' }),
          ev('look_view', {}, { slug: 'zp493e-linen' }),
          ev('guide_shown'),
        ]),
      ) as never,
    )
    assert.strictEqual(res.status, 204)
    assert.deepStrictEqual((await rows(visit)).map((r) => [r.type, r.slug]), [
      ['look_view', 'zp493e-linen'],
      ['guide_shown', null],
    ])
  })

  test('unknown events, unknown fields, bad values: 400, nothing stored', async () => {
    const visit = VISITS[3]
    for (const raw of [
      body(visit, [ev('guide_shown'), ev('page_view')]),
      body(visit, [ev('guide_shown', { phone: '0771234567' })]),
      body(visit, [ev('guide_shown')], { ip: '1.2.3.4' }),
      body(visit, [ev('look_dwell', { seconds: 999 }, { slug: 'zp493e-linen' })]),
      body('not-a-uuid', [ev('guide_shown')]),
      '{"v":1,',
      '',
    ]) {
      const res = await POST(request(raw) as never)
      assert.strictEqual(res.status, 400, raw)
    }
    assert.strictEqual((await rows(visit)).length, 0)
  })

  test('more than 50 events: 400', async () => {
    const visit = VISITS[4]
    const res = await POST(request(body(visit, Array.from({ length: 51 }, () => ev('guide_shown')))) as never)
    assert.strictEqual(res.status, 400)
    assert.strictEqual((await rows(visit)).length, 0)
  })

  test('oversized body: 413 (by Content-Length and by actual size)', async () => {
    const big = 'x'.repeat(MAX_BODY_BYTES + 1)
    const res1 = await POST(request(big, { 'content-length': String(big.length) }) as never)
    assert.strictEqual(res1.status, 413)
    const res2 = await POST(request(big) as never)
    assert.strictEqual(res2.status, 413)
  })

  test('wrong content type: 415', async () => {
    const res = await POST(request(body(VISITS[5], [ev('guide_shown')]), { 'content-type': 'application/x-www-form-urlencoded' }) as never)
    assert.strictEqual(res.status, 415)
  })

  test('cross-site or missing Origin: 403, nothing stored', async () => {
    const visit = VISITS[5]
    for (const headers of <Record<string, string>[]>[
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
      { origin: '' },
      { origin: 'null' },
    ]) {
      const res = await POST(request(body(visit, [ev('guide_shown')]), headers) as never)
      assert.strictEqual(res.status, 403, JSON.stringify(headers))
    }
    assert.strictEqual((await rows(visit)).length, 0)
  })

  test('GPC or DNT: 204 and nothing stored', async () => {
    const visit = VISITS[6]
    for (const headers of <Record<string, string>[]>[{ 'sec-gpc': '1' }, { dnt: '1' }]) {
      const res = await POST(request(body(visit, [ev('guide_shown')]), headers) as never)
      assert.strictEqual(res.status, 204)
    }
    assert.strictEqual((await rows(visit)).length, 0)
  })

  test('bots and headless browsers: 204 and nothing stored', async () => {
    const visit = VISITS[7]
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 HeadlessChrome/130.0.0.0', '']) {
      const res = await POST(request(body(visit, [ev('guide_shown')]), { 'user-agent': ua }) as never)
      assert.strictEqual(res.status, 204)
    }
    assert.strictEqual((await rows(visit)).length, 0)
  })

  test('only POST is exported', async () => {
    const mod = await import('../src/app/api/public/events/route')
    assert.deepStrictEqual(Object.keys(mod).filter((k) => /^[A-Z]+$/.test(k)), ['POST'])
  })
})

describe('rate limits', () => {
  test('per IP (in memory only): 429 with Retry-After', async () => {
    const handler = createEventsHandler({
      ipLimiter: new TokenBucketLimiter({ capacity: 2, refillPerSecond: 0.001 }),
      visitLimiter: new TokenBucketLimiter({ capacity: 100, refillPerSecond: 1 }),
    })
    const headers = { 'x-forwarded-for': '10.200.0.1' }
    assert.strictEqual((await handler(request(body(VISITS[8], [ev('guide_shown')]), headers))).status, 204)
    assert.strictEqual((await handler(request(body(VISITS[9], [ev('guide_shown')]), headers))).status, 204)
    const res = await handler(request(body(VISITS[10], [ev('guide_shown')]), headers))
    assert.strictEqual(res.status, 429)
    assert.ok(Number(res.headers.get('retry-after')) >= 1)
    assert.strictEqual((await rows(VISITS[10])).length, 0)
    // Another address is not affected.
    assert.strictEqual((await handler(request(body(VISITS[10], [ev('guide_shown')]), { 'x-forwarded-for': '10.200.0.2' }))).status, 204)
  })

  test('per visit: a flood from one visit id is cut off whatever the address', async () => {
    const handler = createEventsHandler({
      ipLimiter: new TokenBucketLimiter({ capacity: 100, refillPerSecond: 1 }),
      visitLimiter: new TokenBucketLimiter({ capacity: 2, refillPerSecond: 0.001 }),
    })
    const visit = VISITS[11]
    assert.strictEqual((await handler(request(body(visit, [ev('guide_shown')])))).status, 204)
    assert.strictEqual((await handler(request(body(visit, [ev('guide_shown')])))).status, 204)
    assert.strictEqual((await handler(request(body(visit, [ev('guide_shown')])))).status, 429)
    assert.strictEqual((await rows(visit)).length, 2)
  })
})
