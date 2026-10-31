// Pure parser for the "August trip" spreadsheet (ZP-468).
//
// Reads the first worksheet (or the one named in options) of an .xlsx file:
// - cell values (shared strings, inline strings, numbers), mapped by header name;
// - "Place in cell" pictures: cell vm attribute -> xl/metadata.xml ->
//   xl/richData/rdrichvalue.xml (+ structure) -> richValueRel.xml -> its .rels
//   -> xl/media/*;
// - floating pictures in the sheet's drawing (xdr:pic with an a:blip), mapped
//   to the row their top-left corner is anchored to.
// No database, no image processing: callers get raw media bytes per row.
import { findElements, findFirstElement, textOfRuns, decodeXmlText } from './xml'
import {
  readXlsxPackage,
  readPartText,
  readRelationships,
  findRelByType,
  type XlsxPackage,
} from './package'

export const AUGUST_TRIP_FIELDS = [
  'picture',
  'description',
  'quantity',
  'priceRmb',
  'priceCostUsd',
  'unitPriceRmb',
  'unitPriceUsd',
  'retail',
  'wholesale',
  'wholesaleQuantity',
] as const
export type AugustTripField = (typeof AUGUST_TRIP_FIELDS)[number]

/** Header text (normalised: lowercase letters and digits only) -> field. */
const HEADER_ALIASES: Record<string, AugustTripField> = {
  pictureitem: 'picture',
  picture: 'picture',
  description: 'description',
  quantity: 'quantity',
  quanity: 'quantity', // spelled this way in the August trip file
  qty: 'quantity',
  pricermb: 'priceRmb',
  pricecostusd: 'priceCostUsd',
  unitpricermb: 'unitPriceRmb',
  unitpriceusd: 'unitPriceUsd',
  sellingpriceretail: 'retail',
  sellingpricewholesale: 'wholesale',
  wholesalequantity: 'wholesaleQuantity',
  wholesalequanity: 'wholesaleQuantity',
}

export function normaliseHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** A cell exactly as written. `text` is null for an empty cell. */
export type RawCell = {
  /** The cell's text as written ("35", "\", "5 White shirts"); null when blank. */
  text: string | null
  /** The numeric value when the cell is a number (or plain numeric text); otherwise null. */
  number: number | null
}

export type PictureRef = {
  /** Part path in the package, e.g. "xl/media/image13.jpeg". */
  mediaPath: string
  source: 'in-cell' | 'floating'
  /** Cell reference holding the in-cell picture, or the drawing anchor cell. */
  cellRef: string
}

export type AugustTripRow = {
  /** 1-based worksheet row number, as Excel shows it. */
  rowNumber: number
  cells: Record<Exclude<AugustTripField, 'picture'>, RawCell>
  picture: PictureRef | null
}

export type FloatingObject = {
  rowNumber: number
  cellRef: string
  name: string | null
  /** Media path when the object is a picture; null for a shape with no image. */
  mediaPath: string | null
}

export type ParsedAugustTrip = {
  sheetName: string
  headerRowNumber: number
  /** Field -> column letter, for the columns that were found. */
  columns: Partial<Record<AugustTripField, string>>
  rows: AugustTripRow[]
  /** Every media part in the package (xl/media/*). */
  mediaPaths: string[]
  /** Media referenced by at least one row. */
  matchedMediaPaths: string[]
  /** Media not referenced by any row. */
  unmatchedMediaPaths: string[]
  floatingObjects: FloatingObject[]
  warnings: string[]
  /** Raw media bytes by part path (for matched media only). */
  media: Map<string, Uint8Array>
}

const EMPTY: RawCell = { text: null, number: null }

/** "AB12" -> { col: "AB", row: 12 } */
export function splitCellRef(ref: string): { col: string; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  return m ? { col: m[1], row: Number(m[2]) } : null
}

