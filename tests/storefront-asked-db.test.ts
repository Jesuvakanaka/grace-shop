// ZP-513: "X people asked about it this week" (src/lib/storefront/asked-query.ts)
// against DATABASE_URL. Asked = distinct visits with whatsapp_enquire or
// restock_request for the piece in the last 7 analytics days (today and the
// 6 before, Harare) that also have a look_view or details_sheet_open for it in
// the window (review: harder to fake). Other events, other pieces and older days do not count.
// Uses visit ids 5b5b5b5b-… and products "ZP513A-*".
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import prisma from '../src/lib/db'
import { addDays, analyticsDay, dayToDate } from '../src/lib/analytics/events'
import { countAskedBySlug } from '../src/lib/storefront/asked-query'

const NOW = new Date()
const TODAY = analyticsDay(NOW)
const v = (n: number) => `5b5b5b5b-0000-4000-8000-${String(n).padStart(12, '0')}`
let P1 = 0
let P2 = 0

function row(visit: number, type: string, productId: number, slug: string, day: string) {
  return {
    eventId: randomUUID(),
    visitId: v(visit),
    deviceId: null,
    type,
    occurredAt: new Date(`${day}T08:00:00Z`),
    day: dayToDate(day),
    page: '/',
    slug,
    productId,
    collection: null,
    props: { screen: 'feed' } as object,
  }
}

async function cleanup() {
  await prisma.analyticsEvent.deleteMany({ where: { visitId: { in: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(v) } } })
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP513A-' } } })
}

before(async () => {
  await cleanup()
  P1 = (await prisma.product.create({ data: { itemNumber: 'ZP513A-1', productName: 'A1', slug: 'zp513a-one' } })).id
  P2 = (await prisma.product.create({ data: { itemNumber: 'ZP513A-2', productName: 'A2', slug: 'zp513a-two' } })).id
  await prisma.analyticsEvent.createMany({
    data: [
      // P1: visits 1, 2, 3 saw the look (or its sheet) and asked this week (visit 1 twice, one a restock);
      // visit 4 asked eight days ago.
      row(1, 'look_view', P1, 'zp513a-one', TODAY),
      row(2, 'details_sheet_open', P1, 'zp513a-one', addDays(TODAY, -6)),
      row(3, 'look_view', P1, 'zp513a-one', addDays(TODAY, -3)),
      row(4, 'look_view', P1, 'zp513a-one', addDays(TODAY, -7)),
      row(1, 'whatsapp_enquire', P1, 'zp513a-one', TODAY),
      row(1, 'restock_request', P1, 'zp513a-one', addDays(TODAY, -1)),
      row(2, 'whatsapp_enquire', P1, 'zp513a-one', addDays(TODAY, -6)),
      row(3, 'restock_request', P1, 'zp513a-one', addDays(TODAY, -3)),
      row(4, 'whatsapp_enquire', P1, 'zp513a-one', addDays(TODAY, -7)),
      // Not asking: a look view and a share.
      row(5, 'look_view', P1, 'zp513a-one', TODAY),
      row(6, 'share', P1, 'zp513a-one', TODAY),
      // P2: one visit that saw it and asked.
      row(7, 'look_view', P2, 'zp513a-two', TODAY),
      row(7, 'whatsapp_enquire', P2, 'zp513a-two', TODAY),
      // Review: faked asks, never shown the piece (no look_view / details_sheet_open for it): not counted.
      row(8, 'whatsapp_enquire', P1, 'zp513a-one', TODAY),
      row(9, 'restock_request', P1, 'zp513a-one', TODAY),
      row(9, 'look_view', P2, 'zp513a-two', TODAY), // saw another piece only
    ],
  })
})
after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

describe('countAskedBySlug', () => {
  test('distinct visits per piece over the last 7 analytics days, only visits that saw the piece', async () => {
    const asked = await countAskedBySlug(prisma, NOW)
    assert.strictEqual(asked['zp513a-one'], 3)
    assert.strictEqual(asked['zp513a-two'], 1)
  })
})
