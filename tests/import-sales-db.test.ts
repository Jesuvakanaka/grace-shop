// ZP-1126: an imported sales row keeps its amount, cash part and date, and its cash goes into that day's till.
// Against DATABASE_URL. Only touches rows it creates: import documents named zp1126-*, sales and cash positions
// and day closings on 2032-02 dates.
import { describe, test, after } from 'node:test'
import assert from 'node:assert'
import { startOfDay } from 'date-fns'
import prisma from '../src/lib/db'
import { confirmImport, importedSaleFields } from '../src/lib/import/importer'
import { mapSalesRow } from '../src/lib/import/mappers/business-control'
import { marketingSalesReport } from '../src/lib/marketing/sale-attribution'

const at = (day: string) => new Date(`${day}T10:00:00.000Z`)
const docIds: number[] = []
const RANGE = { gte: new Date('2032-02-01T00:00:00Z'), lte: new Date('2032-02-28T00:00:00Z') }

async function importRows(rows: Record<string, unknown>[]) {
  const doc = await prisma.importDocument.create({ data: { filename: `zp1126-${docIds.length}.xlsx`, documentType: 'BUSINESS_CONTROL', status: 'DRAFT', importedBy: 'zp1126' } })
  docIds.push(doc.id)
  for (const [i, m] of rows.entries()) {
    await prisma.importRow.create({ data: { importDocumentId: doc.id, rowNumber: i + 2, detectedRecordType: 'SALE', status: 'READY', mappedData: JSON.stringify(m) } })
  }
  return confirmImport(doc.id)
}
const salesOf = (docId: number) => prisma.importRow.findMany({ where: { importDocumentId: docId } }).then((rows) => prisma.sale.findMany({ where: { externalRef: { in: rows.map((r) => `import-row:${r.id}`) } } }))

after(async () => {
  const rows = await prisma.importRow.findMany({ where: { importDocumentId: { in: docIds } } })
  await prisma.sale.deleteMany({ where: { OR: [{ externalRef: { in: rows.map((r) => `import-row:${r.id}`) } }, { externalRef: { startsWith: 'receipt:ZP1126-' } }] } })
  await prisma.importRow.deleteMany({ where: { importDocumentId: { in: docIds } } })
  await prisma.importDocument.deleteMany({ where: { id: { in: docIds } } })
  await prisma.cashPosition.deleteMany({ where: { cashDate: RANGE } })
  await prisma.dayClosing.deleteMany({ where: { closingDate: RANGE } })
  await prisma.$disconnect()
})

describe('importedSaleFields (pure)', () => {
  test('reads what the sales mapper writes: amount and date, a cash sale of the whole amount', () => {
    const { mapped } = mapSalesRow({ 'Item No': 'A1', Quantity: 2, Amount: 40, Date: '2032-02-10T10:00:00Z' }, 2)
    const f = importedSaleFields(JSON.parse(JSON.stringify(mapped)))
    assert.deepStrictEqual(f, { saleDate: at('2032-02-10'), totalAmount: 40, cashAmount: 40, creditAmount: 0, paymentType: 'CASH' })
  })
  test('older stored rows with the sale names still work, and a split is kept', () => {
    assert.deepStrictEqual(importedSaleFields({ saleDate: '2032-02-11T10:00:00Z', totalAmount: 50, cashAmount: 20, creditAmount: 30 }),
      { saleDate: at('2032-02-11'), totalAmount: 50, cashAmount: 20, creditAmount: 30, paymentType: 'MIXED' })
  })
  test('no date or a bad date means today; no amount means 0', () => {
    const now = at('2032-02-12')
    assert.deepStrictEqual(importedSaleFields({ date: 'not a date' }, now), { saleDate: now, totalAmount: 0, cashAmount: 0, creditAmount: 0, paymentType: 'CASH' })
  })
})

describe('ZP-1126: importing sales rows into the real ledger', () => {
  test('the sale keeps its amount and date, the till of that day gets its cash, and the report reconciles', async () => {
    const res = await importRows([
      { itemNumber: 'A1', quantity: 2, amount: 40, date: '2032-02-10T10:00:00.000Z' },
      { itemNumber: 'A2', quantity: 1, amount: 25, date: '2032-02-11T10:00:00.000Z', receiptRef: 'ZP1126-R1' },
    ])
    assert.strictEqual(res.importedRows, 2)
    const first = (await salesOf(docIds[0]))[0]
    assert.strictEqual(first.totalAmount, 40)
    assert.strictEqual(first.cashAmount, 40)
    assert.strictEqual(first.saleDate.toISOString(), at('2032-02-10').toISOString())
    const second = await prisma.sale.findUniqueOrThrow({ where: { externalRef: 'receipt:ZP1126-R1' } })
    assert.strictEqual(second.totalAmount, 25)
    const pos = await prisma.cashPosition.findUniqueOrThrow({ where: { cashDate: startOfDay(at('2032-02-10')) } })
    assert.strictEqual(pos.cashSales, 40)
    const r = await marketingSalesReport(prisma, { from: '2032-02-10', to: '2032-02-11' })
    const till = (await prisma.cashPosition.findMany({ where: { cashDate: { gte: startOfDay(at('2032-02-10')), lte: startOfDay(at('2032-02-11')) } } }))
      .reduce((a, p) => a + p.cashSales + p.debtorPaymentsReceived - p.refundsPaid, 0)
    assert.strictEqual(r.allShop.net, 65)
    assert.strictEqual(till, 65)
    assert.ok(r.reconciles)
  })

  test('the same receipt imported again is skipped and the till does not change', async () => {
    const res = await importRows([{ itemNumber: 'A2', quantity: 1, amount: 25, date: '2032-02-11T10:00:00.000Z', receiptRef: 'ZP1126-R1' }])
    assert.strictEqual(res.importedRows, 0)
    assert.strictEqual(res.skippedRows, 1)
    const pos = await prisma.cashPosition.findUniqueOrThrow({ where: { cashDate: startOfDay(at('2032-02-11')) } })
    assert.strictEqual(pos.cashSales, 25)
  })

  test('a row for a closed day is refused with a reason, and that day keeps its figures', async () => {
    await prisma.dayClosing.create({ data: { closingDate: startOfDay(at('2032-02-15')), status: 'CLOSED' } })
    const res = await importRows([{ itemNumber: 'A3', quantity: 1, amount: 30, date: '2032-02-15T10:00:00.000Z' }])
    assert.strictEqual(res.importedRows, 0)
    assert.match(res.errors[0], /2032-02-15 is already closed/)
    assert.deepStrictEqual(await salesOf(docIds[2]), [])
    assert.strictEqual(await prisma.cashPosition.findUnique({ where: { cashDate: startOfDay(at('2032-02-15')) } }), null)
  })
})
