// ZP-1118 (MM-13): refunds, cancellations, receipt keys and campaign links on the real sales ledger, against
// DATABASE_URL. AT-09 runs end to end. Only touches rows it creates: products ZP1118-*, sales on 2031-03 dates,
// the debtor "ZP1118 Customer", campaign/content/post/import rows it makes, and cash positions on its own days.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import { createSale, DuplicateSaleError } from '../src/lib/sales'
import { recordDebtorPayment } from '../src/lib/debtors'
import { updateCashPosition } from '../src/lib/cash'
import { ledgerDay } from '../src/lib/sales-ledger'
import { startOfDay } from 'date-fns'
import { cancelSale, moneyOfSale, recordRefund, saleWithMoney, voidRefund } from '../src/lib/sale-refunds'
import { getAttribution, linkSale, marketingSalesReport } from '../src/lib/marketing/sale-attribution'
import { confirmImport } from '../src/lib/import/importer'
import { WebsiteError } from '../src/lib/website/http'

const OWNER = 'zp1118-owner'
const CUSTOMER = 'ZP1118 Customer'
const at = (day: string) => new Date(`${day}T10:00:00.000Z`)
const DAYS = ['2031-03-10', '2031-03-11', '2031-03-12', '2031-03-13', '2031-03-14']
const rejects = async (fn: () => Promise<unknown>, status: number, re?: RegExp) => {
  await assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))
}

const productIds: number[] = []
const saleIds: number[] = []
const campaignIds: number[] = []
let contentId = 0
let postId = 0
const extraPostIds: number[] = []
let tag = ''
let importDocId = 0
const ids = { A: 0, B: 0, C: 0, D: 0, X: 0, Y: 0 }

async function product(n: number, qty = 10) {
  const p = await prisma.product.create({ data: { itemNumber: `ZP1118-${n}`, productName: `ZP1118 piece ${n}`, currentQuantity: qty, sellingPriceUsd: 10 } })
  productIds.push(p.id)
  return p.id
}
async function sale(o: Parameters<typeof createSale>[0]) {
  const s = await createSale({ createdBy: OWNER, ...o })
  saleIds.push(s.id)
  return s.id
}
const report = (from = '2031-03-10', to = '2031-03-14') => marketingSalesReport(prisma, { from, to })
const qty = async (id: number) => (await prisma.product.findUniqueOrThrow({ where: { id } })).currentQuantity

before(async () => {
  const p1 = await product(1)
  const p2 = await product(2)
  const p3 = await product(3)
  ids.X = (await prisma.marketingCampaign.create({ data: { name: 'ZP1118 X', status: 'ACTIVE', endsAt: at('2031-03-11') } })).id
  ids.Y = (await prisma.marketingCampaign.create({ data: { name: 'ZP1118 Y', status: 'ACTIVE' } })).id
  campaignIds.push(ids.X, ids.Y)
  contentId = (await prisma.marketingContent.create({ data: { title: 'ZP1118 content', campaignId: ids.X, createdBy: OWNER } })).id
  tag = 'mkzp1118tag001'
  postId = (await prisma.marketingPost.create({ data: { contentId, channelKind: 'INSTAGRAM', text: 'x', trackingTag: tag, status: 'PUBLISHED', publishedAt: at('2031-03-01') } })).id
  // AT-09: A collected 65, B collected 40, C an unpaid order of 50.
  ids.A = await sale({ saleDate: at('2031-03-10'), paymentType: 'CASH', items: [{ productId: p1, quantity: 1, unitPrice: 65 }], cashAmount: 65, receiptRef: 'ZP1118-R1' })
  ids.B = await sale({ saleDate: at('2031-03-10'), paymentType: 'CASH', items: [{ productId: p2, quantity: 2, unitPrice: 20 }], cashAmount: 40 })
  ids.C = await sale({ saleDate: at('2031-03-10'), paymentType: 'CREDIT', customerName: CUSTOMER, items: [{ productId: p3, quantity: 1, unitPrice: 50 }], creditAmount: 50 })
})

