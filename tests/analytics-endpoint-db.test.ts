// ZP-493: POST /api/public/events against DATABASE_URL.
// - 204 and rows stored for a valid batch (sendBeacon text/plain or fetch JSON).
// - Invalid events are dropped one by one; only a bad envelope is a 400.
// - Slugs must be published pieces; size / colour must be one of the piece's
//   own options (else the prop is dropped).
// - Event ids make retries and replays idempotent (skipDuplicates).
// - Rejected: > 20 events / bad envelope (400), oversized body (413), wrong
//   content type (415), cross-site (403), floods (429: per-IP event budget,
//   new visit ids per IP per hour, per-visit budget, events per visit per day).
// - Dropped without storing (204): GPC / DNT, bots and headless browsers,
//   staff with a valid admin session.
// - Nothing personal stored: no IP or user agent column, ids are random UUIDs.
// Only touches rows it creates (item numbers "ZP493E-*", slugs "zp493e-*",
// analytics rows of the visit ids below).
import { describe, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp493-endpoint-tests-secret-0123456789abcdef'

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import { POST } from '../src/app/api/public/events/route'
import { createEventsHandler, MAX_BODY_BYTES } from '../src/lib/analytics/ingest'
import { DailyCounter, EventBudget, NewVisitLimiter } from '../src/lib/analytics/limits'

const VISITS = Array.from({ length: 20 }, (_, i) => `7a7a7a7a-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
const DEVICE = '7d7d7d7d-0000-4000-8000-000000000001'
const ORIGIN = 'http://localhost:3454'
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'

let publicId = 0
const hiddenSlug = 'zp493e-draft'

function body(visit: string, events: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ v: 1, visit, device: DEVICE, events, ...extra })
}
function ev(type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { id: randomUUID(), type, at: Date.now() - 1_000, page: '/', props, ...extra }
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
/** Generous limits so only the limit under test bites. */
function handlerWith(overrides: Partial<Parameters<typeof createEventsHandler>[0]> = {}) {
  return createEventsHandler({
    ipBudget: new EventBudget({ capacity: 10_000, refillPerSecond: 100 }),
    visitBudget: new EventBudget({ capacity: 10_000, refillPerSecond: 100 }),
    visitDaily: new DailyCounter({ limit: 100_000 }),
    newVisits: new NewVisitLimiter({ perHour: 1_000 }),
    ...overrides,
  })
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
    data: {
      itemNumber: 'ZP493E-1',
      productName: 'ZP493E 1',
      categoryId: cat.id,
      published: true,
      publishedAt: new Date(),
      slug: 'zp493e-linen',
      sizes: 'S, M, UK 10',
      colours: 'Black; Olive green',
    },
  })
  publicId = p.id
  await prisma.product.create({
    data: { itemNumber: 'ZP493E-2', productName: 'ZP493E 2', categoryId: cat.id, published: false, slug: hiddenSlug },
  })
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
      ),
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
    assert.deepStrictEqual(Object.keys(stored[0]).sort(), [
      'collection', 'day', 'deviceId', 'eventId', 'id', 'occurredAt', 'page', 'productId', 'props', 'receivedAt', 'slug', 'type', 'visitId',
    ])
  })

  test('accepts fetch with application/json', async () => {
    const res = await POST(request(body(VISITS[1], [ev('guide_shown')]), { 'content-type': 'application/json' }))
    assert.strictEqual(res.status, 204)
    assert.strictEqual((await rows(VISITS[1])).length, 1)
  })

  test('a retried or replayed batch is stored once (event ids)', async () => {
    const raw = body(VISITS[2], [ev('guide_shown'), ev('guide_step', { step: 1 })])
    assert.strictEqual((await POST(request(raw))).status, 204)
    assert.strictEqual((await POST(request(raw))).status, 204)
    assert.strictEqual((await rows(VISITS[2])).length, 2)
  })

  test('events about unpublished or unknown pieces are dropped, the rest kept', async () => {
    const visit = VISITS[3]
    const res = await POST(
      request(
        body(visit, [
          ev('look_view', {}, { slug: hiddenSlug }),
          ev('look_view', {}, { slug: 'zp493e-never-existed' }),
          ev('look_view', {}, { slug: 'zp493e-linen' }),
          ev('guide_shown'),
        ]),
      ),
    )
    assert.strictEqual(res.status, 204)
    assert.deepStrictEqual((await rows(visit)).map((r) => [r.type, r.slug]), [
      ['look_view', 'zp493e-linen'],
      ['guide_shown', null],
    ])
  })

  test('invalid events are dropped one by one, valid ones in the same batch kept', async () => {
    const visit = VISITS[4]
    const res = await POST(
      request(
        body(visit, [
          ev('page_view'),
          ev('guide_shown', { phone: '0771234567' }),
          ev('look_dwell', { seconds: 999 }, { slug: 'zp493e-linen' }),
          { ...ev('guide_shown'), id: 'not-a-uuid' },
          ev('guide_step', { step: 3 }),
        ]),
      ),
    )
    assert.strictEqual(res.status, 204)
    assert.deepStrictEqual((await rows(visit)).map((r) => r.type), ['guide_step'])
  })

  test('size and colour must be the piece\'s own options (case-insensitive), else the prop is dropped', async () => {
    const visit = VISITS[5]
    const linen = { slug: 'zp493e-linen' }
    const res = await POST(
      request(
        body(visit, [
          ev('size_select', { size: 'uk 10' }, linen),
          ev('size_select', { size: 'XXL' }, linen),
          ev('colour_select', { colour: 'olive GREEN' }, linen),
          ev('colour_select', { colour: 'Pink' }, linen),
          ev('whatsapp_enquire', { size: 'm​', colour: 'Red', screen: 'product' }, linen),
          ev('whatsapp_enquire', { size: 'M', screen: 'menu' }), // no piece: no options to match
        ]),
      ),
    )
    assert.strictEqual(res.status, 204)
    assert.deepStrictEqual(
      (await rows(visit)).map((r) => [r.type, r.props]),
      [
        ['size_select', { size: 'UK 10' }],
        ['size_select', {}],
        ['colour_select', { colour: 'Olive green' }],
        ['colour_select', {}],
        ['whatsapp_enquire', { size: 'M', screen: 'product' }],
        ['whatsapp_enquire', { screen: 'menu' }],
      ],
    )
  })

  test('bad envelope: 400, nothing stored', async () => {
    const visit = VISITS[6]
    for (const raw of [
      body(visit, [ev('guide_shown')], { ip: '1.2.3.4' }),
      body('not-a-uuid', [ev('guide_shown')]),
      body(visit, []),
      body(visit, Array.from({ length: 21 }, () => ev('guide_shown'))),
      '{"v":1,',
      '',
    ]) {
      const res = await POST(request(raw))
      assert.strictEqual(res.status, 400, raw.slice(0, 60))
    }
    assert.strictEqual((await rows(visit)).length, 0)
  })

  test('oversized body: 413 (by Content-Length and by actual size)', async () => {
    const big = 'x'.repeat(MAX_BODY_BYTES + 1)
    assert.strictEqual((await POST(request(big, { 'content-length': String(big.length) }))).status, 413)
    assert.strictEqual((await POST(request(big))).status, 413)
  })

  test('wrong content type: 415', async () => {
    const res = await POST(request(body(VISITS[7], [ev('guide_shown')]), { 'content-type': 'application/x-www-form-urlencoded' }))
    assert.strictEqual(res.status, 415)
  })

  test('cross-site or missing Origin: 403, nothing stored', async () => {
    const visit = VISITS[7]
    for (const headers of [
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
      { origin: '' },
      { origin: 'null' },
    ] as Record<string, string>[]) {
      const res = await POST(request(body(visit, [ev('guide_shown')]), headers))
      assert.strictEqual(res.status, 403, JSON.stringify(headers))
    }
    assert.strictEqual((await rows(visit)).length, 0)
  })

  test('GPC or DNT: 204 and nothing stored', async () => {
    const visit = VISITS[8]
    for (const headers of [{ 'sec-gpc': '1' }, { dnt: '1' }] as Record<string, string>[]) {
      assert.strictEqual((await POST(request(body(visit, [ev('guide_shown')]), headers))).status, 204)
    }
    assert.strictEqual((await rows(visit)).length, 0)
  })

  test('bots and headless browsers: 204 and nothing stored', async () => {
    const visit = VISITS[9]
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 HeadlessChrome/130.0.0.0', '']) {
      assert.strictEqual((await POST(request(body(visit, [ev('guide_shown')]), { 'user-agent': ua }))).status, 204)
    }
    assert.strictEqual((await rows(visit)).length, 0)
  })

  test('staff with a valid admin session: 204 and nothing stored; an invalid token is a normal visitor', async () => {
    const visit = VISITS[10]
    const token = await createToken(1, 'owner', 'OWNER')
    assert.strictEqual((await POST(request(body(visit, [ev('guide_shown')]), { cookie: `x=1; auth-token=${token}` }))).status, 204)
    assert.strictEqual((await rows(visit)).length, 0)
    assert.strictEqual((await POST(request(body(visit, [ev('guide_shown')]), { cookie: 'auth-token=forged.token.value' }))).status, 204)
    assert.strictEqual((await rows(visit)).length, 1)
  })

  test('only POST is exported', async () => {
    const mod = await import('../src/app/api/public/events/route')
    assert.deepStrictEqual(Object.keys(mod).filter((k) => /^[A-Z]+$/.test(k)), ['POST'])
  })
})

describe('rate limits (in memory; the IP is never stored)', () => {
  const full = (visit: string, n = 20) => body(visit, Array.from({ length: n }, () => ev('guide_shown')))

  test('per IP, by events: a request costs 1 + its events', async () => {
    const handler = handlerWith({ ipBudget: new EventBudget({ capacity: 30, refillPerSecond: 0.001 }) })
    const headers = { 'x-forwarded-for': '10.200.0.1' }
    assert.strictEqual((await handler(request(full(VISITS[11]), headers))).status, 204) // 21
    const res = await handler(request(full(VISITS[12], 10), headers)) // 11 more > 30
    assert.strictEqual(res.status, 429)
    assert.ok(Number(res.headers.get('retry-after')) >= 1)
    assert.strictEqual((await rows(VISITS[12])).length, 0)
    assert.strictEqual((await handler(request(full(VISITS[12], 5), { 'x-forwarded-for': '10.200.0.2' }))).status, 204)
  })

  test('new visit ids per IP per hour', async () => {
    const handler = handlerWith({ newVisits: new NewVisitLimiter({ perHour: 2 }) })
    const headers = { 'x-forwarded-for': '10.200.0.3' }
    assert.strictEqual((await handler(request(full(VISITS[13], 1), headers))).status, 204)
    assert.strictEqual((await handler(request(full(VISITS[14], 1), headers))).status, 204)
    assert.strictEqual((await handler(request(full(VISITS[15], 1), headers))).status, 429)
    assert.strictEqual((await handler(request(full(VISITS[13], 1), headers))).status, 204, 'a known visit continues')
  })

  test('per visit, by events, whatever the address', async () => {
    const handler = handlerWith({ visitBudget: new EventBudget({ capacity: 25, refillPerSecond: 0.001 }) })
    const visit = VISITS[16]
    assert.strictEqual((await handler(request(full(visit, 20)))).status, 204)
    assert.strictEqual((await handler(request(full(visit, 10)))).status, 429)
    assert.strictEqual((await rows(visit)).length, 20)
  })

  test('events per visit per day', async () => {
    const handler = handlerWith({ visitDaily: new DailyCounter({ limit: 30 }) })
    const visit = VISITS[17]
    assert.strictEqual((await handler(request(full(visit, 20)))).status, 204)
    assert.strictEqual((await handler(request(full(visit, 20)))).status, 429)
    assert.strictEqual((await handler(request(full(visit, 10)))).status, 204)
    assert.strictEqual((await rows(visit)).length, 30)
  })
})
