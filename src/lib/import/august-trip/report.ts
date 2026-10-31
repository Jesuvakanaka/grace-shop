// Plain-text rendering of an AugustImportReport for the CLI (ZP-468).
import type { AugustImportReport } from './run'

export function formatAugustReport(r: AugustImportReport): string {
  const would = r.dryRun ? 'would be ' : ''
  const lines: string[] = []
  lines.push(`August trip import ${r.dryRun ? '(DRY RUN: nothing written)' : ''}`.trim())
  lines.push(`File: ${r.sourceFilename}  Sheet: ${r.sheetName}`)
  lines.push('')
  lines.push(`Rows in sheet:            ${r.rows}`)
  lines.push(`Products ${would}created:  ${r.dryRun ? r.toCreate.length : r.created.length}`)
  lines.push(`Already imported (kept):  ${r.existing.length}`)
  lines.push(`Conflicts (not touched):  ${r.conflicts.length}`)
  for (const c of r.conflicts) lines.push(`  - ${c.itemNumber}: ${c.reason}`)
  lines.push('')
  lines.push(`Pictures in file:         ${r.pictures.inFile}`)
  lines.push(`Rows with a picture:      ${r.pictures.rowsWithPicture} (using ${r.pictures.distinctMatched} distinct images)`)
  lines.push(`Unmatched pictures:       ${r.pictures.unmatched.length}${r.pictures.unmatched.length ? ` (${r.pictures.unmatched.join(', ')})` : ''}`)
  if (r.pictures.floatingWithoutPicture.length) {
    lines.push(`Floating objects without picture data (ignored): ${r.pictures.floatingWithoutPicture.join(', ')}`)
  }
  lines.push(`Pictures ${would}attached: ${r.pictures.attached}`)
  if (r.pictures.failed.length) {
    lines.push(`Pictures FAILED:          ${r.pictures.failed.length}`)
    for (const f of r.pictures.failed) lines.push(`  - ${f.itemNumber} ${f.mediaPath}: ${f.error}`)
  }
  lines.push('')
  lines.push(`Total units in sheet:     ${r.stock.totalUnits} (${r.stock.rowsWithQuantity} rows with a quantity)`)
  lines.push(`Stock movements ${would}recorded: ${r.stock.movementsCreated} (${r.stock.unitsAdded} units)`)
  lines.push(
    `Cost total (qty x unit cost, ${r.cost.rowsCounted} rows): USD ${r.cost.totalUsd.toFixed(2)} / RMB ${r.cost.totalRmb.toFixed(2)}`,
  )
  lines.push('  (assumes Price RMB / Price Cost USD are per unit; not confirmed by the owner)')
  lines.push('')
  lines.push(`Needs details: ${r.needsDetails.length} rows`)
  for (const n of r.needsDetails) {
    lines.push(`  - ${n.itemNumber.padEnd(7)} ${n.productName} -> missing ${n.missing.join(', ')}`)
  }
  if (r.warnings.length) {
    lines.push('')
    lines.push('Warnings:')
    for (const w of r.warnings) lines.push(`  - ${w}`)
  }
  return lines.join('\n')
}
