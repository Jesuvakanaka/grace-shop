// ZP-544 / ZP-546: the feed-view A/B test against DATABASE_URL.
// - AnalyticsDailyFeedView: per (day, view) of TEST visits (visit_start with a
//   `view`): visits, distinct devices, visits that opened a piece (details
//   sheet or product page), with a WhatsApp tap, with a restock request.
//   Checked against SQL on the raw events; by the day the visit STARTED (a tap
//   after midnight still counts); idempotent; pruned with the other rollups.
// - Insights: the "Clean vs Info view" comparison from the rollups and live
//   days (read-only), null when the range has no test visits.
// Uses analytics days in 2039.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import prisma from '../src/lib/db'
import { analyticsDay, dayToDate } from '../src/lib/analytics/events'
import { rollupDay, ROLLUP_TABLES } from '../src/lib/analytics/rollup'
import { readInsights } from '../src/lib/insights/report'
import { resetLiveCache } from '../src/lib/insights/live'

const D = '2039-03-10'
const PREV = '2039-03-09'
const NEXT = '2039-03-11'
const EMPTY_DAY = '2039-03-20'
const V = Array.from({ length: 9 }, (_, i) => `5a5a5a5a-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
const DEV_A = '5b5b5b5b-0000-4000-8000-000000000001'
const DEV_B = '5b5b5b5b-0000-4000-8000-000000000002'
let P1 = 0

let seq = 0
function row(
  visitId: string,
  type: string,
  opts: { day?: string; time?: string; device?: string | null; withPiece?: boolean; props?: Record<string, unknown> } = {},
) {
  seq += 1
  const occurredAt = new Date(new Date(`${opts.day ?? D}T${opts.time ?? '08:00'}:00Z`).getTime() + seq * 1000)
  return {
    eventId: randomUUID(),
    visitId,
    deviceId: opts.device === undefined ? DEV_A : opts.device,
    type,
    occurredAt,
    day: dayToDate(analyticsDay(occurredAt)),
    page: '/',
    slug: opts.withPiece ? 'zp544-one' : null,
    productId: opts.withPiece ? P1 : null,
    collection: null,
    props: (opts.props ?? {}) as object,
  }
}
const start = (view?: string) => ({ ref: 'direct', device: 'phone', vw: 390, vh: 844, landing: '/', returning: false, ...(view ? { view } : {}) })

async function cleanup() {
  await prisma.analyticsEvent.deleteMany({ where: { visitId: { in: V } } })
  const where = { day: { gte: dayToDate('2039-01-01'), lte: dayToDate('2039-12-31') } }
  for (const t of ROLLUP_TABLES) {
    const key = (t[0].toLowerCase() + t.slice(1)) as 'analyticsDailyVisits'
    await (prisma[key] as unknown as { deleteMany(a: unknown): Promise<unknown> }).deleteMany({ where })
  }
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP544-' } } })
}

before(async () => {
  await cleanup()
  P1 = (await prisma.product.create({ data: { itemNumber: 'ZP544-1', productName: 'F1', slug: 'zp544-one' } })).id
  await prisma.analyticsEvent.createMany({
    data: [
      // V0 info, device A: opens via the details sheet, taps WhatsApp twice (one visit), asks for a restock.
      row(V[0], 'visit_start', { props: start('info') }),
      row(V[0], 'look_view', { withPiece: true, props: { position: 0 } }),
      row(V[0], 'details_sheet_open', { withPiece: true }),
      row(V[0], 'whatsapp_enquire', { withPiece: true, props: { screen: 'feed' } }),
      row(V[0], 'whatsapp_enquire', { withPiece: true, props: { screen: 'feed' } }),
      row(V[0], 'restock_request', { withPiece: true, props: { screen: 'feed' } }),
      // V1 info, device A again (same browser, second visit): only looks.
      row(V[1], 'visit_start', { time: '09:00', props: start('info') }),
      row(V[1], 'look_view', { time: '09:00', withPiece: true, props: { position: 0 } }),
      // V2 info, device B, starts 23:30 Harare; taps WhatsApp after midnight (next analytics day): counts for D.
      row(V[2], 'visit_start', { time: '21:30', device: DEV_B, props: start('info') }),
      row(V[2], 'whatsapp_enquire', { time: '22:10', device: DEV_B, withPiece: true, props: { screen: 'feed' } }),
      // V3 clean, no device id (storage blocked would not be a test visit, but a null device must not count as a device).
      row(V[3], 'visit_start', { device: null, props: start('clean') }),
      row(V[3], 'product_open', { device: null, withPiece: true, props: { from: 'feed' } }),
      // V4 clean, device B: details_show only (the eye), not an open.
      row(V[4], 'visit_start', { device: DEV_B, props: start('clean') }),
      row(V[4], 'details_show', { device: DEV_B, withPiece: true }),
      // V5 not a test visit (fixed setting / preview): never in the table.
      row(V[5], 'visit_start', { props: start() }),
      row(V[5], 'whatsapp_enquire', { withPiece: true, props: { screen: 'feed' } }),
      // V6 info visit that started the day before: its tap on D belongs to PREV.
      row(V[6], 'visit_start', { day: PREV, props: start('info') }),
      row(V[6], 'whatsapp_enquire', { withPiece: true, props: { screen: 'feed' } }),
      // V7: events on D without any visit_start (lost beacon): not counted.
      row(V[7], 'whatsapp_enquire', { withPiece: true, props: { screen: 'feed' } }),
    ],
  })
})
after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

const day = dayToDate(D)
const rowsOf = async (d: string) =>
  (await prisma.analyticsDailyFeedView.findMany({ where: { day: dayToDate(d) }, orderBy: { view: 'asc' } })).map((r) => ({
    view: r.view,
    visits: r.visits,
    devices: r.devices,
    openVisits: r.openVisits,
    enquiringVisits: r.enquiringVisits,
    restockVisits: r.restockVisits,
  }))

describe('ZP-544 AnalyticsDailyFeedView', () => {
  test('one row per view of the test visits that started that day', async () => {
    await rollupDay(prisma, D)
    assert.deepStrictEqual(await rowsOf(D), [
      { view: 'clean', visits: 2, devices: 1, openVisits: 1, enquiringVisits: 0, restockVisits: 0 },
      { view: 'info', visits: 3, devices: 2, openVisits: 1, enquiringVisits: 2, restockVisits: 1 },
    ])
  })

  test('matches SQL on the raw events', async () => {
    const raw = (await prisma.$queryRawUnsafe(
      `WITH s AS (
         SELECT DISTINCT ON ("visitId") "visitId", "deviceId", props->>'view' AS view
         FROM "AnalyticsEvent" WHERE type = 'visit_start' AND day = $1::date AND props ? 'view'
         ORDER BY "visitId", "occurredAt"
       )
       SELECT s.view,
              COUNT(*)::int AS visits,
              COUNT(DISTINCT s."deviceId")::int AS devices,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AnalyticsEvent" e WHERE e."visitId" = s."visitId"
                AND e.type IN ('product_open', 'details_sheet_open') AND e.day BETWEEN $1::date AND $1::date + 1))::int AS "openVisits",
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AnalyticsEvent" e WHERE e."visitId" = s."visitId"
                AND e.type = 'whatsapp_enquire' AND e.day BETWEEN $1::date AND $1::date + 1))::int AS "enquiringVisits",
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AnalyticsEvent" e WHERE e."visitId" = s."visitId"
                AND e.type = 'restock_request' AND e.day BETWEEN $1::date AND $1::date + 1))::int AS "restockVisits"
       FROM s WHERE s."visitId" = ANY($2::uuid[]) GROUP BY s.view ORDER BY s.view`,
      D,
      V,
    )) as Array<Record<string, unknown>>
    assert.deepStrictEqual(await rowsOf(D), raw)
  })

  test('the visit that started the day before counts there, not on D', async () => {
    await rollupDay(prisma, PREV)
    assert.deepStrictEqual(await rowsOf(PREV), [
      { view: 'info', visits: 1, devices: 1, openVisits: 0, enquiringVisits: 1, restockVisits: 0 },
    ])
  })

  test('the next day has no test visits: no rows', async () => {
    await rollupDay(prisma, NEXT)
    assert.deepStrictEqual(await rowsOf(NEXT), [])
  })

  test('re-running a day gives the same rows (idempotent)', async () => {
    const before = await rowsOf(D)
    await rollupDay(prisma, D)
    await rollupDay(prisma, D)
    assert.deepStrictEqual(await rowsOf(D), before)
    assert.strictEqual(await prisma.analyticsDailyFeedView.count({ where: { day } }), 2)
  })

  test('pruned after 25 months with the other rollups (pruneAnalytics deletes from every ROLLUP_TABLES table)', () => {
    // Not run against the DB here: pruneAnalytics with a future "now" would also delete every raw event of other tests.
    assert.ok(ROLLUP_TABLES.includes('AnalyticsDailyFeedView'))
  })
})

describe('ZP-546 Insights: Clean vs Info view', () => {
  const range = (from: string, to: string) => ({ preset: 'custom' as const, from, to, days: 1 + Math.round((dayToDate(to).getTime() - dayToDate(from).getTime()) / 86_400_000) })

  test('from the rollups: one column per view, counts and rates of visits', async () => {
    await rollupDay(prisma, D)
    const report = await readInsights(prisma, range(D, D), [], new Date(`${D}T12:00:00Z`))
    assert.ok(report.feedViews)
    const [clean, info] = report.feedViews.columns
    assert.deepStrictEqual(
      [clean.view, clean.visits, clean.openVisits, clean.whatsappVisits, clean.restockVisits],
      ['clean', 2, 1, 0, 0],
    )
    assert.deepStrictEqual([info.view, info.visits, info.openVisits, info.whatsappVisits, info.restockVisits], ['info', 3, 1, 2, 1])
    assert.strictEqual(info.whatsappRate, 2 / 3)
    assert.strictEqual(report.feedViews.verdict.kind, 'not-enough', 'never a winner on 5 visits')
  })

  test('live day (read-only) gives the same numbers as the rollup, and writes nothing', async () => {
    resetLiveCache()
    await prisma.analyticsDailyFeedView.deleteMany({ where: { day } })
    const report = await readInsights(prisma, range(D, D), [D], new Date(`${D}T12:00:00Z`))
    assert.deepStrictEqual(report.range.liveDays, [D])
    assert.ok(report.feedViews)
    assert.deepStrictEqual(
      report.feedViews.columns.map((c) => [c.view, c.visits, c.devices, c.openVisits, c.whatsappVisits, c.restockVisits]),
      [
        ['clean', 2, 1, 1, 0, 0],
        ['info', 3, 2, 1, 2, 1],
      ],
    )
    assert.strictEqual(await prisma.analyticsDailyFeedView.count({ where: { day } }), 0, 'live read stored nothing')
  })

  test('a range without test visits: null (section hidden)', async () => {
    const report = await readInsights(prisma, range(EMPTY_DAY, EMPTY_DAY), [], new Date(`${EMPTY_DAY}T12:00:00Z`))
    assert.strictEqual(report.feedViews, null)
  })
})
