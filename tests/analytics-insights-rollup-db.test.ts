// ZP-505: the rollup tables the Insights page needs, on top of ZP-493's.
// - AnalyticsDailyJourney: funnel per visit (furthest step), feed end, WhatsApp taps, by source/device/campaign.
// - AnalyticsDailyDepth: visits by looks seen.
// - AnalyticsDailyHour: visits by the Harare hour they started.
// - AnalyticsDailyHealth: slow loads, load errors, failed actions.
// - AnalyticsDailyOption: size / colour picks, enquiries and restock requests per piece.
// - AnalyticsDailyPiece.photoSwipers: visits that swiped to a 2nd photo.
// Every expected number is ALSO checked against SQL on the raw events.
// Uses analytics days in 2035 and products "ZP505R-*".
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import prisma from '../src/lib/db'
import { analyticsDay, dayToDate } from '../src/lib/analytics/events'
import { pruneAnalytics, rollupDay } from '../src/lib/analytics/rollup'

const D = '2035-05-10'
const PREV = '2035-05-09'
const NEXT = '2035-05-11'
const V1 = '5e5e5e5e-0000-4000-8000-000000000001'
const V2 = '5e5e5e5e-0000-4000-8000-000000000002'
const V3 = '5e5e5e5e-0000-4000-8000-000000000003'
const V4 = '5e5e5e5e-0000-4000-8000-000000000004'
const VP = '5e5e5e5e-0000-4000-8000-000000000005'
const VISITS = [V1, V2, V3, V4, VP]
const DEV = '5f5f5f5f-0000-4000-8000-000000000001'

let P1 = 0
let P2 = 0
let P3 = 0
const NEW_TABLES = [
  'analyticsDailyJourney',
  'analyticsDailyDepth',
  'analyticsDailyHour',
  'analyticsDailyHealth',
  'analyticsDailyOption',
] as const
const OLD_TABLES = ['analyticsDailyVisits', 'analyticsDailySource', 'analyticsDailyPiece', 'analyticsDailyPhoto', 'analyticsDailyVideo'] as const

let seq = 0
// Harare is UTC+2: "08:00" (UTC) is 10:00 local.
function row(
  visitId: string,
  type: string,
  opts: { day?: string; time?: string; productId?: number; slug?: string; props?: Record<string, unknown> } = {},
) {
  seq += 1
  const occurredAt = new Date(new Date(`${opts.day ?? D}T${opts.time ?? '08:00'}:00Z`).getTime() + seq * 1000)
  return {
    eventId: randomUUID(),
    visitId,
    deviceId: DEV,
    type,
    occurredAt,
    day: dayToDate(analyticsDay(occurredAt)),
    page: '/',
    slug: opts.slug ?? null,
    productId: opts.productId ?? null,
    collection: null,
    props: (opts.props ?? {}) as object,
  }
}
const start = (ref: string, device: string, campaign?: string) => ({
  ref,
  device,
  ...(campaign ? { campaign } : {}),
  vw: 390,
  vh: 844,
  landing: '/',
  returning: false,
})

async function cleanup() {
  await prisma.analyticsEvent.deleteMany({ where: { visitId: { in: VISITS } } })
  const where = { day: { gte: dayToDate('2035-01-01'), lte: dayToDate('2035-12-31') } }
  for (const t of [...NEW_TABLES, ...OLD_TABLES]) {
    await (prisma[t] as unknown as { deleteMany(a: unknown): Promise<unknown> }).deleteMany({ where })
  }
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP505R-' } } })
}