after(async () => {
  await prisma.marketingSaleAttribution.deleteMany({ where: { saleId: { in: saleIds } } })
  await prisma.saleRefund.deleteMany({ where: { saleId: { in: saleIds } } })
  await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } })
  await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } })
  await prisma.sale.deleteMany({ where: { id: { in: saleIds } } })
  const debtors = await prisma.debtor.findMany({ where: { customerName: CUSTOMER }, select: { id: true } })
  await prisma.debtorTransaction.deleteMany({ where: { debtorId: { in: debtors.map((d) => d.id) } } })
  await prisma.debtor.deleteMany({ where: { customerName: CUSTOMER } })
  await prisma.cashPosition.deleteMany({ where: { cashDate: { gte: new Date('2031-03-08T00:00:00Z'), lte: new Date('2031-03-18T00:00:00Z') } } })
  if (importDocId) {
    await prisma.importRow.deleteMany({ where: { importDocumentId: importDocId } })
    await prisma.importDocument.deleteMany({ where: { id: importDocId } })
  }
  await prisma.marketingPost.deleteMany({ where: { id: { in: [postId, ...extraPostIds] } } })
  await prisma.marketingContent.deleteMany({ where: { id: contentId } })
  await prisma.marketingCampaign.deleteMany({ where: { id: { in: campaignIds } } })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: OWNER } })
  await prisma.product.deleteMany({ where: { id: { in: productIds } } })
  await prisma.$disconnect()
})

describe('AT-09 against the real ledger', () => {
  test('A linked to X by its tracking tag: all-shop 105, X 65, C collects nothing', async () => {
    const { attribution } = await linkSale(prisma, ids.A, { source: 'TRACKED_LINK', trackingTag: tag.toUpperCase() }, OWNER)
    assert.strictEqual(attribution.campaignId, ids.X)
    assert.strictEqual(attribution.postId, postId)
    assert.strictEqual(attribution.channelKind, 'INSTAGRAM')
    assert.strictEqual(attribution.credited, true)
    assert.strictEqual(attribution.paymentEvidence, 'OWNER_RECORDED')
    const r = await report()
    assert.strictEqual(r.allShop.collected, 105)
    assert.strictEqual(r.allShop.billed, 155)
    assert.deepStrictEqual(r.campaigns.map((c) => [c.name, c.net]), [['ZP1118 X', 65]])
    assert.deepStrictEqual(r.uncredited.sales.map((s) => s.saleId).sort(), [ids.B, ids.C].sort())
    assert.strictEqual(r.uncredited.net, 40)
    assert.ok(r.reconciles)
    assert.match(r.note, /does not prove/)
  })

  test('MM-13-AC1: the same receipt, the same link and the same import never count twice', async () => {
    await assert.rejects(() => createSale({ saleDate: at('2031-03-10'), paymentType: 'CASH', items: [{ productId: productIds[0], quantity: 1, unitPrice: 65 }], cashAmount: 65, receiptRef: '  ZP1118-R1 ', createdBy: OWNER }), (e: unknown) => e instanceof DuplicateSaleError && e.saleId === ids.A)
    const again = await linkSale(prisma, ids.A, { source: 'TRACKED_LINK', trackingTag: tag }, OWNER)
    assert.strictEqual(again.changed, false)
    assert.strictEqual(await prisma.marketingSaleAttribution.count({ where: { saleId: ids.A } }), 1)
    // An import row carrying the same receipt is skipped, not imported.
    const doc = await prisma.importDocument.create({ data: { filename: 'zp1118.xlsx', documentType: 'BUSINESS_CONTROL', status: 'DRAFT', importedBy: OWNER } })
    importDocId = doc.id
    await prisma.importRow.create({ data: { importDocumentId: doc.id, rowNumber: 2, detectedRecordType: 'SALE', status: 'READY', mappedData: JSON.stringify({ receiptRef: 'ZP1118-R1', saleDate: '2031-03-10', totalAmount: 65, cashAmount: 65 }) } })
    const before = await prisma.sale.count()
    const out = await confirmImport(doc.id)
    assert.strictEqual(out.importedRows, 0)
    assert.strictEqual(out.skippedRows, 1)
    assert.strictEqual(await prisma.sale.count(), before)
    const r = await report()
    assert.strictEqual(r.allShop.collected, 105)
    assert.strictEqual(r.allShop.salesCount, 3)
    assert.strictEqual(r.campaigns[0].net, 65)
  })

  test('a refund of 10 against A on a later day: net 95 overall and 55 for X; a retry adds nothing', async () => {
    const first = await recordRefund(prisma, ids.A, { amount: 10, method: 'CASH', reason: 'Small mark on the hem', requestKey: 'zp1118-refund-1' }, OWNER, at('2031-03-12'))
    assert.strictEqual(first.duplicate, false)
    const retry = await recordRefund(prisma, ids.A, { amount: 10, method: 'CASH', reason: 'Small mark on the hem', requestKey: 'zp1118-refund-1' }, OWNER, at('2031-03-12'))
    assert.strictEqual(retry.duplicate, true)
    assert.strictEqual(retry.refund.id, first.refund.id)
    const r = await report()
    assert.strictEqual(r.allShop.collected, 105)
    assert.strictEqual(r.allShop.refunded, 10)
    assert.strictEqual(r.allShop.net, 95)
    assert.strictEqual(r.campaigns[0].net, 55)
    assert.ok(r.reconciles)
    // On the refund's own date, the sale is not counted again.
    const day = await report('2031-03-12', '2031-03-12')
    assert.strictEqual(day.allShop.net, -10)
    assert.strictEqual(day.allShop.salesCount, 0)
    // The till that day pays it out.
    const pos = await prisma.cashPosition.findFirstOrThrow({ where: { cashDate: { gte: new Date('2031-03-11T12:00:00Z'), lte: new Date('2031-03-12T12:00:00Z') } } })
    assert.strictEqual(pos.refundsPaid, 10)
  })
})

