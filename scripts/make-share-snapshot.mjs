#!/usr/bin/env node
// Builds a shareable snapshot of this repo with no business data or owner photos.
//
//   node scripts/make-share-snapshot.mjs --out <path to a clone of the share repo> [--ref master]
//
// What it does:
//   1. Exports <ref> with `git archive` (no history) into <out>, keeping <out>/.git.
//   2. Removes business spreadsheets, the doc that lists real products, and the
//      deploy/rollup workflows (they only work for the real repo).
//   3. Replaces the seed spreadsheets with made-up sample data (same columns),
//      and the owner's lookbook/reference photos with plain placeholders
//      (same file names and sizes), so the app still seeds and builds.
//   4. Replaces Google Cloud identifiers and the UAT address with placeholders.
// It never commits or pushes; review <out> and commit there yourself.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const sharp = require('sharp')

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const out = arg('--out')
const ref = arg('--ref', 'master')
if (!out) {
  console.error('Usage: node scripts/make-share-snapshot.mjs --out <share repo clone> [--ref master]')
  process.exit(1)
}
const outDir = path.resolve(out)
if (outDir === repo || outDir.startsWith(repo + path.sep)) throw new Error('--out must be outside this repo')
fs.mkdirSync(outDir, { recursive: true })

// 1. Clean <out> (keep its .git) and export <ref> without history.
for (const entry of fs.readdirSync(outDir)) {
  if (entry === '.git') continue
  fs.rmSync(path.join(outDir, entry), { recursive: true, force: true })
}
// A temporary detached worktree holds exactly the tracked files of <ref>
// (portable; `tar` misreads Windows drive letters).
const exportDir = path.join(os.tmpdir(), `grace-shop-share-${Date.now()}`)
execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', exportDir, ref], { stdio: 'ignore' })
try {
  fs.cpSync(exportDir, outDir, { recursive: true, filter: (src) => path.basename(src) !== '.git' })
} finally {
  execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', exportDir], { stdio: 'ignore' })
}
const sha = execFileSync('git', ['-C', repo, 'rev-parse', '--short', ref]).toString().trim()

const rel = (p) => path.join(outDir, p)
const remove = (p) => fs.rmSync(rel(p), { recursive: true, force: true })

// 2. Remove private material.
for (const f of fs.readdirSync(rel('docs/business-control'))) {
  if (f.endsWith('.xlsx')) remove(`docs/business-control/${f}`)
}
remove('docs/business-control/04-acceptance-evidence-pack.md') // lists real products
remove('docs/august-trip')
remove('.github/workflows/deploy-uat.yml')
remove('.github/workflows/analytics-rollup.yml')

// 3a. Sample seed spreadsheets (same file names and columns the seed reads).
const products = Array.from({ length: 48 }, (_, i) => {
  const n = i + 1
  const costUsd = 4 + ((n * 7) % 23)
  return {
    'NO.': n,
    'Product name': `Sample product ${String(n).padStart(2, '0')}`,
    Quantity: 5 + ((n * 3) % 20),
    'Unit cost (RMB)': Math.round(costUsd * 7.2 * 100) / 100,
    'Unit cost (USD)': costUsd,
    'Selling price/item (RMB)': Math.round(costUsd * 2 * 7.2 * 100) / 100,
    'Selling price/item (USD)': costUsd * 2,
  }
})
const inputs = rel('docs/business-control-inputs')
fs.mkdirSync(inputs, { recursive: true })
for (const f of fs.readdirSync(inputs)) if (f.endsWith('.xlsx')) fs.rmSync(path.join(inputs, f))
{
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(products), 'Product List')
  XLSX.writeFile(wb, path.join(inputs, 'business_product_list_with_selling_prices.xlsx'))
}
{
  const wb = XLSX.utils.book_new()
  const summary = products.map((p) => ({
    'NO.': p['NO.'],
    'Product name': p['Product name'],
    'Initial stock': p.Quantity,
    'Unit cost (RMB)': p['Unit cost (RMB)'],
    'Selling price/item (RMB)': p['Selling price/item (RMB)'],
    'Unit cost (USD)': p['Unit cost (USD)'],
    'Selling price/item (USD)': p['Selling price/item (USD)'],
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary')
  XLSX.writeFile(wb, path.join(inputs, 'stock_tracking_workbook.xlsx'))
}
{
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Sample tracker – real tracker not included in the shared copy']]), 'Business Dashboard')
  XLSX.writeFile(wb, path.join(inputs, 'business_stock_cash_credit_control_tracker.xlsx'))
}

// 3b. Placeholder images with the same names and sizes.
sharp.cache(false) // sharp keeps input files open on Windows otherwise
async function placeholder(file) {
  const { width, height, format } = await sharp(fs.readFileSync(file)).metadata()
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="#EDE6D3"/>` +
      `<text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(width / 14)}" fill="#55514A">Sample image</text></svg>`,
  )
  const img = sharp(svg)
  const buf = format === 'png' ? await img.png().toBuffer() : format === 'jpeg' ? await img.jpeg().toBuffer() : await img.webp().toBuffer()
  fs.writeFileSync(file, buf)
}
for (const dir of ['public/brand/lookbook', 'docs/brand/references']) {
  if (!fs.existsSync(rel(dir))) continue
  for (const f of fs.readdirSync(rel(dir))) if (/\.(webp|png|jpe?g)$/i.test(f)) await placeholder(path.join(rel(dir), f))
}

// 4. Replace infrastructure identifiers in text files.
const swaps = [
  [/project-f4cd7300-6eb7-46cc-be3/g, 'your-gcp-project-id'],
  [/266452509449/g, '000000000000'],
  [/grace-shop-uat-3b7ugu3iea-bq\.a\.run\.app/g, 'grace-shop-uat.example.run.app'],
]
const textExt = /\.(md|ya?ml|ts|tsx|js|mjs|cjs|json|txt|sql|prisma|css|html|env\.example)$/i
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (textExt.test(e.name)) {
      const s = fs.readFileSync(p, 'utf8')
      let t = s
      for (const [re, to] of swaps) t = t.replace(re, to)
      if (t !== s) fs.writeFileSync(p, t)
    }
  }
}
walk(outDir)

fs.writeFileSync(
  rel('SHARED-COPY.md'),
  `# Shared copy of Grace Shop\n\nSnapshot of \`${ref}\` at \`${sha}\`, made with \`scripts/make-share-snapshot.mjs\`.\n\n` +
    `- Business spreadsheets are replaced with made-up sample data (\`docs/business-control-inputs/\`), so \`npm run init\` seeds 48 sample products.\n` +
    `- Owner photos are replaced with plain placeholders.\n` +
    `- Deploy workflows and cloud identifiers are removed or replaced with placeholders.\n` +
    `- No history: this repo only holds snapshots.\n`,
)
console.log(`Snapshot of ${ref} (${sha}) written to ${outDir}. Review it, then commit and push from there.`)