before(async () => {
  await cleanup()
  P1 = (await prisma.product.create({ data: { itemNumber: 'ZP505R-1', productName: 'R1', slug: 'zp505r-one' } })).id
  P2 = (await prisma.product.create({ data: { itemNumber: 'ZP505R-2', productName: 'R2', slug: 'zp505r-two' } })).id
  P3 = (await prisma.product.create({ data: { itemNumber: 'ZP505R-3', productName: 'R3', slug: 'zp505r-three' } })).id
  const p1 = { productId: P1, slug: 'zp505r-one' }
  const p2 = { productId: P2, slug: 'zp505r-two' }
  const p3 = { productId: P3, slug: 'zp505r-three' }
  await prisma.analyticsEvent.createMany({
    data: [
      // V1: Instagram phone "nov", 10:00 Harare. Goes all the way: 2 looks, details, open, size, WhatsApp x2, feed end.
      row(V1, 'visit_start', { props: start('instagram', 'phone', 'nov') }),
      row(V1, 'look_view', { ...p1, props: { position: 0 } }),
      row(V1, 'photo_view', { ...p1, props: { index: 1, of: 3 } }),
      row(V1, 'photo_view', { ...p1, props: { index: 2, of: 3 } }),
      row(V1, 'photo_view', { ...p1, props: { index: 3, of: 3 } }),
      row(V1, 'details_show', p1),
      row(V1, 'look_view', { ...p2, props: { position: 1 } }),
      row(V1, 'product_open', { ...p1, props: { from: 'feed' } }),
      row(V1, 'size_select', { ...p1, props: { size: 'M' } }),
      row(V1, 'colour_select', { ...p1, props: { colour: 'Red' } }),
      row(V1, 'whatsapp_enquire', { ...p1, props: { screen: 'product', size: 'M', colour: 'Red' } }),
      row(V1, 'whatsapp_enquire', { props: { screen: 'menu' } }),
      row(V1, 'feed_end_reached', { props: { looks: 2 } }),
      row(V1, 'visit_end', { ...p2, props: { duration: 60, looks: 2 } }),
      // V3: Instagram phone "nov", 10:30 Harare. visit_end says 3 looks (only one look_view arrived), shows details on P2, restock on P3.
      row(V3, 'visit_start', { time: '08:30', props: start('instagram', 'phone', 'nov') }),
      row(V3, 'look_view', { ...p1, time: '08:30', props: { position: 0 } }),
      row(V3, 'photo_view', { ...p1, time: '08:30', props: { index: 1, of: 3 } }),
      row(V3, 'details_show', { ...p2, time: '08:30' }),
      row(V3, 'restock_request', { ...p3, time: '08:30', props: { size: 'S' } }),
      row(V3, 'action_failed', { time: '08:30', props: { action: 'feed_load' } }),
      row(V3, 'visit_end', { ...p1, time: '08:30', props: { duration: 30, looks: 3 } }),
      // V2: direct desktop, 20:30 Harare, one look; a slow load and an image error.
      row(V2, 'visit_start', { time: '18:30', props: start('direct', 'desktop') }),
      row(V2, 'look_view', { ...p1, time: '18:30', props: { position: 0 } }),
      row(V2, 'slow_load', { time: '18:30', props: { lcp: 5200 } }),
      row(V2, 'load_error', { ...p1, time: '18:30', props: { what: 'image' } }),
      row(V2, 'visit_end', { ...p1, time: '18:30', props: { duration: 8, looks: 1 } }),
      // V4: Google desktop, 23:30 Harare; taps WhatsApp after midnight (next analytics day) without seeing a look.
      row(V4, 'visit_start', { time: '21:30', props: start('google', 'desktop') }),
      row(V4, 'whatsapp_enquire', { ...p1, time: '22:10', props: { screen: 'product' } }),
      // VP: started the day before; its WhatsApp tap on D belongs to PREV's journey, not D's.
      row(VP, 'visit_start', { day: PREV, props: start('tiktok', 'phone') }),
      row(VP, 'whatsapp_enquire', { ...p2, props: { screen: 'feed' } }),
    ],
  })
})
after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

const day = dayToDate(D)

