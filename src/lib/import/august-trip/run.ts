// Create-only, re-runnable import of the August trip rows (ZP-468).
//
// Re-run semantics:
// - itemNumber AUG-<sheet row> identifies a row. A product that already exists
//   with the same source file and row is left untouched (owner edits win).
// - A picture is attached only while the product's imageUrl is still empty.
// - The import stock movement is recorded only when the product has no stock
//   movements at all and 0 opening/current quantity, so stock never doubles.
// - An AUG-<n> product from another source is reported as a conflict, not touched.
// The database (or a fake, in tests) sits behind AugustImportStore.
import type { MissingProductDetail } from '@/lib/product-completeness'
import type { ParsedAugustTrip } from './parse'
import { buildAugustRecords, type AugustProductRecord } from './records'

export type ExistingAugustProduct = {
  id: number
  itemNumber: string
  imageUrl: string | null
  sourceFilename: string | null
  sourceRowNumber: number | null
  openingQuantity: number
  currentQuantity: number
  movementCount: number
}

export interface AugustImportStore {
  findExisting(itemNumbers: string[]): Promise<Map<string, ExistingAugustProduct>>
  /** Create the product and, when quantity > 0, its import stock movement (atomically). */
  createProduct(record: AugustProductRecord, imageUrl: string | null, actor: string): Promise<{ id: number; movementCreated: boolean }>
  /** Set imageUrl only if it is still empty. True when it was set. */
  attachImageIfEmpty(productId: number, imageUrl: string, actor: string): Promise<boolean>
  /** Record the import stock only if the product has no movements and 0 stock. True when recorded. */
  addImportStockIfNone(productId: number, quantity: number, notes: string, actor: string): Promise<boolean>
}

/** Store a picture and return its URL (for Product.imageUrl). */
export type SaveImage = (bytes: Uint8Array, mediaPath: string) => Promise<string>

export type AugustImportOptions = {
  sourceFilename: string
  store: AugustImportStore
  saveImage?: SaveImage
  dryRun?: boolean
  actor?: string
}

export type NeedsDetailsEntry = {
  itemNumber: string
  rowNumber: number
  productName: string
  missing: MissingProductDetail[]
  notes: string
}

export type AugustImportReport = {
  dryRun: boolean
  sourceFilename: string
  sheetName: string
  rows: number
  /** Item numbers that are (or, in a dry run, would be) created. */
  toCreate: string[]
  created: string[]
  /** Already imported earlier: left as they are. */
  existing: string[]
  conflicts: { itemNumber: string; reason: string }[]
  pictures: {
    inFile: number
    rowsWithPicture: number
    distinctMatched: number
    unmatched: string[]
    floatingWithoutPicture: string[]
    /** Products that got (or would get) a picture in this run. */
    attached: number
    failed: { itemNumber: string; mediaPath: string; error: string }[]
  }
  stock: {
    /** Sum of the quantities in the sheet (what the import represents). */
    totalUnits: number
    rowsWithQuantity: number
    /** Stock movements recorded (or that would be) in this run. */
    movementsCreated: number
    unitsAdded: number
  }
  /** quantity x unit cost, over rows that have both (Price RMB taken as per unit; see docs). */
  cost: { totalUsd: number; totalRmb: number; rowsCounted: number }
  needsDetails: NeedsDetailsEntry[]
  warnings: string[]
}

export const IMPORT_REFERENCE_TYPE = 'IMPORT'

