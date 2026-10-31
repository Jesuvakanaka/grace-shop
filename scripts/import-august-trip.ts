// ZP-468: import the August trip spreadsheet (items + pictures) as it is.
//
//   npm run import:august -- "<path/to/August trip.xlsx>" [--dry-run] [--json] [--sheet Sheet1]
//   npm run import:august -- gs://bucket/path/August-trip.xlsx --dry-run
//
// Create-only and safe to re-run (see src/lib/import/august-trip/run.ts).
// Pictures go to the storage selected by GRACE_IMAGE_STORAGE (local | gcs).
// Exit code 1 when the input cannot be read or a picture could not be stored.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import prisma from '../src/lib/db'
import { parseAugustTripWorkbook } from '../src/lib/import/august-trip/parse'
import { runAugustImport } from '../src/lib/import/august-trip/run'
import { createPrismaAugustStore } from '../src/lib/import/august-trip/prisma-store'
import { formatAugustReport } from '../src/lib/import/august-trip/report'
import { getImageStorage, saveProductImage } from '../src/lib/storage/images'
import { downloadGsObject, parseGsUri } from '../src/lib/storage/gcs'

const USAGE = 'Usage: npm run import:august -- <path-or-gs://uri> [--dry-run] [--json] [--sheet <name>]'

function usage(): never {
  console.error(USAGE)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return
  }
  const dryRun = args.includes('--dry-run')
  const json = args.includes('--json')
  const sheetIdx = args.indexOf('--sheet')
  const sheetName = sheetIdx >= 0 ? args[sheetIdx + 1] : undefined
  if (sheetIdx >= 0 && !sheetName) usage()
  const input = args.find((a, i) => !a.startsWith('--') && (sheetIdx < 0 || i !== sheetIdx + 1))
  if (!input) usage()

  const gs = parseGsUri(input)
  const bytes = gs ? await downloadGsObject(input) : await readFile(input)
  const sourceFilename = gs ? path.posix.basename(gs.object) : path.basename(input)

  const parsed = parseAugustTripWorkbook(bytes, { sheetName })
  const storage = dryRun ? null : getImageStorage()
  const report = await runAugustImport(parsed, {
    sourceFilename,
    dryRun,
    store: createPrismaAugustStore(prisma),
    saveImage: storage ? async (data) => (await saveProductImage(data, storage)).url : undefined,
  })

  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(formatAugustReport(report))
    if (storage) console.log(`\nImage storage: ${storage.kind}`)
  }
  if (report.pictures.failed.length) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