describe('MM-13-AC5: refunds, unpaid orders and corrections', () => {
  test('a cash refund cannot exceed what was collected; nothing collected means nothing to refund', async () => {
    await rejects(() => recordRefund(prisma, ids.A, { amount: 56, method: 'CASH', reason: 'x' }, OWNER, at('2031-03-12')), 409, /Only 55\.00/)
    await rejects(() => recordRefund(prisma, ids.C, { amount: 1, method: 'CASH', reason: 'x' }, OWNER, at('2031-03-12')), 409, /Only 0\.00/)
    await rejects(() => recordRefund(prisma, ids.A, { amount: 0, method: 'CASH', reason: 'x' }, OWNER), 400)
    await rejects(() => recordRefund(prisma, ids.A, { amount: 1.005, method: 'CASH', reason: 'x' }, OWNER), 400, /2 decimals/)
    await rejects(() => recordRefund(prisma, ids.A, { amount: 1, method: 'CASH' }, OWNER), 400, /why/)
  })

  test('a debtor payment makes the order collected on the payment date; a credit refund lowers what is owed', async () => {
    const debtor = await prisma.debtor.findFirstOrThrow({ where: { customerName: CUSTOMER } })
    await recordDebtorPayment(debtor.id, 20, 'ZP1118 part payment', OWNER, at('2031-03-13'))
    let m = await moneyOfSale(prisma, ids.C)
    assert.strictEqual(m.collectedCents, 2000)
    assert.strictEqual(m.outstandingCents, 3000)
    const day = await report('2031-03-13', '2031-03-13')
    assert.strictEqual(day.allShop.collected, 20)
    assert.strictEqual(day.uncredited.net, 20)
    await rejects(() => recordRefund(prisma, ids.C, { amount: 31, method: 'CREDIT', reason: 'x' }, OWNER, at('2031-03-13')), 409, /owes only 30\.00/)
    await recordRefund(prisma, ids.C, { amount: 5, method: 'CREDIT', reason: 'Button missing' }, OWNER, at('2031-03-13'))
    m = await moneyOfSale(prisma, ids.C)
    assert.strictEqual(m.outstandingCents, 2500)
    assert.strictEqual(m.collectedCents, 2000, 'a credit refund is not money collected or paid back')
    assert.strictEqual((await prisma.debtor.findUniqueOrThrow({ where: { id: debtor.id } })).outstandingBalance, 25)
    assert.strictEqual((await report()).allShop.net, 115)
    await rejects(() => cancelSale(prisma, ids.C, 'Changed mind', OWNER, at('2031-03-13')), 409, /collected/)
  })

  test('returned pieces go back to stock, at most the pieces sold', async () => {
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: ids.B } })
    const q = await qty(item.productId)
    await recordRefund(prisma, ids.B, { amount: 20, method: 'CASH', reason: 'Wrong size', saleItemId: item.id, quantity: 1 }, OWNER, at('2031-03-13'))
    assert.strictEqual(await qty(item.productId), q + 1)
    await rejects(() => recordRefund(prisma, ids.B, { amount: 1, method: 'CASH', reason: 'x', saleItemId: item.id, quantity: 2 }, OWNER, at('2031-03-13')), 409, /Only 1 pieces/)
    await rejects(() => recordRefund(prisma, ids.B, { amount: 1, method: 'CASH', reason: 'x', quantity: 1 }, OWNER), 400, /line/)
  })

  test('a mistaken refund is corrected by a void: reversed on the void date, the row and who did it stay', async () => {
    const r = await prisma.saleRefund.findFirstOrThrow({ where: { saleId: ids.B } })
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: ids.B } })
    const q = await qty(item.productId)
    const v = await voidRefund(prisma, r.id, 'Typed on the wrong sale', OWNER, at('2031-03-14'))
    assert.strictEqual(v.voidedBy, OWNER)
    assert.ok(v.voidedAt)
    assert.strictEqual(await qty(item.productId), q - 1)
    await rejects(() => voidRefund(prisma, r.id, 'again', OWNER, at('2031-03-14')), 409, /already/)
    await rejects(() => voidRefund(prisma, r.id, '', OWNER, at('2031-03-14')), 400)
    assert.strictEqual(await prisma.saleRefund.count({ where: { saleId: ids.B } }), 1, 'history kept')
    assert.strictEqual((await report('2031-03-13', '2031-03-13')).allShop.refunded, 20)
    const voidDay = await report('2031-03-14', '2031-03-14')
    assert.strictEqual(voidDay.allShop.net, 20, 'the money is back on the void date')
    assert.strictEqual(voidDay.allShop.refunded, 0, 'a correction is not a negative refund')
    assert.strictEqual(voidDay.allShop.corrected, 20)
    assert.strictEqual((await report()).allShop.net, 115)
  })

  test('an unpaid order can be cancelled: stock back, nothing owed, counted nowhere, row kept', async () => {
    const p = productIds[2]
    ids.D = await sale({ saleDate: at('2031-03-11'), paymentType: 'CREDIT', customerName: CUSTOMER, items: [{ productId: p, quantity: 2, unitPrice: 15 }], creditAmount: 30 })
    await linkSale(prisma, ids.D, { source: 'CUSTOMER_REPORTED', campaignId: ids.Y, evidence: 'Saw the Y flyer' }, OWNER)
    const owed = (await prisma.debtor.findFirstOrThrow({ where: { customerName: CUSTOMER } })).outstandingBalance
    const q = await qty(p)
    const before = await report()
    assert.strictEqual(before.allShop.salesCount, 4)
    const c = await cancelSale(prisma, ids.D, 'Customer never came back', OWNER, at('2031-03-14'))
    assert.strictEqual(c.status, 'CANCELLED')
    assert.strictEqual(c.cancelledBy, OWNER)
    assert.strictEqual(await qty(p), q + 2)
    assert.strictEqual((await prisma.debtor.findFirstOrThrow({ where: { customerName: CUSTOMER } })).outstandingBalance, owed - 30)
    // The customer's earlier payment still belongs to C, not to the cancelled order.
    assert.strictEqual((await moneyOfSale(prisma, ids.C)).collectedCents, 2000)
    const r = await report()
    assert.strictEqual(r.allShop.salesCount, 3)
    assert.strictEqual(r.allShop.cancelledCount, 1)
    assert.strictEqual(r.allShop.net, before.allShop.net)
    assert.ok(!r.campaigns.some((x) => x.campaignId === ids.Y), 'a cancelled sale credits no campaign')
    await rejects(() => cancelSale(prisma, ids.D, 'again', OWNER), 409, /already/)
    await rejects(() => recordRefund(prisma, ids.D, { amount: 1, method: 'CREDIT', reason: 'x' }, OWNER), 409, /cancelled/)
    await rejects(() => linkSale(prisma, ids.D, { source: 'UNKNOWN' }, OWNER), 409, /cancelled/)
    const detail = await saleWithMoney(prisma, ids.D)
    assert.strictEqual(detail?.cancelReason, 'Customer never came back')
  })
})

