// Turn parsed August trip rows into product records (ZP-468). Pure.
//
// Owner decision: import everything as it is. Values are taken exactly as
// written (rounded USD stays rounded); nothing missing is guessed. Every gap
// or oddity is written into `notes` so the owner can see what the sheet said.
import { getMissingProductDetails, type MissingProductDetail } from '@/lib/product-completeness'
import type { AugustTripRow, ParsedAugustTrip, RawCell } from './parse'

export const AUGUST_ITEM_PREFIX = 'AUG-'

export type AugustProductRecord = {
  itemNumber: string
  productName: string
  unitCostRmb: number
  unitCostUsd: number
  sellingPriceRmb: number
  sellingPriceUsd: number
  wholesalePriceUsd: number | null
  wholesaleMinQuantity: number | null
  /** Purchase quantity from the sheet; 0 when blank or not a whole number. */
  quantity: number
  notes: string
  sourceFilename: string
  sourceSheetName: string
  sourceRowNumber: number
  /** Media part of the row's picture, if any. */
  mediaPath: string | null
  /** "Needs details" reasons, as the app computes them for the created product. */
  missing: MissingProductDetail[]
}

export function augustItemNumber(rowNumber: number): string {
  return `${AUGUST_ITEM_PREFIX}${rowNumber}`
}

const quote = (s: string) => `'${s.trim()}'`

type NumberRead = { value: number | null; note: string | null }

/** A non-negative number, or null with a note when the cell holds something else. */
function readAmount(cell: RawCell, label: string): NumberRead {
  if (cell.text === null) return { value: null, note: null }
  if (cell.number !== null && cell.number >= 0) return { value: cell.number, note: null }
  return { value: null, note: `${label} cell contains ${quote(cell.text)} (not a usable number); left empty.` }
}

function readWholeNumber(cell: RawCell, label: string, min: number): NumberRead {
  if (cell.text === null) return { value: null, note: null }
  if (cell.number !== null && Number.isInteger(cell.number) && cell.number >= min) {
    return { value: cell.number, note: null }
  }
  return { value: null, note: `${label} cell contains ${quote(cell.text)} (not a whole number); left empty.` }
}

export function buildAugustRecord(
  row: AugustTripRow,
  ctx: { sourceFilename: string; sourceSheetName: string; sharedPictureRows?: number[] },
): AugustProductRecord {
  const notes: string[] = [`Imported from ${ctx.sourceFilename}, ${ctx.sourceSheetName} row ${row.rowNumber}.`]
  const c = row.cells

  const description = c.description.text?.trim() ?? ''
  const productName = description || `August trip row ${row.rowNumber} (no description)`
  if (!description) notes.push('Description blank in spreadsheet; please name this product.')

  // Quantity: never guessed. A number at the start of the description
  // ("5 White shirts") is quoted in the notes for the owner to confirm.
  const qty = readWholeNumber(c.quantity, 'Quantity', 0)
  if (qty.note) notes.push(qty.note)
  else if (qty.value === null) {
    notes.push(
      /^\s*\d/.test(description)
        ? `Quantity blank in spreadsheet; description says ${quote(description)}.`
        : 'Quantity blank in spreadsheet.',
    )
  }

  // Cost: Unit Price columns take precedence over Price RMB / Price Cost USD.
  const unitRmb = readAmount(c.unitPriceRmb, 'Unit Price RMB')
  const unitUsd = readAmount(c.unitPriceUsd, 'Unit Price USD')
  const priceRmb = readAmount(c.priceRmb, 'Price RMB')
  const priceUsd = readAmount(c.priceCostUsd, 'Price Cost USD')
  for (const r of [unitRmb, unitUsd, priceRmb, priceUsd]) if (r.note) notes.push(r.note)
  const unitCostRmb = unitRmb.value ?? priceRmb.value
  const unitCostUsd = unitUsd.value ?? priceUsd.value
  if (unitCostRmb === null && unitCostUsd === null) notes.push('Cost price (RMB and USD) blank in spreadsheet.')
  else if (unitCostRmb === null) notes.push('Cost price RMB blank in spreadsheet.')
  else if (unitCostUsd === null) notes.push('Cost price USD blank in spreadsheet.')

  const retail = readAmount(c.retail, 'Selling price Retail')
  if (retail.note) notes.push(retail.note)
  const wholesale = readAmount(c.wholesale, 'Selling price Wholesale')
  if (wholesale.note) notes.push(wholesale.note)
  const wholesaleQty = readWholeNumber(c.wholesaleQuantity, 'Wholesale Quantity', 1)
  if (wholesaleQty.note) notes.push(wholesaleQty.note)

  if (!row.picture) notes.push('No picture in spreadsheet row.')
  else if (ctx.sharedPictureRows?.length) {
    notes.push(`Same picture as spreadsheet row ${ctx.sharedPictureRows.join(', ')} (one image used in several rows).`)
  }

  const record: Omit<AugustProductRecord, 'missing'> = {
    itemNumber: augustItemNumber(row.rowNumber),
    productName,
    unitCostRmb: unitCostRmb ?? 0,
    unitCostUsd: unitCostUsd ?? 0,
    sellingPriceRmb: 0,
    sellingPriceUsd: retail.value ?? 0,
    wholesalePriceUsd: wholesale.value,
    wholesaleMinQuantity: wholesaleQty.value,
    quantity: qty.value ?? 0,
    notes: notes.join('\n'),
    sourceFilename: ctx.sourceFilename,
    sourceSheetName: ctx.sourceSheetName,
    sourceRowNumber: row.rowNumber,
    mediaPath: row.picture?.mediaPath ?? null,
  }
  const missing = getMissingProductDetails({
    ...record,
    openingQuantity: record.quantity,
    currentQuantity: record.quantity,
  })
  return { ...record, missing }
}

/** Records for every row, in sheet order. */
export function buildAugustRecords(parsed: ParsedAugustTrip, sourceFilename: string): AugustProductRecord[] {
  const rowsByMedia = new Map<string, number[]>()
  for (const row of parsed.rows) {
    if (!row.picture) continue
    const list = rowsByMedia.get(row.picture.mediaPath) ?? []
    list.push(row.rowNumber)
    rowsByMedia.set(row.picture.mediaPath, list)
  }
  return parsed.rows.map((row) =>
    buildAugustRecord(row, {
      sourceFilename,
      sourceSheetName: parsed.sheetName,
      sharedPictureRows: row.picture
        ? (rowsByMedia.get(row.picture.mediaPath) ?? []).filter((n) => n !== row.rowNumber)
        : [],
    }),
  )
}