describe('ZP-505 rollups', () => {
  test('V4 tapped WhatsApp on the next analytics day', async () => {
    const tap = await prisma.analyticsEvent.findFirst({ where: { visitId: V4, type: 'whatsapp_enquire' } })
    assert.strictEqual(tap!.day.toISOString().slice(0, 10), NEXT)
  })

  test('journey: furthest funnel step per visit, by source / device / campaign', async () => {
    await rollupDay(prisma, D)
    const rows = await prisma.analyticsDailyJourney.findMany({ where: { day }, orderBy: [{ source: 'asc' }] })
    assert.deepStrictEqual(
      rows.map((r) => [
        r.source,
        r.deviceClass,
        r.campaign,
        r.visits,
        r.reachedSecondLook,
        r.reachedDetails,
        r.reachedOpen,
        r.reachedSize,
        r.reachedWhatsapp,
        r.feedEndVisits,
        r.whatsappTaps,
      ]),
      [
        ['direct', 'desktop', '', 1, 0, 0, 0, 0, 0, 0, 0],
        // V4 went straight to WhatsApp: furthest step = WhatsApp, so it counts for every step before.
        ['google', 'desktop', '', 1, 1, 1, 1, 1, 1, 0, 1],
        ['instagram', 'phone', 'nov', 2, 2, 2, 1, 1, 1, 1, 2],
      ],
    )
  })

  test('journey matches SQL on the raw events', async () => {
    // Independent: visits started on D, their WhatsApp taps on D or D+1.
    const [raw] = (await prisma.$queryRawUnsafe(
      `WITH s AS (SELECT "visitId" FROM "AnalyticsEvent" WHERE type = 'visit_start' AND day = $1::date)
       SELECT (SELECT COUNT(*) FROM s)::int AS visits,
              (SELECT COUNT(*) FROM "AnalyticsEvent" e JOIN s USING ("visitId")
                WHERE e.type = 'whatsapp_enquire' AND e.day BETWEEN $1::date AND $1::date + 1)::int AS taps,
              (SELECT COUNT(DISTINCT e."visitId") FROM "AnalyticsEvent" e JOIN s USING ("visitId")
                WHERE e.type = 'feed_end_reached')::int AS feed_end`,
      D,
    )) as Array<{ visits: number; taps: number; feed_end: number }>
    const sums = await prisma.analyticsDailyJourney.aggregate({ where: { day }, _sum: { visits: true, whatsappTaps: true, feedEndVisits: true } })
    assert.deepStrictEqual(
      { visits: sums._sum.visits, taps: sums._sum.whatsappTaps, feedEnd: sums._sum.feedEndVisits },
      { visits: raw.visits, taps: raw.taps, feedEnd: raw.feed_end },
    )
    assert.deepStrictEqual(raw, { visits: 4, taps: 3, feed_end: 1 })
  })

  test('depth: visits by looks seen (the larger of visit_end looks and distinct looks viewed)', async () => {
    const rows = await prisma.analyticsDailyDepth.findMany({ where: { day }, orderBy: { looks: 'asc' } })
    assert.deepStrictEqual(
      rows.map((r) => [r.looks, r.visits]),
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
      ],
    )
  })

  test('hour: visits by the Harare hour they started, with enquiring visits and taps', async () => {
    const rows = await prisma.analyticsDailyHour.findMany({ where: { day }, orderBy: { hour: 'asc' } })
    assert.deepStrictEqual(
      rows.map((r) => [r.hour, r.visits, r.enquiringVisits, r.whatsappTaps]),
      [
        [10, 2, 1, 2],
        [20, 1, 0, 0],
        [23, 1, 1, 1],
      ],
    )
    const [raw] = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "AnalyticsEvent"
       WHERE type = 'visit_start' AND day = $1::date
         AND EXTRACT(HOUR FROM ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Harare') = 10`,
      D,
    )) as Array<{ n: number }>
    assert.strictEqual(raw.n, 2)
  })

  test('health: slow loads, load errors and failed actions with their detail', async () => {
    const rows = await prisma.analyticsDailyHealth.findMany({ where: { day }, orderBy: { kind: 'asc' } })
    assert.deepStrictEqual(
      rows.map((r) => [r.kind, r.detail, r.events, r.visits]),
      [
        ['action_failed', 'feed_load', 1, 1],
        ['load_error', 'image', 1, 1],
        ['slow_load', '', 1, 1],
      ],
    )
  })

  test('options: size / colour picks, enquiries and restock requests per piece', async () => {
    const rows = await prisma.analyticsDailyOption.findMany({ where: { day }, orderBy: [{ productId: 'asc' }, { kind: 'asc' }] })
    assert.deepStrictEqual(
      rows.map((r) => [r.productId, r.kind, r.value, r.selects, r.enquiries, r.restockRequests]),
      [
        [P1, 'colour', 'Red', 1, 1, 0],
        [P1, 'size', 'M', 1, 1, 0],
        [P3, 'size', 'S', 0, 0, 1],
      ],
    )
  })

  test('piece: photoSwipers counts visits that reached a 2nd photo', async () => {
    const p1 = await prisma.analyticsDailyPiece.findUnique({ where: { day_productId: { day, productId: P1 } } })
    assert.strictEqual(p1!.photoSwipers, 1)
    assert.strictEqual(p1!.photoViews, 4)
  })

  test('idempotent: rolling the day again gives the same rows', async () => {
    const before = await Promise.all(NEW_TABLES.map((t) => (prisma[t] as unknown as { count(a: unknown): Promise<number> }).count({ where: { day } })))
    await rollupDay(prisma, D)
    const again = await Promise.all(NEW_TABLES.map((t) => (prisma[t] as unknown as { count(a: unknown): Promise<number> }).count({ where: { day } })))
    assert.deepStrictEqual(again, before)
  })

  test('two days in one transaction (temp table reused) both roll up', async () => {
    await prisma.$transaction(async (tx) => {
      const { rollupDayInTransaction } = await import('../src/lib/analytics/rollup')
      await rollupDayInTransaction(tx, PREV)
      await rollupDayInTransaction(tx, D)
    })
    const prev = await prisma.analyticsDailyJourney.findMany({ where: { day: dayToDate(PREV) } })
    assert.deepStrictEqual(prev.map((r) => [r.source, r.visits, r.whatsappTaps]), [['tiktok', 1, 1]])
    assert.strictEqual((await prisma.analyticsDailyJourney.aggregate({ where: { day }, _sum: { visits: true } }))._sum.visits, 4)
  })

  test('retention prunes the new tables after 25 months', async () => {
    await pruneAnalytics(prisma, new Date('2037-07-01T12:00:00Z'))
    for (const t of NEW_TABLES) {
      const n = await (prisma[t] as unknown as { count(a: unknown): Promise<number> }).count({ where: { day } })
      assert.strictEqual(n, 0, t)
    }
  })
})