describe('MM-13-AC2/AC3/AC4: evidence, review and late sales', () => {
  test('evidence pointing at two campaigns stays unknown until the owner chooses; the choice is recorded', async () => {
    const { attribution: a } = await linkSale(prisma, ids.B, { source: 'CUSTOMER_REPORTED', candidateCampaignIds: [ids.X, ids.Y], evidence: 'Saw a post, not sure which' }, OWNER)
    assert.strictEqual(a.source, 'UNKNOWN')
    assert.strictEqual(a.needsReview, true)
    assert.strictEqual(a.credited, false)
    assert.deepStrictEqual(a.candidateCampaignIds, [ids.X, ids.Y])
    let r = await report()
    assert.ok(!r.campaigns.some((c) => c.campaignId === ids.Y))
    assert.strictEqual(r.needsReview, 1)
    assert.ok(r.uncredited.sales.find((s) => s.saleId === ids.B)?.needsReview)
    const { attribution: b } = await linkSale(prisma, ids.B, { source: 'CUSTOMER_REPORTED', campaignId: ids.Y, evidence: 'Asked again: it was the Y post', touchpoints: ['Also saw an X story'] }, OWNER, at('2031-03-14'))
    assert.strictEqual(b.credited, true)
    assert.strictEqual(b.reviewedBy, OWNER)
    assert.deepStrictEqual(b.touchpoints, ['Also saw an X story'])
    r = await report()
    assert.strictEqual(r.campaigns.find((c) => c.campaignId === ids.Y)?.net, 40)
    assert.strictEqual(r.campaigns.find((c) => c.campaignId === ids.X)?.net, 55, 'a touchpoint adds nothing to X')
    assert.strictEqual(r.needsReview, 0)
    assert.ok(r.reconciles)
    const audit = await prisma.marketingAuditLog.findMany({ where: { entity: 'sale', entityId: ids.B }, orderBy: { id: 'asc' } })
    assert.deepStrictEqual(audit.map((x) => x.action), ['sale.attribution_link', 'sale.attribution_change'])
  })

  test('the source rules: a tag must be real and in a campaign; customer words are required; unknown has no campaign', async () => {
    await rejects(() => linkSale(prisma, ids.C, { source: 'TRACKED_LINK', trackingTag: 'mknosuchtag999' }, OWNER), 400, /does not belong/)
    await rejects(() => linkSale(prisma, ids.C, { source: 'TRACKED_LINK' }, OWNER), 400, /tracking tag/)
    await rejects(() => linkSale(prisma, ids.C, { source: 'TRACKED_LINK', trackingTag: tag, campaignId: ids.Y }, OWNER), 409, /different campaign/)
    await rejects(() => linkSale(prisma, ids.C, { source: 'CUSTOMER_REPORTED', campaignId: ids.Y }, OWNER), 400, /what the customer said/)
    await rejects(() => linkSale(prisma, ids.C, { source: 'UNKNOWN', campaignId: ids.Y }, OWNER), 400)
    await rejects(() => linkSale(prisma, ids.C, { source: 'UNKNOWN', amount: 5 }, OWNER), 400, /Unknown field/)
    await rejects(() => linkSale(prisma, ids.C, { source: 'UNKNOWN', paymentEvidence: 'PAYMENT_CONFIRMED' }, OWNER), 400, /confirms the payment/)
    const { attribution } = await linkSale(prisma, ids.C, { source: 'UNKNOWN', paymentEvidence: 'PAYMENT_CONFIRMED', paymentNote: 'EcoCash ref ZP1118' }, OWNER)
    assert.strictEqual(attribution.credited, false)
    assert.strictEqual(attribution.paymentEvidence, 'PAYMENT_CONFIRMED')
    const r = await report()
    assert.ok(r.uncredited.sales.some((s) => s.saleId === ids.C))
    assert.strictEqual(r.paymentConfirmed.salesCount, 1)
  })

  test('a sale after the campaign ended may be linked, keeps its date and says so', async () => {
    const late = await sale({ saleDate: at('2031-03-14'), paymentType: 'CASH', items: [{ productId: productIds[0], quantity: 1, unitPrice: 12 }], cashAmount: 12 })
    const { attribution } = await linkSale(prisma, late, { source: 'TRACKED_LINK', trackingTag: tag }, OWNER)
    assert.strictEqual(attribution.afterCampaignEnd, true)
    assert.strictEqual(attribution.saleDate, '2031-03-14')
    assert.strictEqual((await prisma.sale.findUniqueOrThrow({ where: { id: late } })).saleDate.toISOString(), at('2031-03-14').toISOString())
    assert.strictEqual((await report('2031-03-14', '2031-03-14')).campaigns.find((c) => c.campaignId === ids.X)?.net, 12)
    assert.strictEqual((await getAttribution(prisma, ids.A))?.afterCampaignEnd, false)
  })
})

