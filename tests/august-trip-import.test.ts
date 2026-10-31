// ZP-468: August trip spreadsheet import.
// Pure parsing/mapping tests plus re-run safety against an in-memory store,
// so this file never touches the database (business-rules.test.ts wipes it).
import { describe, test, before } from 'node:test'
import assert from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { buildXlsx, type FixtureSpec } from './helpers/xlsx-fixture'
import { parseAugustTripWorkbook } from '../src/lib/import/august-trip/parse'
import { buildAugustRecords } from '../src/lib/import/august-trip/records'
import {
  runAugustImport,
  type AugustImportStore,
  type ExistingAugustProduct,
} from '../src/lib/import/august-trip/run'
import type { AugustProductRecord } from '../src/lib/import/august-trip/records'
import { getMissingProductDetails } from '../src/lib/product-completeness'

const HEADERS = [
  'Picture / Item',
  'Description',
  'Quanity', // the real file's spelling
  'Price RMB',
  'Price Cost USD',
  'Unit Price RMB',
  'Unit Price USD',
  'Selling price Retail',
  'Selling price Wholesale',
  'Wholesale Quanity',
]
const s = (text: string) => ({ t: 's' as const, text })
const n = (value: number) => ({ t: 'n' as const, value })
const img = (image: number) => ({ t: 'img' as const, image })

let fixture: Uint8Array

before(async () => {
  const solid = (w: number, h: number, r: number, g: number, b: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } })
  const images: FixtureSpec['images'] = [
    { ext: 'png', bytes: await solid(20, 10, 255, 0, 0).png().toBuffer() }, // 0: used by rows 2 and 6
    { ext: 'jpeg', bytes: await solid(1600, 800, 0, 0, 255).jpeg().toBuffer() }, // 1: row 3
    { ext: 'png', bytes: await solid(30, 30, 0, 255, 0).png().toBuffer() }, // 2: floating, row 5
    { ext: 'png', bytes: await solid(8, 8, 9, 9, 9).png().toBuffer() }, // 3: not used by any row
  ]
  const header = Object.fromEntries(HEADERS.map((h, i) => [String.fromCharCode(65 + i), s(h)]))
  fixture = buildXlsx({
    images,
    rows: {
      1: header,
      // Picture and description only: no quantity, no prices.
      2: { A: img(0), B: s('Jeans Blue & Green') },
      // Quantity blank, but the description starts with a count.
      3: { A: img(1), B: s('5 White shirts'), D: n(35), E: n(5) },
      // Complete row, no picture.
      4: { B: s('Joggers Khaki'), C: n(10), D: n(45), E: n(6), H: n(12), I: n(9), J: n(6) },
      // Floating picture; unit prices win over Price RMB/USD; stray "\" in Retail.
      5: { B: s('Pajamas '), C: n(2), D: n(20), E: n(3), F: n(18), G: n(2.5), H: s('\\') },
      // Same in-cell picture as row 2.
      6: { A: img(0), B: s('Gold Dresses'), C: n(4), D: n(99), E: n(15) },
    },
    floating: [
      { row: 4, col: 0, image: 2, name: 'Picture 7' }, // anchored in A5
      { row: 2, col: 0, name: 'AutoShape 1' }, // empty shape in A3, like the real file's row 18
    ],
  })
})

