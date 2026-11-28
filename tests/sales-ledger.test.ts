// ZP-1118 (MM-13): the money rules of the sales ledger and the sales report. Pure: no database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  allocatePayments, harareDay, isCredited, saleAndRefundEvents, saleMoney, salesReport,
  type LedgerRefund, type LedgerSale, type MoneyEvent, type ReportAttribution,
} from '../src/lib/sales-ledger'

const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`)
const sale = (id: number, day: string, o: Partial<LedgerSale> = {}): LedgerSale => ({ id, saleDate: at(day), status: 'COMPLETED', totalAmount: 0, cashAmount: 0, creditAmount: 0, ...o })
const refund = (id: number, saleId: number, day: string, amount: number, o: Partial<LedgerRefund> = {}): LedgerRefund => ({ id, saleId, refundDate: at(day), amount, method: 'CASH', voidedAt: null, ...o })
const credited = (saleId: number, campaignId: number, channelKind = 'FACEBOOK_PAGE'): ReportAttribution => ({ saleId, source: 'TRACKED_LINK', campaignId, channelKind, needsReview: false })

// AT-09: A collected 65 linked to X; B collected 40 unknown; C unpaid order of 50.
const A = sale(1, '2031-03-10', { totalAmount: 65, cashAmount: 65 })
const B = sale(2, '2031-03-10', { totalAmount: 40, cashAmount: 40 })
const C = sale(3, '2031-03-10', { totalAmount: 50, creditAmount: 50 })
const X = 7

function at09(refunds: LedgerRefund[] = [], extraEvents: MoneyEvent[] = []) {
  const sales = [A, B, C]
  return salesReport({ from: '2031-03-10', to: '2031-03-12', sales, events: [...saleAndRefundEvents(sales, refunds), ...extraEvents], attributions: [credited(A.id, X)] })
}

describe('harareDay', () => {
  test('the day turns at midnight Harare time (UTC+2)', () => {
    assert.strictEqual(harareDay(new Date('2031-03-10T21:59:00Z')), '2031-03-10')
    assert.strictEqual(harareDay(new Date('2031-03-10T22:00:00Z')), '2031-03-11')
  })
})

describe('AT-09 money and attribution fixture', () => {
  test('all-shop collected 105, X 65, the unpaid order collects nothing', () => {
    const r = at09()
    assert.strictEqual(r.allShop.collectedCents, 10500)
    assert.strictEqual(r.allShop.netCents, 10500)
    assert.strictEqual(r.allShop.salesCount, 3)
    assert.strictEqual(r.allShop.billedCents, 15500, 'billed counts the order, collected does not')
    assert.deepStrictEqual(r.campaigns.map((c) => [c.campaignId, c.netCents]), [[X, 6500]])
    assert.strictEqual(r.uncredited.netCents, 4000, 'B is unknown and C collected nothing')
    assert.deepStrictEqual(r.uncredited.saleIds.sort(), [B.id, C.id])
    assert.ok(r.reconciles)
  })
  test('a later refund of 10 against A: net 95 overall and 55 for X across the period', () => {
    const r = at09([refund(1, A.id, '2031-03-12', 10)])
    assert.strictEqual(r.allShop.collectedCents, 10500)
    assert.strictEqual(r.allShop.refundedCents, 1000)
    assert.strictEqual(r.allShop.netCents, 9500)
    assert.strictEqual(r.campaigns[0].netCents, 5500)
    assert.ok(r.reconciles)
  })
  test('the refund lands on its own date, not the sale date', () => {
    const sales = [A, B, C]
    const events = saleAndRefundEvents(sales, [refund(1, A.id, '2031-03-12', 10)])
    const onSaleDay = salesReport({ from: '2031-03-10', to: '2031-03-10', sales, events, attributions: [credited(A.id, X)] })
    const onRefundDay = salesReport({ from: '2031-03-12', to: '2031-03-12', sales, events, attributions: [credited(A.id, X)] })
    assert.strictEqual(onSaleDay.allShop.netCents, 10500)
    assert.strictEqual(onRefundDay.allShop.netCents, -1000)
    assert.strictEqual(onRefundDay.allShop.salesCount, 0)
    assert.strictEqual(onRefundDay.campaigns[0].netCents, -1000)
  })
  test('processing the same rows twice changes no total (one attribution per sale, one event per row)', () => {
    const r = salesReport({
      from: '2031-03-10', to: '2031-03-12', sales: [A, B, C],
      events: saleAndRefundEvents([A, B, C], [refund(1, A.id, '2031-03-12', 10)]),
      attributions: [credited(A.id, X), credited(A.id, X)],
    })
    assert.strictEqual(r.allShop.netCents, 9500)
    assert.strictEqual(r.campaigns[0].netCents, 5500)
    assert.strictEqual(r.campaigns[0].salesCount, 1)
  })
})

describe('refunds, voids and cancellations', () => {
  test('a voided refund comes back on the void date and the row still shows', () => {
    const r = refund(1, A.id, '2031-03-11', 10, { voidedAt: at('2031-03-12') })
    const ev = saleAndRefundEvents([A], [r])
    assert.deepStrictEqual(ev.map((e) => [e.kind, e.day, e.cents]), [['CASH_SALE', '2031-03-10', 6500], ['REFUND', '2031-03-11', -1000], ['REFUND_VOIDED', '2031-03-12', 1000]])
    assert.deepStrictEqual(saleMoney(A, ev, [r]), { collectedCents: 6500, cashRefundedCents: 0, creditRefundedCents: 0, outstandingCents: 0 })
  })
  test('a credit refund is never collected money; it lowers what is owed', () => {
    const r = refund(1, C.id, '2031-03-11', 20, { method: 'CREDIT' })
    const ev = saleAndRefundEvents([C], [r])
    assert.deepStrictEqual(ev, [])
    assert.strictEqual(saleMoney(C, ev, [r]).outstandingCents, 3000)
  })
  test('a cancelled sale counts nowhere, but is counted as cancelled', () => {
    const D = sale(4, '2031-03-10', { totalAmount: 30, creditAmount: 30, status: 'CANCELLED' })
    const r = salesReport({ from: '2031-03-10', to: '2031-03-10', sales: [A, D], events: saleAndRefundEvents([A, D], []), attributions: [credited(D.id, X)] })
    assert.strictEqual(r.allShop.salesCount, 1)
    assert.strictEqual(r.allShop.cancelledCount, 1)
    assert.strictEqual(r.allShop.billedCents, 6500)
    assert.deepStrictEqual(r.campaigns, [])
    assert.strictEqual(saleMoney(D, [], []).outstandingCents, 0)
  })
})

describe('debtor payments are allocated oldest debt first', () => {
  test('opening balance first, then sales by date; each payment keeps its date; overpayment is not a sale', () => {
    const debts = [
      { saleId: 11, date: at('2031-03-05'), cents: 3000 },
      { saleId: null, date: new Date(0), cents: 1000 },
      { saleId: 12, date: at('2031-03-08'), cents: 2000 },
    ]
    const ev = allocatePayments(debts, [{ id: 2, date: at('2031-03-20'), cents: 2500 }, { id: 1, date: at('2031-03-15'), cents: 2000 }, { id: 3, date: at('2031-03-25'), cents: 3000 }])
    assert.deepStrictEqual(ev.map((e) => [e.saleId, e.day, e.cents]), [
      [null, '2031-03-15', 1000], [11, '2031-03-15', 1000],
      [11, '2031-03-20', 2000], [12, '2031-03-20', 500],
      [12, '2031-03-25', 1500], [null, '2031-03-25', 1500],
    ])
  })
  test('a payment for an unpaid order makes it collected on the payment date, in its own bucket', () => {
    const pay = allocatePayments([{ saleId: C.id, date: C.saleDate, cents: 5000 }], [{ id: 1, date: at('2031-03-11'), cents: 2000 }])
    const r = at09([], pay)
    assert.strictEqual(r.allShop.collectedCents, 12500)
    assert.strictEqual(r.uncredited.netCents, 6000)
    assert.strictEqual(saleMoney(C, pay, []).outstandingCents, 3000)
    assert.ok(r.reconciles)
  })
  test('money for an opening balance is all-shop money, never a campaign or an uncredited sale', () => {
    const pay = allocatePayments([{ saleId: null, date: new Date(0), cents: 1500 }], [{ id: 1, date: at('2031-03-11'), cents: 1500 }])
    const r = at09([], pay)
    assert.strictEqual(r.notASale.netCents, 1500)
    assert.strictEqual(r.allShop.netCents, 12000)
    assert.strictEqual(r.uncredited.netCents, 4000)
    assert.ok(r.reconciles)
  })
})

describe('attribution in the report', () => {
  test('unknown, waiting for review, or no campaign: never credited', () => {
    assert.strictEqual(isCredited(undefined), false)
    assert.strictEqual(isCredited({ saleId: 1, source: 'UNKNOWN', campaignId: null, channelKind: null, needsReview: false }), false)
    assert.strictEqual(isCredited({ saleId: 1, source: 'CUSTOMER_REPORTED', campaignId: 3, channelKind: null, needsReview: true }), false)
    assert.strictEqual(isCredited({ saleId: 1, source: 'CUSTOMER_REPORTED', campaignId: 3, channelKind: null, needsReview: false }), true)
  })
  test('channels add up to the credited campaigns; customer-reported with no channel is its own row', () => {
    const sales = [A, B, sale(5, '2031-03-11', { totalAmount: 20, cashAmount: 20 })]
    const r = salesReport({
      from: '2031-03-10', to: '2031-03-12', sales, events: saleAndRefundEvents(sales, []),
      attributions: [credited(A.id, X, 'INSTAGRAM'), { saleId: 5, source: 'CUSTOMER_REPORTED', campaignId: 8, channelKind: null, needsReview: false }],
    })
    assert.deepStrictEqual(r.channels.map((c) => [c.channelKind, c.netCents]), [['INSTAGRAM', 6500], ['UNKNOWN', 2000]])
    assert.deepStrictEqual(r.campaigns.map((c) => [c.campaignId, c.netCents]), [[X, 6500], [8, 2000]])
    assert.strictEqual(r.uncredited.netCents, 4000)
    assert.ok(r.reconciles)
  })
  test('a late sale keeps its own date in the report', () => {
    const late = sale(6, '2031-04-02', { totalAmount: 15, cashAmount: 15 })
    const r = salesReport({ from: '2031-04-01', to: '2031-04-30', sales: [late], events: saleAndRefundEvents([late], []), attributions: [credited(late.id, X)] })
    assert.strictEqual(r.campaigns[0].netCents, 1500)
    const march = salesReport({ from: '2031-03-01', to: '2031-03-31', sales: [late], events: saleAndRefundEvents([late], []), attributions: [credited(late.id, X)] })
    assert.deepStrictEqual(march.campaigns, [])
  })
})