describe('validator round 1: the till, the day boundary and campaign timing', () => {
  test('editing the cash screen keeps refunds out of the till; refunds paid cannot be typed over', async () => {
    const day = at('2031-03-12')
    const pos = await updateCashPosition(day, 'otherCashIn', 7)
    const expected = pos.openingCash + pos.cashSales + pos.debtorPaymentsReceived + pos.otherCashIn - pos.expensesPaid - pos.creditorPaymentsMade - pos.refundsPaid
    assert.strictEqual(pos.refundsPaid, 10)
    assert.strictEqual(Math.round(pos.expectedClosingCash * 100), Math.round(expected * 100))
    await assert.rejects(() => updateCashPosition(day, 'refundsPaid', 0), /cannot be edited/)
    await assert.rejects(() => updateCashPosition(day, 'cashSales', 0), /cannot be edited/)
    await updateCashPosition(day, 'otherCashIn', 0)
  })

  test('a sale and a refund at 22:30 UTC land on the same ledger day as the till, and reconcile', async () => {
    const saleAt = new Date('2031-03-15T22:30:00Z')
    const refundAt = new Date('2031-03-16T22:30:00Z')
    const e = await sale({ saleDate: saleAt, paymentType: 'CASH', items: [{ productId: productIds[1], quantity: 1, unitPrice: 30 }], cashAmount: 30 })
    await recordRefund(prisma, e, { amount: 5, method: 'CASH', reason: 'Late evening refund' }, OWNER, refundAt)
    const from = ledgerDay(saleAt)
    const to = ledgerDay(refundAt)
    const r = await report(from, to)
    const pos = await prisma.cashPosition.findMany({ where: { cashDate: { gte: startOfDay(saleAt), lte: startOfDay(refundAt) } } })
    const till = pos.reduce((a, p) => a + p.cashSales + p.debtorPaymentsReceived - p.refundsPaid, 0)
    assert.strictEqual(Math.round(till * 100), Math.round(r.allShop.net * 100))
    assert.strictEqual(r.allShop.net, 25)
    const saleDay = await report(from, from)
    const saleDayPos = await prisma.cashPosition.findUniqueOrThrow({ where: { cashDate: startOfDay(saleAt) } })
    assert.strictEqual(saleDay.allShop.collected, saleDayPos.cashSales)
    assert.ok(r.reconciles)
  })

  test('a campaign that began after the sale, or a post that went out after it, cannot be credited', async () => {
    const later = await prisma.marketingCampaign.create({ data: { name: 'ZP1118 later', status: 'ACTIVE', startsAt: at('2031-04-01') } })
    campaignIds.push(later.id)
    await rejects(() => linkSale(prisma, ids.A, { source: 'CUSTOMER_REPORTED', campaignId: later.id, evidence: 'Mentioned it' }, OWNER), 409, /before "ZP1118 later" began/)
    const latePost = await prisma.marketingPost.create({ data: { contentId, channelKind: 'FACEBOOK_PAGE', text: 'x', trackingTag: 'mkzp1118late01', status: 'PUBLISHED', publishedAt: at('2031-03-20') } })
    extraPostIds.push(latePost.id)
    await rejects(() => linkSale(prisma, ids.A, { source: 'TRACKED_LINK', trackingTag: 'mkzp1118late01' }, OWNER), 409, /had not gone out/)
    const draftPost = await prisma.marketingPost.create({ data: { contentId, channelKind: 'FACEBOOK_PAGE', text: 'x', trackingTag: 'mkzp1118draft1', status: 'DRAFT' } })
    extraPostIds.push(draftPost.id)
    await rejects(() => linkSale(prisma, ids.A, { source: 'TRACKED_LINK', trackingTag: 'mkzp1118draft1' }, OWNER), 409, /had not gone out/)
    assert.strictEqual((await getAttribution(prisma, ids.A))?.campaignId, ids.X, 'the earlier link is untouched')
  })
})