describe('parseAugustTripWorkbook', () => {
  test('reads every item row below the header, mapping columns by header name', () => {
    const parsed = parseAugustTripWorkbook(fixture)
    assert.strictEqual(parsed.sheetName, 'Sheet1')
    assert.strictEqual(parsed.headerRowNumber, 1)
    assert.deepStrictEqual(
      parsed.rows.map((r) => r.rowNumber),
      [2, 3, 4, 5, 6],
    )
    assert.strictEqual(parsed.columns.quantity, 'C')
    const row4 = parsed.rows.find((r) => r.rowNumber === 4)!
    assert.strictEqual(row4.cells.description.text, 'Joggers Khaki')
    assert.strictEqual(row4.cells.quantity.number, 10)
    assert.strictEqual(row4.cells.wholesaleQuantity.number, 6)
  })

  test('rows with no quantity or price come back blank, not 0', () => {
    const parsed = parseAugustTripWorkbook(fixture)
    const row2 = parsed.rows.find((r) => r.rowNumber === 2)!
    assert.deepStrictEqual(row2.cells.quantity, { text: null, number: null })
    assert.deepStrictEqual(row2.cells.priceRmb, { text: null, number: null })
    assert.deepStrictEqual(row2.cells.priceCostUsd, { text: null, number: null })
    const row5 = parsed.rows.find((r) => r.rowNumber === 5)!
    assert.deepStrictEqual(row5.cells.retail, { text: '\\', number: null })
  })

  test('maps in-cell pictures through the rich-value chain, and the floating picture by its anchor row', () => {
    const parsed = parseAugustTripWorkbook(fixture)
    const pic = Object.fromEntries(parsed.rows.map((r) => [r.rowNumber, r.picture]))
    assert.deepStrictEqual(pic[2], { mediaPath: 'xl/media/image1.png', source: 'in-cell', cellRef: 'A2' })
    assert.deepStrictEqual(pic[3], { mediaPath: 'xl/media/image2.jpeg', source: 'in-cell', cellRef: 'A3' })
    assert.strictEqual(pic[4], null)
    assert.deepStrictEqual(pic[5], { mediaPath: 'xl/media/image3.png', source: 'floating', cellRef: 'A5' })
    assert.deepStrictEqual(pic[6], { mediaPath: 'xl/media/image1.png', source: 'in-cell', cellRef: 'A6' })
    assert.deepStrictEqual(parsed.matchedMediaPaths, ['xl/media/image1.png', 'xl/media/image2.jpeg', 'xl/media/image3.png'])
    assert.deepStrictEqual(parsed.unmatchedMediaPaths, ['xl/media/image4.png'])
    assert.ok(parsed.media.get('xl/media/image2.jpeg')!.length > 0)
  })

  test('an empty floating shape (no picture data) is reported and ignored', () => {
    const parsed = parseAugustTripWorkbook(fixture)
    const shape = parsed.floatingObjects.find((o) => o.name === 'AutoShape 1')!
    assert.deepStrictEqual(shape, { rowNumber: 3, cellRef: 'A3', name: 'AutoShape 1', mediaPath: null })
    assert.ok(parsed.warnings.some((w) => /AutoShape 1.*A3.*no picture/.test(w)), parsed.warnings.join('\n'))
    // Row 3 keeps its own in-cell picture.
    assert.strictEqual(parsed.rows.find((r) => r.rowNumber === 3)!.picture!.source, 'in-cell')
  })

  test('rejects a file that is not an .xlsx', () => {
    assert.throws(() => parseAugustTripWorkbook(new TextEncoder().encode('hello')), /xlsx/i)
  })
})