export function importMovementNotes(record: AugustProductRecord): string {
  return `August trip import: ${record.sourceFilename}, ${record.sourceSheetName} row ${record.sourceRowNumber} (${record.itemNumber})`
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function runAugustImport(parsed: ParsedAugustTrip, options: AugustImportOptions): Promise<AugustImportReport> {
  const { store, sourceFilename } = options
  const dryRun = options.dryRun ?? false
  const actor = options.actor ?? 'august-import'
  if (!dryRun && !options.saveImage) throw new Error('saveImage is required for a real import')

  const records = buildAugustRecords(parsed, sourceFilename)
  const existing = await store.findExisting(records.map((r) => r.itemNumber))

  const report: AugustImportReport = {
    dryRun,
    sourceFilename,
    sheetName: parsed.sheetName,
    rows: records.length,
    toCreate: [],
    created: [],
    existing: [],
    conflicts: [],
    pictures: {
      inFile: parsed.mediaPaths.length,
      rowsWithPicture: records.filter((r) => r.mediaPath).length,
      distinctMatched: parsed.matchedMediaPaths.length,
      unmatched: parsed.unmatchedMediaPaths,
      floatingWithoutPicture: parsed.floatingObjects.filter((o) => !o.mediaPath).map((o) => o.cellRef),
      attached: 0,
      failed: [],
    },
    stock: {
      totalUnits: records.reduce((sum, r) => sum + r.quantity, 0),
      rowsWithQuantity: records.filter((r) => r.quantity > 0).length,
      movementsCreated: 0,
      unitsAdded: 0,
    },
    cost: { totalUsd: 0, totalRmb: 0, rowsCounted: 0 },
    needsDetails: records
      .filter((r) => r.missing.length)
      .map((r) => ({
        itemNumber: r.itemNumber,
        rowNumber: r.sourceRowNumber,
        productName: r.productName,
        missing: r.missing,
        notes: r.notes,
      })),
    warnings: [...parsed.warnings],
  }
  for (const r of records) {
    if (r.quantity > 0 && (r.unitCostUsd > 0 || r.unitCostRmb > 0)) {
      report.cost.totalUsd += r.quantity * r.unitCostUsd
      report.cost.totalRmb += r.quantity * r.unitCostRmb
      report.cost.rowsCounted++
    }
  }
  report.cost.totalUsd = round2(report.cost.totalUsd)
  report.cost.totalRmb = round2(report.cost.totalRmb)

  // One stored picture per media part, even when several rows share it.
  const urlByMedia = new Map<string, Promise<string>>()
  const pictureUrl = async (record: AugustProductRecord): Promise<string | null> => {
    if (!record.mediaPath || !options.saveImage) return null
    const bytes = parsed.media.get(record.mediaPath)
    if (!bytes) {
      report.pictures.failed.push({ itemNumber: record.itemNumber, mediaPath: record.mediaPath, error: 'missing from file' })
      return null
    }
    if (!urlByMedia.has(record.mediaPath)) urlByMedia.set(record.mediaPath, options.saveImage(bytes, record.mediaPath))
    try {
      return await urlByMedia.get(record.mediaPath)!
    } catch (err) {
      report.pictures.failed.push({
        itemNumber: record.itemNumber,
        mediaPath: record.mediaPath,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  for (const record of records) {
    const found = existing.get(record.itemNumber)

    if (!found) {
      report.toCreate.push(record.itemNumber)
      if (dryRun) {
        if (record.mediaPath) report.pictures.attached++
        if (record.quantity > 0) {
          report.stock.movementsCreated++
          report.stock.unitsAdded += record.quantity
        }
        continue
      }
      const url = await pictureUrl(record)
      const result = await store.createProduct(record, url, actor)
      report.created.push(record.itemNumber)
      if (url) report.pictures.attached++
      if (result.movementCreated) {
        report.stock.movementsCreated++
        report.stock.unitsAdded += record.quantity
      }
      continue
    }

    if (found.sourceFilename !== record.sourceFilename || found.sourceRowNumber !== record.sourceRowNumber) {
      report.conflicts.push({
        itemNumber: record.itemNumber,
        reason: `exists with source ${found.sourceFilename ?? '(none)'} row ${found.sourceRowNumber ?? '(none)'}; left unchanged`,
      })
      continue
    }

    report.existing.push(record.itemNumber)
    const needsPicture = !!record.mediaPath && !found.imageUrl
    const needsStock =
      record.quantity > 0 && found.movementCount === 0 && found.openingQuantity === 0 && found.currentQuantity === 0
    if (dryRun) {
      if (needsPicture) report.pictures.attached++
      if (needsStock) {
        report.stock.movementsCreated++
        report.stock.unitsAdded += record.quantity
      }
      continue
    }
    if (needsPicture) {
      const url = await pictureUrl(record)
      if (url && (await store.attachImageIfEmpty(found.id, url, actor))) report.pictures.attached++
    }
    if (needsStock && (await store.addImportStockIfNone(found.id, record.quantity, importMovementNotes(record), actor))) {
      report.stock.movementsCreated++
      report.stock.unitsAdded += record.quantity
    }
  }

  return report
}