/** 0-based column index -> letters (0 -> "A"). */
export function columnLetters(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

function rawFromText(text: string): RawCell {
  const trimmed = text.trim()
  if (trimmed === '') return EMPTY
  return { text, number: PLAIN_NUMBER.test(trimmed) ? Number(trimmed) : null }
}

function readSharedStrings(pkg: XlsxPackage, workbookPart: string): string[] {
  const rel = findRelByType(readRelationships(pkg, workbookPart), '/sharedStrings')
  const xml = rel ? readPartText(pkg, rel.target) : null
  if (!xml) return []
  return findElements(xml, 'si').map((si) => textOfRuns(si.inner))
}

/**
 * Map of cell `vm` value (1-based index into valueMetadata) -> media part path,
 * following the rich-value chain used by "Place in cell" pictures.
 */
export function resolveInCellImages(pkg: XlsxPackage, workbookPart: string, warnings: string[]): Map<number, string> {
  const result = new Map<number, string>()
  const wbRels = readRelationships(pkg, workbookPart)
  const metadataRel = findRelByType(wbRels, '/sheetMetadata')
  const richValueRel = findRelByType(wbRels, '/rdRichValue')
  const structureRel = findRelByType(wbRels, '/rdRichValueStructure')
  const relListRel = findRelByType(wbRels, '/richValueRel')
  if (!metadataRel || !richValueRel || !relListRel) return result

  const metadataXml = readPartText(pkg, metadataRel.target)
  const richValueXml = readPartText(pkg, richValueRel.target)
  const relListXml = readPartText(pkg, relListRel.target)
  const structureXml = structureRel ? readPartText(pkg, structureRel.target) : null
  if (!metadataXml || !richValueXml || !relListXml) return result

  // metadataTypes: 1-based list of type names.
  const metadataTypes = findElements(metadataXml, 'metadataType').map((t) => t.attrs.name)
  // futureMetadata blocks by name; each <bk> holds an <xlrd:rvb i="..."/>.
  const futureByName = new Map<string, (number | null)[]>()
  for (const fm of findElements(metadataXml, 'futureMetadata')) {
    const list = findElements(fm.inner, 'bk').map((bk) => {
      const rvb = findFirstElement(bk.inner, 'xlrd:rvb')
      return rvb && rvb.attrs.i !== undefined ? Number(rvb.attrs.i) : null
    })
    futureByName.set(fm.attrs.name, list)
  }
  const valueMetadataEl = findFirstElement(metadataXml, 'valueMetadata')
  const valueBlocks = valueMetadataEl ? findElements(valueMetadataEl.inner, 'bk') : []

  // Rich value structures: index -> position of the image relationship key.
  const structures = structureXml
    ? findElements(structureXml, 's').map((s) => {
        const keys = findElements(s.inner, 'k').map((k) => k.attrs.n)
        return { type: s.attrs.t, imageKeyIndex: keys.indexOf('_rvRel:LocalImageIdentifier') }
      })
    : []
  const richValues = findElements(richValueXml, 'rv').map((rv) => ({
    structure: Number(rv.attrs.s),
    values: findElements(rv.inner, 'v').map((v) => decodeXmlText(v.inner)),
  }))
  const relIds = findElements(relListXml, 'rel').map((r) => r.attrs['r:id'])
  const relTargets = readRelationships(pkg, relListRel.target)

  valueBlocks.forEach((bk, i) => {
    const vm = i + 1
    const rc = findFirstElement(bk.inner, 'rc')
    if (!rc) return
    const typeName = metadataTypes[Number(rc.attrs.t) - 1]
    if (typeName !== 'XLRICHVALUE') return
    const rvIndex = futureByName.get(typeName)?.[Number(rc.attrs.v)]
    if (rvIndex === null || rvIndex === undefined) return
    const rv = richValues[rvIndex]
    if (!rv) {
      warnings.push(`Rich value ${rvIndex} (vm=${vm}) is missing from the rich value list.`)
      return
    }
    // Without a structure file, Excel's _localImage structure puts the image key first.
    const keyIndex = structures[rv.structure]?.imageKeyIndex ?? 0
    if (keyIndex < 0) return // a rich value that is not a local image
    const relIndex = Number(rv.values[keyIndex])
    const relId = relIds[relIndex]
    const target = relId ? relTargets.get(relId) : undefined
    if (!target || target.external) {
      warnings.push(`In-cell picture vm=${vm} points to a missing or external image.`)
      return
    }
    result.set(vm, target.target)
  })
  return result
}

/** Floating objects (pictures and shapes) of a worksheet's drawing, by anchor row. */
export function readFloatingObjects(pkg: XlsxPackage, sheetPart: string): FloatingObject[] {
  const drawingRel = findRelByType(readRelationships(pkg, sheetPart), '/drawing')
  if (!drawingRel) return []
  const xml = readPartText(pkg, drawingRel.target)
  if (!xml) return []
  const drawingRels = readRelationships(pkg, drawingRel.target)
  const anchors = [
    ...findElements(xml, 'xdr:twoCellAnchor'),
    ...findElements(xml, 'xdr:oneCellAnchor'),
  ]
  const out: FloatingObject[] = []
  for (const anchor of anchors) {
    const from = findFirstElement(anchor.inner, 'xdr:from')
    if (!from) continue
    const col = Number(findFirstElement(from.inner, 'xdr:col')?.inner ?? NaN)
    const row = Number(findFirstElement(from.inner, 'xdr:row')?.inner ?? NaN)
    if (!Number.isInteger(col) || !Number.isInteger(row)) continue
    const cNvPr = findFirstElement(anchor.inner, 'xdr:cNvPr')
    const blip = findFirstElement(anchor.inner, 'a:blip')
    const embed = blip?.attrs['r:embed']
    const rel = embed ? drawingRels.get(embed) : undefined
    out.push({
      rowNumber: row + 1,
      cellRef: `${columnLetters(col)}${row + 1}`,
      name: cNvPr?.attrs.name ?? null,
      mediaPath: rel && !rel.external ? rel.target : null,
    })
  }
  return out.sort((a, b) => a.rowNumber - b.rowNumber)
}

export type ParseOptions = { sheetName?: string }

export function parseAugustTripWorkbook(bytes: Uint8Array, options: ParseOptions = {}): ParsedAugustTrip {
  const pkg = readXlsxPackage(bytes)
  const warnings: string[] = []

  const workbookPart = 'xl/workbook.xml'
  const workbookXml = readPartText(pkg, workbookPart)
  if (!workbookXml) throw new Error('Not an Excel workbook: xl/workbook.xml is missing.')
  const sheets = findElements(workbookXml, 'sheet').map((s) => ({ name: s.attrs.name, relId: s.attrs['r:id'] }))
  const sheet = options.sheetName ? sheets.find((s) => s.name === options.sheetName) : sheets[0]
  if (!sheet) throw new Error(options.sheetName ? `Sheet "${options.sheetName}" not found.` : 'Workbook has no sheets.')
  const sheetRel = readRelationships(pkg, workbookPart).get(sheet.relId)
  const sheetXml = sheetRel ? readPartText(pkg, sheetRel.target) : null
  if (!sheetRel || !sheetXml) throw new Error(`Worksheet part for "${sheet.name}" is missing.`)

  const sharedStrings = readSharedStrings(pkg, workbookPart)
  const vmImages = resolveInCellImages(pkg, workbookPart, warnings)

  // Read every cell: row -> col -> { raw, vm }.
  type Cell = { raw: RawCell; vm: number | null }
  const grid = new Map<number, Map<string, Cell>>()
  const sheetData = findFirstElement(sheetXml, 'sheetData')
  for (const rowEl of findElements(sheetData?.inner ?? '', 'row')) {
    for (const c of findElements(rowEl.inner, 'c')) {
      const pos = splitCellRef(c.attrs.r ?? '')
      if (!pos) continue
      const type = c.attrs.t
      const v = findFirstElement(c.inner, 'v')
      const vText = v ? decodeXmlText(v.inner) : null
      let raw: RawCell = EMPTY
      if (type === 's') raw = vText === null ? EMPTY : rawFromText(sharedStrings[Number(vText)] ?? '')
      else if (type === 'inlineStr') raw = rawFromText(textOfRuns(findFirstElement(c.inner, 'is')?.inner ?? ''))
      else if (type === 'str') raw = vText === null ? EMPTY : rawFromText(vText)
      else if (type === 'e' || type === 'b') raw = EMPTY // errors (#VALUE! under pictures) and booleans
      else if (vText !== null && vText.trim() !== '') {
        const n = Number(vText)
        raw = { text: vText, number: Number.isFinite(n) ? n : null }
      }
      const vm = c.attrs.vm !== undefined ? Number(c.attrs.vm) : null
      if (!grid.has(pos.row)) grid.set(pos.row, new Map())
      grid.get(pos.row)!.set(pos.col, { raw, vm })
    }
  }

  // Header row: the first row in which a "Description" header appears.
  const rowNumbers = [...grid.keys()].sort((a, b) => a - b)
  let headerRowNumber = -1
  const columns: Partial<Record<AugustTripField, string>> = {}
  for (const r of rowNumbers) {
    const found: Partial<Record<AugustTripField, string>> = {}
    for (const [col, cell] of grid.get(r)!) {
      const field = cell.raw.text ? HEADER_ALIASES[normaliseHeader(cell.raw.text)] : undefined
      if (field && !found[field]) found[field] = col
    }
    if (found.description) {
      headerRowNumber = r
      Object.assign(columns, found)
      break
    }
  }
  if (headerRowNumber < 0) throw new Error('Header row with a "Description" column not found.')
  for (const field of AUGUST_TRIP_FIELDS) {
    if (!columns[field] && field !== 'picture') warnings.push(`Column for "${field}" not found; treated as blank.`)
  }
  const pictureCol = columns.picture ?? 'A'

  const floatingObjects = readFloatingObjects(pkg, sheetRel.target)
  const floatingByRow = new Map<number, FloatingObject>()
  for (const obj of floatingObjects) {
    if (!obj.mediaPath) {
      warnings.push(
        `Floating object "${obj.name ?? 'unnamed'}" at ${obj.cellRef} has no picture data (an empty shape); ignored.`,
      )
      continue
    }
    if (!floatingByRow.has(obj.rowNumber)) floatingByRow.set(obj.rowNumber, obj)
    else warnings.push(`Second floating picture at ${obj.cellRef} ignored (row already has one).`)
  }

  const rows: AugustTripRow[] = []
  const usedFloating = new Set<FloatingObject>()
  for (const r of rowNumbers) {
    if (r <= headerRowNumber) continue
    const cellsInRow = grid.get(r)!
    const get = (field: AugustTripField): RawCell => {
      const col = columns[field]
      return (col && cellsInRow.get(col)?.raw) || EMPTY
    }

    // In-cell picture: prefer the picture column, else any cell with an image.
    let picture: PictureRef | null = null
    const candidates = [...cellsInRow.entries()].sort(([a], [b]) => (a === pictureCol ? -1 : b === pictureCol ? 1 : 0))
    for (const [col, cell] of candidates) {
      if (cell.vm === null) continue
      const mediaPath = vmImages.get(cell.vm)
      if (mediaPath) {
        picture = { mediaPath, source: 'in-cell', cellRef: `${col}${r}` }
        break
      }
      warnings.push(`Cell ${col}${r} has rich value vm=${cell.vm} but no image could be resolved.`)
    }
    const floating = floatingByRow.get(r)
    if (floating) {
      if (!picture) picture = { mediaPath: floating.mediaPath!, source: 'floating', cellRef: floating.cellRef }
      else warnings.push(`Row ${r} has an in-cell picture and a floating picture; the in-cell one is used.`)
      usedFloating.add(floating)
    }

    const description = get('description')
    const hasAnyValue =
      picture !== null || AUGUST_TRIP_FIELDS.some((f) => f !== 'picture' && get(f).text !== null)
    if (!hasAnyValue) continue

    rows.push({
      rowNumber: r,
      picture,
      cells: {
        description,
        quantity: get('quantity'),
        priceRmb: get('priceRmb'),
        priceCostUsd: get('priceCostUsd'),
        unitPriceRmb: get('unitPriceRmb'),
        unitPriceUsd: get('unitPriceUsd'),
        retail: get('retail'),
        wholesale: get('wholesale'),
        wholesaleQuantity: get('wholesaleQuantity'),
      },
    })
  }
  for (const obj of floatingByRow.values()) {
    if (!usedFloating.has(obj)) warnings.push(`Floating picture at ${obj.cellRef} is not on an item row; ignored.`)
  }

  const mediaPaths = [...pkg.parts.keys()].filter((p) => p.startsWith('xl/media/')).sort(naturalCompare)
  const matched = new Set(rows.map((row) => row.picture?.mediaPath).filter((p): p is string => !!p))
  const media = new Map<string, Uint8Array>()
  for (const p of matched) {
    const data = pkg.parts.get(p)
    if (data) media.set(p, data)
    else warnings.push(`Picture ${p} is referenced but missing from the file.`)
  }

  return {
    sheetName: sheet.name,
    headerRowNumber,
    columns,
    rows,
    mediaPaths,
    matchedMediaPaths: [...matched].sort(naturalCompare),
    unmatchedMediaPaths: mediaPaths.filter((p) => !matched.has(p)),
    floatingObjects,
    warnings,
    media,
  }
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true })
}
