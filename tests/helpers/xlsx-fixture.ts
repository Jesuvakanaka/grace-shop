// Builds small synthetic .xlsx packages for the ZP-468 parser tests.
// Mirrors the structure of the real "August trip.xlsx": "Place in cell"
// pictures through xl/metadata.xml + xl/richData/*, and a sheet drawing with
// floating objects. Lives outside tests/*.test.ts, so it is not run as a test.
import { zipSync, strToU8 } from 'fflate'

export type FixtureCell =
  | { t: 's'; text: string } // shared string
  | { t: 'n'; value: number }
  | { t: 'img'; image: number } // in-cell picture: index into `images`

export type FixtureFloating = {
  /** 0-based row/col of the anchor's top-left corner (as in drawing XML). */
  row: number
  col: number
  /** Index into `images`; omit for an empty shape (no picture). */
  image?: number
  name?: string
}

export type FixtureSpec = {
  sheetName?: string
  /** Row number (1-based) -> column letter -> cell. */
  rows: Record<number, Record<string, FixtureCell>>
  /** Media files, stored as xl/media/image<i+1>.<ext>. */
  images: { ext: 'png' | 'jpeg'; bytes: Uint8Array }[]
  floating?: FixtureFloating[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function buildXlsx(spec: FixtureSpec): Uint8Array {
  const sheetName = spec.sheetName ?? 'Sheet1'
  const strings: string[] = []
  const stringIndex = (s: string) => {
    const i = strings.indexOf(s)
    if (i >= 0) return i
    strings.push(s)
    return strings.length - 1
  }

  // In-cell pictures: one rich value per distinct image used in a cell, like Excel.
  const rvForImage = new Map<number, number>() // image index -> rich value index
  const richImageOrder: number[] = []
  const vmFor = (image: number) => {
    if (!rvForImage.has(image)) {
      rvForImage.set(image, richImageOrder.length)
      richImageOrder.push(image)
    }
    return rvForImage.get(image)! + 1 // vm is 1-based
  }

  const rowXml = Object.keys(spec.rows)
    .map(Number)
    .sort((a, b) => a - b)
    .map((r) => {
      const cells = Object.entries(spec.rows[r])
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([col, cell]) => {
          const ref = `${col}${r}`
          if (cell.t === 's') return `<c r="${ref}" t="s"><v>${stringIndex(cell.text)}</v></c>`
          if (cell.t === 'n') return `<c r="${ref}"><v>${cell.value}</v></c>`
          return `<c r="${ref}" t="e" vm="${vmFor(cell.image)}"><v>#VALUE!</v></c>`
        })
        .join('')
      return `<row r="${r}">${cells}</row>`
    })
    .join('')

  const files: Record<string, Uint8Array> = {}
  const put = (p: string, s: string) => (files[p] = strToU8(s))
  const mediaName = (i: number) => `image${i + 1}.${spec.images[i].ext}`
  spec.images.forEach((img, i) => (files[`xl/media/${mediaName(i)}`] = img.bytes))

  put(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  )
  put(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  )
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const MS = 'http://schemas.microsoft.com/office'
  put(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId4" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>` +
      `<Relationship Id="rId5" Type="${R}/sheetMetadata" Target="metadata.xml"/>` +
      `<Relationship Id="rId6" Type="${MS}/2022/10/relationships/richValueRel" Target="richData/richValueRel.xml"/>` +
      `<Relationship Id="rId7" Type="${MS}/2017/06/relationships/rdRichValue" Target="richData/rdrichvalue.xml"/>` +
      `<Relationship Id="rId8" Type="${MS}/2017/06/relationships/rdRichValueStructure" Target="richData/rdrichvaluestructure.xml"/>` +
      `</Relationships>`,
  )

  const hasDrawing = (spec.floating ?? []).length > 0
  put(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><cols><col min="1" max="1" width="20"/></cols><sheetData>${rowXml}</sheetData>${hasDrawing ? '<drawing r:id="rId1"/>' : ''}</worksheet>`,
  )
  if (hasDrawing) {
    put(
      'xl/worksheets/_rels/sheet1.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    )
    const drawingRels: string[] = []
    const anchors = (spec.floating ?? [])
      .map((f, i) => {
        const from = `<xdr:from><xdr:col>${f.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${f.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${f.col}</xdr:col><xdr:colOff>304800</xdr:colOff><xdr:row>${f.row}</xdr:row><xdr:rowOff>304800</xdr:rowOff></xdr:to>`
        const name = esc(f.name ?? `Object ${i + 1}`)
        if (f.image === undefined) {
          return `<xdr:twoCellAnchor editAs="oneCell">${from}<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${1025 + i}" name="${name}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></xdr:spPr></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`
        }
        const rid = `rId${drawingRels.length + 1}`
        drawingRels.push(`<Relationship Id="${rid}" Type="${R}/image" Target="../media/${mediaName(f.image)}"/>`)
        return `<xdr:twoCellAnchor editAs="oneCell">${from}<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${2 + i}" name="${name}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`
      })
      .join('')
    put(
      'xl/drawings/drawing1.xml',
      `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}">${anchors}</xdr:wsDr>`,
    )
    if (drawingRels.length) {
      put(
        'xl/drawings/_rels/drawing1.xml.rels',
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels.join('')}</Relationships>`,
      )
    }
  }

  put(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((s) => (s !== s.trim() ? `<si><t xml:space="preserve">${esc(s)}</t></si>` : `<si><t>${esc(s)}</t></si>`))
      .join('')}</sst>`,
  )

  const n = richImageOrder.length
  const rvb = richImageOrder
    .map((_, i) => `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${i}"/></ext></extLst></bk>`)
    .join('')
  const vmBlocks = richImageOrder.map((_, i) => `<bk><rc t="1" v="${i}"/></bk>`).join('')
  put(
    'xl/metadata.xml',
    `<?xml version="1.0" encoding="UTF-8"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="${MS}/spreadsheetml/2017/richdata"><metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000"/></metadataTypes><futureMetadata name="XLRICHVALUE" count="${n}">${rvb}</futureMetadata><valueMetadata count="${n}">${vmBlocks}</valueMetadata></metadata>`,
  )
  put(
    'xl/richData/rdrichvalue.xml',
    `<?xml version="1.0" encoding="UTF-8"?><rvData xmlns="${MS}/spreadsheetml/2017/richdata" count="${n}">${richImageOrder
      .map((_, i) => `<rv s="0"><v>${i}</v><v>5</v></rv>`)
      .join('')}</rvData>`,
  )
  put(
    'xl/richData/rdrichvaluestructure.xml',
    `<?xml version="1.0" encoding="UTF-8"?><rvStructures xmlns="${MS}/spreadsheetml/2017/richdata" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`,
  )
  // Deliberately list rel ids in an order different from the media numbering,
  // and the .rels entries shuffled, like Excel does.
  put(
    'xl/richData/richValueRel.xml',
    `<?xml version="1.0" encoding="UTF-8"?><richValueRels xmlns="${MS}/spreadsheetml/2022/richvaluerel" xmlns:r="${R}">${richImageOrder
      .map((img) => `<rel r:id="rIdImg${img}"/>`)
      .join('')}</richValueRels>`,
  )
  put(
    'xl/richData/_rels/richValueRel.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...richImageOrder]
      .reverse()
      .map((img) => `<Relationship Id="rIdImg${img}" Type="${R}/image" Target="../media/${mediaName(img)}"/>`)
      .join('')}</Relationships>`,
  )

  return zipSync(files)
}