describe('buildAugustRecords (import exactly as written)', () => {
  const records = () => {
    const parsed = parseAugustTripWorkbook(fixture)
    return Object.fromEntries(buildAugustRecords(parsed, 'August trip.xlsx').map((r) => [r.sourceRowNumber, r]))
  }

  test('item numbers and traceability come from the sheet row', () => {
    const r = records()[4]
    assert.strictEqual(r.itemNumber, 'AUG-4')
    assert.strictEqual(r.sourceFilename, 'August trip.xlsx')
    assert.strictEqual(r.sourceSheetName, 'Sheet1')
    assert.strictEqual(r.sourceRowNumber, 4)
  })

  test('a complete row maps every field and needs no details', () => {
    const r = records()[4]
    assert.deepStrictEqual(
      {
        name: r.productName,
        qty: r.quantity,
        rmb: r.unitCostRmb,
        usd: r.unitCostUsd,
        retail: r.sellingPriceUsd,
        sellRmb: r.sellingPriceRmb,
        wholesale: r.wholesalePriceUsd,
        minQty: r.wholesaleMinQuantity,
        missing: r.missing,
      },
      { name: 'Joggers Khaki', qty: 10, rmb: 45, usd: 6, retail: 12, sellRmb: 0, wholesale: 9, minQty: 6, missing: [] },
    )
  })

  test('a row with no quantity or price is still created, with 0/blank values and every reason', () => {
    const r = records()[2]
    assert.strictEqual(r.productName, 'Jeans Blue & Green')
    assert.strictEqual(r.quantity, 0)
    assert.strictEqual(r.unitCostRmb, 0)
    assert.strictEqual(r.unitCostUsd, 0)
    assert.strictEqual(r.sellingPriceUsd, 0)
    assert.strictEqual(r.wholesalePriceUsd, null)
    assert.strictEqual(r.wholesaleMinQuantity, null)
    assert.deepStrictEqual(r.missing, ['quantity', 'cost price', 'retail price', 'wholesale price'])
    assert.match(r.notes, /Quantity blank in spreadsheet\./)
    assert.match(r.notes, /Cost price \(RMB and USD\) blank/)
  })

  test('"5 White shirts" is recorded as written: quantity not guessed, original text in notes', () => {
    const r = records()[3]
    assert.strictEqual(r.productName, '5 White shirts')
    assert.strictEqual(r.quantity, 0)
    assert.strictEqual(r.unitCostRmb, 35)
    assert.strictEqual(r.unitCostUsd, 5)
    assert.match(r.notes, /Quantity blank in spreadsheet; description says '5 White shirts'\./)
    assert.ok(r.missing.includes('quantity'))
  })

  test('Unit Price RMB/USD take precedence; a non-numeric retail cell is left empty with a note; names are trimmed', () => {
    const r = records()[5]
    assert.strictEqual(r.productName, 'Pajamas')
    assert.strictEqual(r.unitCostRmb, 18)
    assert.strictEqual(r.unitCostUsd, 2.5)
    assert.strictEqual(r.sellingPriceUsd, 0)
    assert.match(r.notes, /Selling price Retail cell contains '\\'/)
    assert.strictEqual(r.mediaPath, 'xl/media/image3.png')
  })

  test('shared pictures are noted; rows without a picture say so', () => {
    const all = records()
    assert.match(all[6].notes, /Same picture as spreadsheet row 2/)
    assert.match(all[2].notes, /Same picture as spreadsheet row 6/)
    assert.match(all[4].notes, /No picture in spreadsheet row/)
  })
})

describe('getMissingProductDetails: quantity for imported products (ZP-468 extension)', () => {
  const complete = { unitCostRmb: 55, unitCostUsd: 8, sellingPriceUsd: 16, wholesalePriceUsd: 12 }

  test('an imported product with no opening and no current quantity needs "quantity"', () => {
    assert.deepStrictEqual(
      getMissingProductDetails({ ...complete, openingQuantity: 0, currentQuantity: 0, sourceFilename: 'August trip.xlsx' }),
      ['quantity'],
    )
  })

  test('quantity is not missing once the owner sets stock, or when the import had a quantity', () => {
    const base = { ...complete, sourceFilename: 'August trip.xlsx' }
    assert.deepStrictEqual(getMissingProductDetails({ ...base, openingQuantity: 0, currentQuantity: 7 }), [])
    assert.deepStrictEqual(getMissingProductDetails({ ...base, openingQuantity: 6, currentQuantity: 0 }), [])
  })

  test('products that were not imported never need "quantity" (0 stock is a normal state)', () => {
    assert.deepStrictEqual(getMissingProductDetails({ ...complete, openingQuantity: 0, currentQuantity: 0 }), [])
    assert.deepStrictEqual(
      getMissingProductDetails({ ...complete, openingQuantity: 0, currentQuantity: 0, sourceFilename: null }),
      [],
    )
  })
})

