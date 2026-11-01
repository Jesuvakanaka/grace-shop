// ZP-510: the nightly rollup counts the feed's details sheet opening
// (details_sheet_open) as opening the piece (product_open, "from the sheet"):
// - AnalyticsDailyJourney: a visit that opened the sheet reached the "opened a piece" step.
// - AnalyticsDailyPiece.productOpens: distinct visits that opened the piece
//   either way (ZP-506's OPEN_TYPES).
// details_sheet_close is not an open.
// Uses analytics days in 2037 and products "ZP510R-*".
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import prisma from '../src/lib/db'
import { analyticsDay, dayToDate } from '../src/lib/analytics/events'
import { rollupDay } from '../src/lib/analytics/rollup'

const D = '2037-04-14'
const V1 = '5c5c5c5c-0000-4000-8000-000000000001'
const V2 = '5c5c5c5c-0000-4000-8000-000000000002'
const V3 = '5c5c5c5c-0000-4000-8000-000000000003'
const VISITS = [V1, V2, V3]
const DEV = '5c5c5c5c-0000-4000-8000-0000000000dd'
const TABLES = ['analyticsDailyJourney', 'analyticsDailyDepth', 'analyticsDailyHour', 'analyticsDailyHealth', 'analyticsDailyOption',
  'analyticsDailyVisits', 'analyticsDailySource', 'analyticsDailyPiece', 'analyticsDailyPhoto', 'analyticsDailyVideo'] as const

let P1 = 0
let P2 = 0
let seq = 0
function row(visitId: string, type: string, opts: { productId?: number; slug?: string; props?: Record<string, unknown> } = {}) {
  seq += 1
  const occurredAt = new Date(new Date(`${D}T08:00:00Z`).getTime() + seq * 1000)
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
const start = { ref: 'instagram', device: 'phone', vw: 390, vh: 844, landing: '/', returning: false }

async function cleanup() {
  await prisma.analyticsEvent.deleteMany({ where: { visitId: { in: VISITS } } })
  const where = { day: { gte: dayToDate('2037-01-01'), lte: dayToDate('2037-12-31') } }
  for (const t of TABLES) await (prisma[t] as unknown as { deleteMany(a: unknown): Promise<unknown> }).deleteMany({ where })
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP510R-' } } })
}

before(async () => {
  await cleanup()
  P1 = (await prisma.product.create({ data: { itemNumber: 'ZP510R-1', productName: 'S1', slug: 'zp510r-one' } })).id
  P2 = (await prisma.product.create({ data: { itemNumber: 'ZP510R-2', productName: 'S2', slug: 'zp510r-two' } })).id
  const p1 = { productId: P1, slug: 'zp510r-one' }
  const p2 = { productId: P2, slug: 'zp510r-two' }
  await prisma.analyticsEvent.createMany({
    data: [
      // V1: one look, opens its details sheet, closes it by swiping. No product page.
      row(V1, 'visit_start', { props: start }),
      row(V1, 'look_view', { ...p1, props: { position: 0 } }),
      row(V1, 'details_sheet_open', p1),
      row(V1, 'details_sheet_close', { ...p1, props: { reason: 'swipe' } }),
      row(V1, 'visit_end', { ...p1, props: { duration: 30, looks: 1 } }),
      // V2: opens the sheet, then the full page from it (two opens of P1), picks a size in the sheet of P2.
      row(V2, 'visit_start', { props: start }),
      row(V2, 'look_view', { ...p1, props: { position: 0 } }),
      row(V2, 'details_sheet_open', p1),
      row(V2, 'product_open', { ...p1, props: { from: 'feed' } }),
      row(V2, 'details_sheet_open', p2),
      row(V2, 'size_select', { ...p2, props: { size: 'M' } }),
      row(V2, 'visit_end', { ...p2, props: { duration: 50, looks: 1 } }),
      // V3: only closes (a stray close is not an open).
      row(V3, 'visit_start', { props: start }),
      row(V3, 'look_view', { ...p2, props: { position: 0 } }),
      row(V3, 'details_sheet_close', { ...p2, props: { reason: 'back' } }),
      row(V3, 'visit_end', { ...p2, props: { duration: 9, looks: 1 } }),
    ],
  })
  await rollupDay(prisma, D)
})
after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

const day = dayToDate(D)

describe('ZP-510: a details sheet open counts as a product open', () => {
  test('journey: V1 (sheet only) reached "opened"; V2 reached "size"; V3 did not open', async () => {
    const rows = await prisma.analyticsDailyJourney.findMany({ where: { day } })
    assert.deepStrictEqual(
      rows.map((r) => [r.source, r.visits, r.reachedOpen, r.reachedSize, r.reachedWhatsapp]),
      [['instagram', 3, 2, 1, 0]],
    )
  })

  test('piece: productOpens = distinct visits that opened it by product_open or details_sheet_open (ZP-506)', async () => {
    const rows = await prisma.analyticsDailyPiece.findMany({ where: { day }, orderBy: { slug: 'asc' } })
    assert.deepStrictEqual(
      rows.map((r) => [r.slug, r.productOpens]),
      [
        // V1 (sheet) and V2 (sheet, then the full page: one visit).
        ['zp510r-one', 2],
        // V2 (sheet); V3 only closed.
        ['zp510r-two', 1],
      ],
    )
  })
})
