// ZP-506 review: the ranking reads DISTINCT-VISIT columns of
// AnalyticsDailyPiece, so repeating an event in one visit counts once.
// - viewers (visits with a look_view) is the denominator;
// - numerators count only visits that also saw the look that day
//   (swiped to a 2nd photo, Show details, opened (OPEN_TYPES), enquired,
//   restock request, shared);
// - dwell: per visit the day's look_dwell seconds on the piece, capped at 60 s.
// Expected numbers are also checked against SQL on the raw events.
// Uses the analytics day 2036-02-10 only.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import prisma from '../src/lib/db'
import { analyticsDay, dayToDate } from '../src/lib/analytics/events'
import { OPEN_TYPES, RANK_DWELL_CAP_SECONDS, rollupDay } from '../src/lib/analytics/rollup'

const D = '2036-02-10'
const NOW = new Date('2036-02-12T08:00:00Z')
const PID = 950610
const SLUG = 'zp506-rollup-piece'
const V = Array.from({ length: 5 }, () => randomUUID())

let seq = 0
function ev(visitId: string, type: string, props: Record<string, unknown> = {}, productId: number | null = PID) {
  seq += 1
  const occurredAt = new Date(new Date(`${D}T08:00:00Z`).getTime() + seq * 1000)
  return {
    eventId: randomUUID(),
    visitId,
    deviceId: null,
    type,
    occurredAt,
    day: dayToDate(analyticsDay(occurredAt)),
    page: '/',
    slug: productId ? SLUG : null,
    productId,
    collection: null,
    props: props as object,
  }
}

async function cleanup() {
  await prisma.analyticsEvent.deleteMany({ where: { visitId: { in: V } } })
  for (const t of ['analyticsDailyPiece', 'analyticsDailyPhoto', 'analyticsDailyVisits'] as const) {
    await (prisma[t] as unknown as { deleteMany(a: unknown): Promise<unknown> }).deleteMany({ where: { day: dayToDate(D) } })
  }
}

describe('distinct-visit rollup columns for the ranking (ZP-506 review)', () => {
  before(async () => {
    await cleanup()
    const [v1, v2, v3, v4, v5] = V
    await prisma.analyticsEvent.createMany({
      data: [
        ev(v1, 'visit_start', { ref: 'direct', device: 'phone', vw: 390, vh: 844, landing: '/', returning: false }, null),
        // v1 spams: 2 views, 80 s of dwell, details x3, opens x2, WhatsApp x5, shares x2, loves x4.
        ev(v1, 'look_view', { position: 3 }),
        ev(v1, 'look_view', { position: 3 }),
        ev(v1, 'look_dwell', { seconds: 40 }),
        ev(v1, 'look_dwell', { seconds: 40 }),
        ev(v1, 'photo_view', { index: 2, of: 3 }),
        ev(v1, 'photo_view', { index: 3, of: 3 }),
        ev(v1, 'details_show'),
        ev(v1, 'details_show'),
        ev(v1, 'details_show'),
        ev(v1, 'product_open', { from: 'feed' }),
        ev(v1, 'product_open', { from: 'feed' }),
        ...Array.from({ length: 5 }, () => ev(v1, 'whatsapp_enquire', { screen: 'feed' })),
        ev(v1, 'share', { method: 'copy' }),
        ev(v1, 'share', { method: 'copy' }),
        ...Array.from({ length: 4 }, () => ev(v1, 'love_on')),
        // v2: an ordinary visit.
        ev(v2, 'look_view', { position: 0 }),
        ev(v2, 'look_dwell', { seconds: 10 }),
        ev(v2, 'details_show'),
        ev(v2, 'restock_request', {}),
        // v3: opened from a shared link without seeing the look in the feed: not in the ranking numerators.
        ev(v3, 'product_open', { from: 'shared' }),
        ev(v3, 'whatsapp_enquire', { screen: 'product' }),
        // v4: the ZP-510 details sheet counts as an open.
        ev(v4, 'look_view', { position: 1 }),
        ev(v4, 'details_sheet_open'),
        // v5: dwell without a view (late beacon): not counted.
        ev(v5, 'look_dwell', { seconds: 30 }),
      ],
    })
    const r = await rollupDay(prisma, D, { now: NOW })
    assert.strictEqual(r.status, 'done')
  })
  after(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('constants', () => {
    assert.deepStrictEqual([...OPEN_TYPES], ['product_open', 'details_sheet_open'])
    assert.strictEqual(RANK_DWELL_CAP_SECONDS, 60)
  })

  test('each visit counts once per piece and day; numerators only from visits that saw the look', async () => {
    const row = await prisma.analyticsDailyPiece.findUniqueOrThrow({ where: { day_productId: { day: dayToDate(D), productId: PID } } })
    assert.strictEqual(row.viewers, 3)
    assert.strictEqual(row.dwellVisits, 2)
    assert.strictEqual(row.dwellVisitSeconds, 60 + 10, 'v1 capped at 60 s')
    assert.strictEqual(row.swipeVisits, 1)
    assert.strictEqual(row.detailsVisits, 2)
    assert.strictEqual(row.openVisits, 2, 'v1 (product_open) and v4 (details_sheet_open); not v3')
    assert.strictEqual(row.enquiryVisits, 1, 'v1 once; v3 never saw the look')
    assert.strictEqual(row.restockVisits, 1)
    assert.strictEqual(row.shareVisits, 1)
    // The event counts the Insights page shows are unchanged.
    assert.strictEqual(row.enquiries, 6)
    assert.strictEqual(row.detailsShows, 4)
    assert.strictEqual(row.loveOn, 4)

    const [raw] = (await prisma.$queryRawUnsafe(
      `WITH pv AS (
         SELECT "visitId", BOOL_OR(type = 'look_view') AS viewed,
                LEAST(60, SUM((props->>'seconds')::float8) FILTER (WHERE type = 'look_dwell')) AS dwell,
                COUNT(*) FILTER (WHERE type = 'look_dwell') AS dwells,
                BOOL_OR(type = 'whatsapp_enquire') AS enq, BOOL_OR(type IN ('product_open', 'details_sheet_open')) AS opened
         FROM "AnalyticsEvent" WHERE day = $1::date AND "productId" = $2 GROUP BY "visitId")
       SELECT COUNT(*) FILTER (WHERE viewed)::int AS viewers,
              COALESCE(SUM(dwell) FILTER (WHERE viewed AND dwells > 0), 0)::float8 AS dwell,
              COUNT(*) FILTER (WHERE viewed AND enq)::int AS enq,
              COUNT(*) FILTER (WHERE viewed AND opened)::int AS opened
       FROM pv`,
      D,
      PID,
    )) as { viewers: number; dwell: number; enq: number; opened: number }[]
    assert.deepStrictEqual(
      { viewers: row.viewers, dwell: row.dwellVisitSeconds, enq: row.enquiryVisits, opened: row.openVisits },
      { viewers: raw.viewers, dwell: raw.dwell, enq: raw.enq, opened: raw.opened },
    )
  })
})