// ─── Re-run safety ────────────────────────────────────────────────────────────

type FakeProduct = ExistingAugustProduct & { record: AugustProductRecord; productName: string }
type FakeMovement = { productId: number; quantity: number; referenceType: string; notes: string }

function fakeStore() {
  const products = new Map<string, FakeProduct>()
  const movements: FakeMovement[] = []
  let nextId = 1
  const writes: string[] = []
  const store: AugustImportStore = {
    async findExisting(itemNumbers) {
      const out = new Map<string, ExistingAugustProduct>()
      for (const n of itemNumbers) {
        const p = products.get(n)
        if (p) {
          out.set(n, {
            id: p.id,
            itemNumber: p.itemNumber,
            imageUrl: p.imageUrl,
            sourceFilename: p.sourceFilename,
            sourceRowNumber: p.sourceRowNumber,
            openingQuantity: p.openingQuantity,
            currentQuantity: p.currentQuantity,
            movementCount: movements.filter((m) => m.productId === p.id).length,
          })
        }
      }
      return out
    },
    async createProduct(record, imageUrl) {
      writes.push(`create ${record.itemNumber}`)
      const id = nextId++
      products.set(record.itemNumber, {
        id,
        itemNumber: record.itemNumber,
        productName: record.productName,
        imageUrl,
        sourceFilename: record.sourceFilename,
        sourceRowNumber: record.sourceRowNumber,
        openingQuantity: record.quantity,
        currentQuantity: record.quantity,
        movementCount: 0,
        record,
      })
      if (record.quantity > 0) {
        movements.push({ productId: id, quantity: record.quantity, referenceType: 'IMPORT', notes: record.itemNumber })
      }
      return { id, movementCreated: record.quantity > 0 }
    },
    async attachImageIfEmpty(productId, imageUrl) {
      const p = [...products.values()].find((x) => x.id === productId)!
      if (p.imageUrl) return false
      writes.push(`image ${p.itemNumber}`)
      p.imageUrl = imageUrl
      return true
    },
    async addImportStockIfNone(productId, quantity, notes) {
      const p = [...products.values()].find((x) => x.id === productId)!
      if (movements.some((m) => m.productId === productId) || p.currentQuantity !== 0 || p.openingQuantity !== 0) {
        return false
      }
      writes.push(`stock ${p.itemNumber}`)
      movements.push({ productId, quantity, referenceType: 'IMPORT', notes })
      p.openingQuantity = quantity
      p.currentQuantity = quantity
      return true
    },
  }
  return { store, products, movements, writes }
}

function counting() {
  const calls: string[] = []
  const saveImage = async (_bytes: Uint8Array, mediaPath: string) => {
    calls.push(mediaPath)
    return `/api/images/${mediaPath.replace(/\W/g, '').padEnd(32, '0').slice(0, 32)}.webp`
  }
  return { calls, saveImage }
}

const snapshot = (f: ReturnType<typeof fakeStore>) => ({
  products: [...f.products.values()].map((p) => [p.itemNumber, p.imageUrl, p.openingQuantity, p.currentQuantity]),
  movements: f.movements.length,
  units: f.movements.reduce((sum, m) => sum + m.quantity, 0),
})

