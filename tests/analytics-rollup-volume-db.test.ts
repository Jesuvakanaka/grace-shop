// ZP-493 (review M1): the rollup of a busy day finishes. 500,000 raw events
// (10,000 visits x 50 events, 40 pieces) are seeded with one INSERT ...
// SELECT generate_series and rolled up. With Prisma's default interactive
// transaction timeout (5 s) this failed at ~400k events/day.
// Uses analytics day 2032-01-15 only, and cleans it up.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import { dayToDate } from '../src/lib/analytics/events'
import { rollupDay, ROLLUP_TRANSACTION } from '../src/lib/analytics/rollup'

const DAY = '2032-01-15'
const EVENTS = 500_000
const PER_VISIT = 50
const PIECES = 40
const PRODUCT_BASE = 900_000

async function cleanup() {
  await prisma.$executeRawUnsafe(`DELETE FROM "AnalyticsEvent" WHERE day = $1::date`, DAY)
  for (const t of ['AnalyticsDailyVisits', 'AnalyticsDailySource', 'AnalyticsDailyPiece', 'AnalyticsDailyPhoto', 'AnalyticsDailyVideo']) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE day = $1::date`, DAY)
  }
}

before(async () => {
  await cleanup()
  // Per visit (g / 50): visit_start, 24 look_view + 24 look_dwell (2 s) on 40 pieces, visit_end (30 s, 24 looks).
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AnalyticsEvent" ("eventId", "occurredAt", day, "visitId", "deviceId", type, slug, "productId", page, props)
     SELECT gen_random_uuid(),
            TIMESTAMP '2032-01-15 06:00:00' + (g % 36000) * INTERVAL '1 second',
            $1::date,
            ('0e0e0e0e-0000-4000-8000-' || lpad((g / ${PER_VISIT})::text, 12, '0'))::uuid,
            NULL,
            CASE WHEN g % ${PER_VISIT} = 0 THEN 'visit_start'
                 WHEN g % ${PER_VISIT} = ${PER_VISIT - 1} THEN 'visit_end'
                 WHEN g % 2 = 0 THEN 'look_view' ELSE 'look_dwell' END,
            CASE WHEN g % ${PER_VISIT} IN (0, ${PER_VISIT - 1}) THEN NULL ELSE 'vol-' || (g % ${PIECES}) END,
            CASE WHEN g % ${PER_VISIT} IN (0, ${PER_VISIT - 1}) THEN NULL ELSE ${PRODUCT_BASE} + (g % ${PIECES}) END,
            '/',
            CASE WHEN g % ${PER_VISIT} = 0 THEN '{"ref":"direct","device":"phone","landing":"/","returning":false}'::jsonb
                 WHEN g % ${PER_VISIT} = ${PER_VISIT - 1} THEN '{"duration":30,"looks":24}'::jsonb
                 WHEN g % 2 = 0 THEN '{}'::jsonb ELSE '{"seconds":2}'::jsonb END
     FROM generate_series(0, ${EVENTS - 1}) AS g`,
    DAY,
  )
})
after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

describe('rollup at volume', () => {
  test('the transaction allows minutes, not the 5 s default', () => {
    assert.ok(ROLLUP_TRANSACTION.timeout >= 5 * 60_000)
    assert.ok(ROLLUP_TRANSACTION.maxWait >= 10_000)
  })

  test(`${EVENTS.toLocaleString('en')} events in one day roll up`, async () => {
    assert.strictEqual(await prisma.analyticsEvent.count({ where: { day: dayToDate(DAY) } }), EVENTS)
    const started = Date.now()
    const result = await rollupDay(prisma, DAY)
    const ms = Date.now() - started
    console.log(`# rollup of ${EVENTS} events: ${ms} ms`)
    assert.strictEqual(result.status, 'done')

    const visits = await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(DAY) } })
    assert.strictEqual(visits!.visits, EVENTS / PER_VISIT)
    assert.strictEqual(visits!.endedVisits, EVENTS / PER_VISIT)
    assert.strictEqual(visits!.totalSeconds, 30 * (EVENTS / PER_VISIT))
    assert.strictEqual(visits!.bounces, 0)

    const pieces = await prisma.analyticsDailyPiece.findMany({ where: { day: dayToDate(DAY) } })
    assert.strictEqual(pieces.length, PIECES)
    const views = pieces.reduce((n, p) => n + p.views, 0)
    const dwell = pieces.reduce((n, p) => n + p.dwellSeconds, 0)
    assert.strictEqual(views, 24 * (EVENTS / PER_VISIT))
    assert.strictEqual(dwell, 2 * 24 * (EVENTS / PER_VISIT))
  })
})