describe('MM-13-AC6: totals reconcile to the existing ledger', () => {
  test('all-shop money equals the cash positions of the same days; billed equals the sale rows; breakdowns add up', async () => {
    const r = await report()
    const pos = await prisma.cashPosition.findMany({ where: { cashDate: { gte: new Date('2031-03-09T12:00:00Z'), lte: new Date('2031-03-14T12:00:00Z') } } })
    const till = pos.reduce((a, p) => a + p.cashSales + p.debtorPaymentsReceived - p.refundsPaid, 0)
    assert.strictEqual(Math.round(till * 100), Math.round(r.allShop.net * 100))
    const rows = (await prisma.sale.findMany({ where: { id: { in: saleIds }, status: 'COMPLETED' } })).filter((s) => ledgerDay(s.saleDate) >= '2031-03-10' && ledgerDay(s.saleDate) <= '2031-03-14')
    assert.strictEqual(Math.round(rows.reduce((a, s) => a + s.totalAmount, 0) * 100), Math.round(r.allShop.billed * 100))
    const sum = (xs: { net: number }[]) => Math.round(xs.reduce((a, x) => a + x.net, 0) * 100)
    assert.strictEqual(sum(r.campaigns) + Math.round(r.uncredited.net * 100) + Math.round(r.notASale.net * 100), Math.round(r.allShop.net * 100))
    assert.strictEqual(sum(r.channels), sum(r.campaigns))
    assert.ok(r.reconciles)
    await rejects(() => marketingSalesReport(prisma, { from: '2031-03-14', to: '2031-03-10' }), 400)
  })
})