describe('runAugustImport (re-run safety)', () => {
  const opts = { sourceFilename: 'August trip.xlsx' }

  test('dry run writes nothing and reports what would happen', async () => {
    const f = fakeStore()
    const img = counting()
    const report = await runAugustImport(parseAugustTripWorkbook(fixture), {
      ...opts,
      dryRun: true,
      store: f.store,
      saveImage: img.saveImage,
    })
    assert.deepStrictEqual(f.writes, [])
    assert.deepStrictEqual(img.calls, [])
    assert.strictEqual(report.dryRun, true)
    assert.strictEqual(report.rows, 5)
    assert.deepStrictEqual(report.toCreate, ['AUG-2', 'AUG-3', 'AUG-4', 'AUG-5', 'AUG-6'])
    assert.strictEqual(report.pictures.inFile, 4)
    assert.strictEqual(report.pictures.rowsWithPicture, 4)
    assert.strictEqual(report.pictures.distinctMatched, 3)
    assert.deepStrictEqual(report.pictures.unmatched, ['xl/media/image4.png'])
    assert.strictEqual(report.pictures.attached, 4)
    assert.strictEqual(report.stock.totalUnits, 16)
    assert.strictEqual(report.stock.movementsCreated, 3)
    assert.deepStrictEqual(
      report.needsDetails.map((n) => [n.itemNumber, n.missing]),
      [
        ['AUG-2', ['quantity', 'cost price', 'retail price', 'wholesale price']],
        ['AUG-3', ['quantity', 'retail price', 'wholesale price']],
        ['AUG-5', ['retail price', 'wholesale price']],
        ['AUG-6', ['retail price', 'wholesale price']],
      ],
    )
  })

  test('first run creates every row once; shared pictures are processed once', async () => {
    const f = fakeStore()
    const img = counting()
    const report = await runAugustImport(parseAugustTripWorkbook(fixture), { ...opts, store: f.store, saveImage: img.saveImage })
    assert.strictEqual(report.created.length, 5)
    assert.strictEqual(f.products.size, 5)
    assert.strictEqual(img.calls.length, 3)
    assert.strictEqual(report.pictures.attached, 4)
    assert.strictEqual(f.products.get('AUG-2')!.imageUrl, f.products.get('AUG-6')!.imageUrl)
    assert.strictEqual(f.products.get('AUG-4')!.imageUrl, null)
    assert.strictEqual(report.stock.movementsCreated, 3)
    assert.strictEqual(report.stock.unitsAdded, 16)
  })

  test('running twice gives identical products, movements and units; the second run writes nothing', async () => {
    const f = fakeStore()
    const img = counting()
    const parsed = parseAugustTripWorkbook(fixture)
    await runAugustImport(parsed, { ...opts, store: f.store, saveImage: img.saveImage })
    const after1 = snapshot(f)
    const writes1 = f.writes.length

    const report2 = await runAugustImport(parsed, { ...opts, store: f.store, saveImage: img.saveImage })
    assert.deepStrictEqual(snapshot(f), after1)
    assert.strictEqual(f.writes.length, writes1, `unexpected writes: ${f.writes.slice(writes1).join(', ')}`)
    assert.deepStrictEqual(report2.created, [])
    assert.strictEqual(report2.existing.length, 5)
    assert.strictEqual(report2.pictures.attached, 0)
    assert.strictEqual(report2.stock.movementsCreated, 0)
    assert.strictEqual(report2.stock.unitsAdded, 0)
    assert.strictEqual(report2.stock.totalUnits, 16) // still reports what the sheet holds
  })

  test("a re-run never overwrites the owner's edits and never doubles stock", async () => {
    const f = fakeStore()
    const img = counting()
    const parsed = parseAugustTripWorkbook(fixture)
    await runAugustImport(parsed, { ...opts, store: f.store, saveImage: img.saveImage })
    // Owner renames AUG-4, sets stock on AUG-2 (an adjustment movement), replaces AUG-3's picture.
    f.products.get('AUG-4')!.productName = 'Owner name'
    const aug2 = f.products.get('AUG-2')!
    f.movements.push({ productId: aug2.id, quantity: 12, referenceType: 'MANUAL', notes: 'adjust' })
    aug2.currentQuantity = 12
    f.products.get('AUG-3')!.imageUrl = '/api/images/ffffffffffffffffffffffffffffffff.webp'

    await runAugustImport(parsed, { ...opts, store: f.store, saveImage: img.saveImage })
    assert.strictEqual(f.products.get('AUG-4')!.productName, 'Owner name')
    assert.strictEqual(aug2.currentQuantity, 12)
    assert.strictEqual(f.movements.filter((m) => m.productId === aug2.id).length, 1)
    assert.strictEqual(f.products.get('AUG-3')!.imageUrl, '/api/images/ffffffffffffffffffffffffffffffff.webp')
  })

  test('a re-run attaches a picture that is still missing (e.g. the first run failed to store it)', async () => {
    const f = fakeStore()
    const parsed = parseAugustTripWorkbook(fixture)
    const failing = async () => {
      throw new Error('storage down')
    }
    const first = await runAugustImport(parsed, { ...opts, store: f.store, saveImage: failing })
    assert.strictEqual(first.created.length, 5)
    assert.strictEqual(first.pictures.attached, 0)
    assert.strictEqual(first.pictures.failed.length, 4)
    const img = counting()
    const second = await runAugustImport(parsed, { ...opts, store: f.store, saveImage: img.saveImage })
    assert.strictEqual(second.pictures.attached, 4)
    assert.strictEqual(second.created.length, 0)
  })

  test('an existing product with the same item number from another source is left alone and reported', async () => {
    const f = fakeStore()
    f.products.set('AUG-4', {
      id: 99,
      itemNumber: 'AUG-4',
      productName: 'Someone else',
      imageUrl: null,
      sourceFilename: null,
      sourceRowNumber: null,
      openingQuantity: 0,
      currentQuantity: 0,
      movementCount: 0,
      record: {} as AugustProductRecord,
    })
    const report = await runAugustImport(parseAugustTripWorkbook(fixture), {
      ...opts,
      store: f.store,
      saveImage: counting().saveImage,
    })
    assert.deepStrictEqual(report.conflicts.map((c) => c.itemNumber), ['AUG-4'])
    assert.strictEqual(f.products.get('AUG-4')!.productName, 'Someone else')
    assert.ok(!f.writes.some((w) => w.endsWith('AUG-4')))
  })
})

// ─── The real file (optional: only when it is available locally) ──────────────
const REAL_FILE = process.env.AUGUST_TRIP_XLSX
describe('the real August trip.xlsx', { skip: !REAL_FILE || !existsSync(REAL_FILE) ? 'set AUGUST_TRIP_XLSX to run' : false }, () => {
  test('50 item rows; 43 rows with an in-cell picture using all 36 images; the floating object is an empty shape', () => {
    const parsed = parseAugustTripWorkbook(readFileSync(REAL_FILE!))
    assert.strictEqual(parsed.rows.length, 50)
    assert.deepStrictEqual([parsed.rows[0].rowNumber, parsed.rows[49].rowNumber], [2, 51])
    const withPicture = parsed.rows.filter((r) => r.picture)
    assert.strictEqual(withPicture.length, 43)
    assert.ok(withPicture.every((r) => r.picture!.source === 'in-cell'))
    assert.strictEqual(parsed.matchedMediaPaths.length, 36)
    assert.deepStrictEqual(parsed.unmatchedMediaPaths, [])
    assert.deepStrictEqual(
      parsed.rows.filter((r) => !r.picture).map((r) => r.rowNumber),
      [16, 32, 33, 35, 43, 48, 49],
    )
    assert.deepStrictEqual(
      parsed.floatingObjects.map((o) => [o.cellRef, o.mediaPath]),
      [['A18', null]],
    )
    assert.strictEqual(parsed.rows.find((r) => r.rowNumber === 13)!.picture!.mediaPath, 'xl/media/image12.jpeg')
    const records = buildAugustRecords(parsed, 'August trip.xlsx')
    assert.strictEqual(records.reduce((sum, r) => sum + r.quantity, 0), 364)
    assert.strictEqual(records.filter((r) => r.missing.includes('quantity')).length, 13)
  })
})
