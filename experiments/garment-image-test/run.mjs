#!/usr/bin/env node
// Standalone test: turn raw garment photos into model photos with OpenAI's
// GPT Image 2.5 edit API, at medium and high quality, and build a page to
// compare them by eye.
//
// Not part of the shop. Nothing here is imported by the site, deployed, or
// touches the database or stored product images. See README.md.
//
// Usage:
//   OPENAI_API_KEY=sk-... node run.mjs [--limit 2] [--model gpt-image-2.5-sunburst]
//   node run.mjs --dry-run        # list what would run and the estimated cost, no API calls
//   node run.mjs --page-only      # rebuild test-output/index.html from saved results

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Settings (checked against OpenAI's docs on 2026-11-26)
// ---------------------------------------------------------------------------

// Model IDs listed in the Image API reference: gpt-image-2.5-flare and
// gpt-image-2.5-sunburst (plus dated snapshots ending -2026-09-08).
const DEFAULT_MODEL = 'gpt-image-2.5-flare'
const DEFAULT_QUALITIES = ['medium', 'high'] // API values: low | medium | high | auto (2.5 also: xhigh | max)
const SIZE = '1024x1536' // portrait, about 1K
const INPUT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']) // formats the edit API accepts

// Standard prices per 1M tokens for gpt-image-2.5-flare and -sunburst
// (https://developers.openai.com/api/docs/pricing). Same for both models.
const PRICE_PER_M = { textInput: 5.0, imageInput: 8.0, imageOutput: 30.0 }

// Rough per-image guesses, used only for --dry-run and if a response has no
// usage data. OpenAI does not publish token counts per 2.5 image, so these
// come from older GPT Image models at 1024x1536.
const GUESS_USD = { low: 0.02, medium: 0.06, high: 0.2, xhigh: 0.3, max: 0.4, auto: 0.2 }
const GUESS_INPUT_USD = { front: 0.015, angled: 0.03, back: 0.03 } // reference pictures + prompt

// When a model reference picture is given (--model-ref, or one picture in the
// model-reference/ folder), this replaces the fictional-model description.
const MODEL_REF_LOOK =
  'The model is the woman shown in the LAST reference image: keep her face, hair, skin tone, body shape and proportions exactly the same, so she is clearly the same person. ' +
  'Use that image only for who the model is. Ignore her clothing, pose and background there: she wears only the garment from the first reference image, styled as described.'

// VYRA theme colours, from src/app/globals.css (--color-bg, --color-surface-raised, --color-accent).
const THEME_BACKGROUND =
  'a soft warm cream (#EDE6D3 to #F6F2E8) seamless studio backdrop with subtle olive green (#5F7A1F) undertones'

// Describes the one fictional model used for every picture. Edit this, or pass
// --model-look "...", to change who wears the clothes.
const DEFAULT_MODEL_LOOK =
  'The same fictional adult fashion model appears in every picture: an invented person who does not resemble any real individual, with a natural, elegant look and a relaxed, confident pose.'

const BASE_PROMPT =
  'Professional photorealistic fashion photograph of an elegant model wearing the exact garment from the reference photo. ' +
  'Preserve the garment exactly: same colour, fabric texture, cut, length, buttons, trims, prints and stitching. ' +
  'Do not redesign, simplify or add details. Remove hangers, price tags and shop clutter. ' +
  'Full-body framing, flattering natural lighting, realistic skin, hands and fabric draping. ' +
  `Clean background in ${THEME_BACKGROUND} that does not overpower the clothing. ` +
  'No text, logos, watermarks or borders.'

// The base prompt above is Michael's wording. One clarification is added so the
// "no logos" rule doesn't strip labels and patches that are part of the garment.
const PROMPT_CLARIFICATION =
  'The "no text or logos" rule means nothing added to the picture: keep any label, patch or badge that is sewn onto the garment itself.'

// The front view is made first from the garment photo alone. The other two
// views also get the front result as a second reference, so the same model,
// styling and background carry through.
const VIEWS = [
  {
    id: 'front',
    label: 'Front',
    usesFront: false,
    text: 'View: straight-on front view, the model facing the camera.',
  },
  {
    id: 'angled',
    label: 'Angled',
    usesFront: true,
    text:
      'View: three-quarter angled view, the model turned about 45 degrees. ' +
      'The first reference image is the garment; the second is the front view already made. ' +
      'Use the same model, face, hair, styling, lighting and background as the second reference image.',
  },
  {
    id: 'back',
    label: 'Back or detail',
    usesFront: true,
    text:
      'View: back view of the model, showing the back of the garment. If the back is not visible in the garment photo, ' +
      'instead show a closer detail shot of the most distinctive part of the garment (fabric, trims, buttons or print), still worn by the model. ' +
      'The first reference image is the garment; the second is the front view already made. ' +
      'Use the same model, hair, styling, lighting and background as the second reference image.',
  },
]

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    limit: Infinity,
    model: process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL,
    qualities: DEFAULT_QUALITIES,
    input: path.join(HERE, 'test-input'),
    output: path.join(HERE, 'test-output'),
    modelLook: null, // set below: --model-look, else model reference text, else DEFAULT_MODEL_LOOK
    modelRef: null,
    dryRun: false,
    pageOnly: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${arg} needs a value`)
      return v
    }
    if (arg === '--limit') {
      opts.limit = Number(next())
      if (!Number.isInteger(opts.limit) || opts.limit < 1) throw new Error('--limit must be a whole number of 1 or more')
    } else if (arg === '--model') opts.model = next()
    else if (arg === '--quality' || arg === '--qualities') opts.qualities = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (arg === '--input') opts.input = path.resolve(next())
    else if (arg === '--output') opts.output = path.resolve(next())
    else if (arg === '--model-look') opts.modelLook = next()
    else if (arg === '--model-ref') opts.modelRef = path.resolve(next())
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--page-only') opts.pageOnly = true
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node run.mjs [--limit N] [--model ID] [--quality medium,high] [--input DIR] [--output DIR]\n' +
          '                   [--model-look "description"] [--model-ref picture.jpg] [--dry-run] [--page-only]',
      )
      process.exit(0)
    } else throw new Error(`Unknown option: ${arg}`)
  }
  return opts
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const usd = (n) => `$${n.toFixed(n < 1 ? 3 : 2)}`

function slugify(name) {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'garment'
  )
}

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readJson(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'))
  } catch {
    return fallback
  }
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase()
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
}

/** Cost in USD from the usage object the Image API returns. */
export function costFromUsage(usage) {
  if (!usage) return null
  const textIn = usage.input_tokens_details?.text_tokens ?? 0
  const imageIn = usage.input_tokens_details?.image_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - textIn)
  const out = usage.output_tokens ?? 0
  return (textIn * PRICE_PER_M.textInput + imageIn * PRICE_PER_M.imageInput + out * PRICE_PER_M.imageOutput) / 1e6
}

async function listGarments(inputDir) {
  let entries
  try {
    entries = await fs.readdir(inputDir, { withFileTypes: true })
  } catch {
    throw new Error(`Input folder not found: ${inputDir}\nCreate it and add your garment photos.`)
  }
  const garments = []
  const seen = new Map()
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isFile() || e.name.startsWith('.')) continue
    const ext = path.extname(e.name).toLowerCase()
    if (ext === '.txt') continue // notes, read with their photo below
    if (!INPUT_EXTENSIONS.has(ext)) {
      console.warn(`  Skipping ${e.name}: only JPG, PNG and WebP are accepted (export HEIC photos as JPG first).`)
      continue
    }
    let name = slugify(path.basename(e.name, ext))
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    if (n > 1) name = `${name}-${n}`
    // Optional notes for one garment: a .txt file with the same name as the photo
    // (e.g. denim-dress.jpg + denim-dress.txt), added to the prompt.
    const notesFile = path.join(inputDir, `${path.basename(e.name, ext)}.txt`)
    const notes = (await exists(notesFile)) ? (await fs.readFile(notesFile, 'utf8')).trim() : ''
    garments.push({ name, file: path.join(inputDir, e.name), fileName: e.name, notes })
  }
  return garments
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isRetryable(err) {
  const status = err?.status
  if (status === 429 || status === 408 || status === 409 || (status >= 500 && status < 600)) {
    // A 429 for an exhausted balance will never succeed by waiting.
    return !/insufficient_quota|billing/i.test(String(err?.code ?? '') + String(err?.message ?? ''))
  }
  return status === undefined // network errors and timeouts
}

async function withRetries(label, fn, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i >= attempts || !isRetryable(err)) throw err
      const retryAfter = Number(err?.headers?.get?.('retry-after') ?? err?.headers?.['retry-after'])
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 2000 * 2 ** (i - 1))
      console.warn(`    ${label}: ${err?.status ?? 'network error'} (${err?.message ?? err}). Retrying in ${Math.round(wait / 1000)}s...`)
      await sleep(wait + Math.random() * 500)
    }
  }
}

// ---------------------------------------------------------------------------
// One image
// ---------------------------------------------------------------------------

async function generateView({ client, toFile, opts, garment, quality, view, frontPath }) {
  // Order matters, the prompt refers to it: garment first, then the front view, then the model reference last.
  const refs = [await toFile(await fs.readFile(garment.file), `garment${path.extname(garment.file)}`, { type: mimeFor(garment.file) })]
  if (view.usesFront) refs.push(await toFile(await fs.readFile(frontPath), 'front-view.png', { type: 'image/png' }))
  if (opts.modelRef) refs.push(await toFile(await fs.readFile(opts.modelRef), `model${path.extname(opts.modelRef)}`, { type: mimeFor(opts.modelRef) }))
  const prompt = [BASE_PROMPT, PROMPT_CLARIFICATION, garment.notes && `About this garment: ${garment.notes}`, opts.modelLook, view.text]
    .filter(Boolean)
    .join('\n\n')
  const started = Date.now()
  const res = await withRetries(`${garment.name}/${quality}/${view.id}`, () =>
    client.images.edit({
      model: opts.model,
      image: refs,
      prompt,
      quality,
      size: SIZE,
      output_format: 'png',
      n: 1,
    }),
  )
  const b64 = res.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image')
  const cost = costFromUsage(res.usage)
  return {
    png: Buffer.from(b64, 'base64'),
    usage: res.usage ?? null,
    costUsd: cost ?? GUESS_USD[quality] ?? GUESS_USD.high,
    costIsEstimate: cost === null,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.pageOnly) {
    await buildPage(opts)
    return
  }

  // Model reference: --model-ref, else a single picture in model-reference/.
  if (!opts.modelRef) {
    const refDir = path.join(HERE, 'model-reference')
    const pics = (await fs.readdir(refDir).catch(() => [])).filter((f) => !f.startsWith('.') && INPUT_EXTENSIONS.has(path.extname(f).toLowerCase()))
    if (pics.length > 1) throw new Error(`Put only one picture in ${refDir} (found ${pics.length}), or choose one with --model-ref.`)
    if (pics.length === 1) opts.modelRef = path.join(refDir, pics[0])
  }
  if (opts.modelRef && !INPUT_EXTENSIONS.has(path.extname(opts.modelRef).toLowerCase())) throw new Error('--model-ref must be a JPG, PNG or WebP picture')
  if (opts.modelRef && !(await exists(opts.modelRef))) throw new Error(`Model reference not found: ${opts.modelRef}`)
  opts.modelLook ??= opts.modelRef ? MODEL_REF_LOOK : DEFAULT_MODEL_LOOK
  console.log(opts.modelRef ? `Model reference: ${opts.modelRef}` : 'No model reference: using a fictional model.')

  const allGarments = await listGarments(opts.input)
  if (allGarments.length === 0) {
    console.log(`No photos in ${opts.input}. Add JPG, PNG or WebP garment photos and run again.`)
    return
  }

  // Work out what is left to do. Finished garments do not count toward --limit.
  const todo = []
  for (const g of allGarments) {
    const missing = []
    for (const q of opts.qualities) {
      for (const v of VIEWS) {
        if (!(await exists(path.join(opts.output, g.name, q, `${v.id}.png`)))) missing.push({ quality: q, view: v })
      }
    }
    if (missing.length === 0) console.log(`  ${g.name}: already done, skipping`)
    else todo.push({ ...g, missing })
  }
  const garments = todo.slice(0, opts.limit)

  const estimate = garments.reduce(
    (sum, g) => sum + g.missing.reduce((s, m) => s + (GUESS_USD[m.quality] ?? GUESS_USD.high) + GUESS_INPUT_USD[m.view.id] + (opts.modelRef ? 0.015 : 0), 0),
    0,
  )
  const imageCount = garments.reduce((n, g) => n + g.missing.length, 0)
  console.log(
    `\nModel ${opts.model}, size ${SIZE}, qualities ${opts.qualities.join(' + ')}.` +
      `\n${garments.length} garment(s) to process, ${imageCount} image(s), rough estimate ${usd(estimate)}.\n`,
  )
  if (opts.dryRun) {
    for (const g of garments) console.log(`  ${g.name} (${g.fileName}): ${g.missing.map((m) => `${m.quality}/${m.view.id}`).join(', ')}`)
    console.log('\nDry run: nothing was sent to OpenAI.')
    return
  }
  if (garments.length === 0) {
    await buildPage(opts)
    return
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Set it in your terminal for this session; never put it in a file in the repo.')
  }
  const { default: OpenAI, toFile } = await import('openai')
  // Our own retry loop handles rate limits, so the SDK's is turned off. Images can take minutes.
  const client = new OpenAI({ maxRetries: 0, timeout: 10 * 60 * 1000 })

  let runTotal = 0
  let made = 0
  const failures = []

  for (const [i, g] of garments.entries()) {
    console.log(`[${i + 1}/${garments.length}] ${g.name}`)
    const gDir = path.join(opts.output, g.name)
    await fs.mkdir(gDir, { recursive: true })
    // A copy of the original for the comparison page. The file in test-input/ is only ever read.
    const originalCopy = path.join(gDir, `original${path.extname(g.file).toLowerCase()}`)
    if (!(await exists(originalCopy))) await fs.copyFile(g.file, originalCopy)

    for (const quality of opts.qualities) {
      const qDir = path.join(gDir, quality)
      await fs.mkdir(qDir, { recursive: true })
      const resultsPath = path.join(qDir, 'results.json')
      const results = await readJson(resultsPath, { garment: g.name, source: g.fileName, quality, views: {} })
      const frontPath = path.join(qDir, 'front.png')

      for (const view of VIEWS) {
        const outPath = path.join(qDir, `${view.id}.png`)
        if (await exists(outPath)) continue
        if (view.usesFront && !(await exists(frontPath))) {
          console.warn(`    ${quality}/${view.id}: skipped, the front view failed`)
          continue
        }
        try {
          const r = await generateView({ client, toFile, opts, garment: g, quality, view, frontPath })
          await fs.writeFile(outPath, r.png)
          results.views[view.id] = {
            file: `${view.id}.png`,
            model: opts.model,
            size: SIZE,
            usage: r.usage,
            costUsd: r.costUsd,
            costIsEstimate: r.costIsEstimate,
            seconds: r.seconds,
            createdAt: new Date().toISOString(),
          }
          await fs.writeFile(resultsPath, JSON.stringify(results, null, 2))
          runTotal += r.costUsd
          made++
          const u = r.usage
          const tokens = u
            ? `in ${u.input_tokens} (text ${u.input_tokens_details?.text_tokens ?? '?'}, image ${u.input_tokens_details?.image_tokens ?? '?'}), out ${u.output_tokens}`
            : 'no usage data returned'
          console.log(`    ${quality}/${view.id}: ${usd(r.costUsd)}${r.costIsEstimate ? ' (estimate)' : ''}, ${tokens}, ${r.seconds}s`)
        } catch (err) {
          const raw = String(err?.message ?? err)
          const msg = err?.status && !raw.startsWith(String(err.status)) ? `${err.status} ${raw}` : raw
          console.error(`    ${quality}/${view.id}: FAILED: ${msg}`)
          failures.push(`${g.name}/${quality}/${view.id}: ${msg}`)
          if (err?.status === 401) throw new Error('OpenAI rejected the API key (401). Stopping.')
        }
      }
    }
  }

  await buildPage(opts)
  console.log(`\nDone. ${made} image(s) made this run, total cost ${usd(runTotal)}.`)
  if (failures.length) {
    console.log(`${failures.length} failed (run again to retry just these):`)
    for (const f of failures) console.log(`  - ${f}`)
  }
  console.log(`Open ${path.join(opts.output, 'index.html')} in your browser to compare.`)
}

// ---------------------------------------------------------------------------
// Comparison page
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const urlPath = (...parts) => parts.map(encodeURIComponent).join('/')

async function buildPage(opts) {
  let dirs = []
  try {
    dirs = (await fs.readdir(opts.output, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  } catch {
    return
  }
  let grand = 0
  const sections = []
  for (const name of dirs) {
    const gDir = path.join(opts.output, name)
    const files = await fs.readdir(gDir)
    const original = files.find((f) => f.startsWith('original.'))
    const qualities = files.filter((f) => !f.includes('.')).sort((a, b) => (a === 'medium' ? -1 : b === 'medium' ? 1 : a.localeCompare(b)))
    const cols = []
    let garmentTotal = 0
    for (const q of qualities) {
      const results = await readJson(path.join(gDir, q, 'results.json'), { views: {} })
      let qTotal = 0
      const cells = VIEWS.map((v) => {
        const r = results.views?.[v.id]
        if (!r) return `<figure class="missing"><div>Not made yet</div><figcaption>${esc(v.label)}</figcaption></figure>`
        qTotal += r.costUsd ?? 0
        const src = urlPath(name, q, r.file)
        return `<figure><a href="${src}" target="_blank"><img src="${src}" alt="${esc(`${name} ${q} ${v.label}`)}" loading="lazy"></a><figcaption>${esc(v.label)} · ${usd(r.costUsd ?? 0)}${r.costIsEstimate ? '*' : ''}</figcaption></figure>`
      }).join('')
      garmentTotal += qTotal
      const model = Object.values(results.views ?? {})[0]?.model ?? ''
      cols.push(`<div class="col"><h3>${esc(q)} <span>${usd(qTotal)}${model ? ` · ${esc(model)}` : ''}</span></h3><div class="row">${cells}</div></div>`)
    }
    grand += garmentTotal
    const orig = original
      ? `<figure><a href="${urlPath(name, original)}" target="_blank"><img src="${urlPath(name, original)}" alt="${esc(name)} original"></a><figcaption>Your photo</figcaption></figure>`
      : ''
    sections.push(
      `<section><h2>${esc(name)} <span>${usd(garmentTotal)}</span></h2><div class="grid"><div class="col orig"><h3>Original</h3>${orig}</div>${cols.join('')}</div></section>`,
    )
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>VYRA image test</title>
<style>
  :root { --bg:#ede6d3; --surface:#fff; --raised:#f6f2e8; --border:#e4ded0; --text:#1e1e1e; --muted:#6b655b; --accent:#5f7a1f; }
  * { box-sizing:border-box } body { margin:0; padding:24px 16px; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, sans-serif }
  header, section { max-width:1600px; margin:0 auto 24px } h1 { margin:0 0 4px; font-weight:600 } header p { margin:0; color:var(--muted) }
  section { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px }
  h2 { margin:0 0 12px; font-size:18px } h2 span, h3 span { color:var(--muted); font-weight:400; font-size:13px; text-transform:none }
  h3 { margin:0 0 8px; font-size:14px; text-transform:capitalize; color:var(--accent) }
  .grid { display:grid; grid-template-columns:minmax(140px,1fr) repeat(auto-fit,minmax(320px,3fr)); gap:16px }
  .row { display:grid; grid-template-columns:repeat(3,1fr); gap:8px }
  figure { margin:0 } img { width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:8px; background:var(--raised); display:block }
  .orig img { object-fit:contain } figcaption { font-size:12px; color:var(--muted); margin-top:4px }
  .missing div { aspect-ratio:2/3; border:1px dashed var(--border); border-radius:8px; display:grid; place-items:center; color:var(--muted); font-size:12px }
  @media (max-width:700px) { .grid { grid-template-columns:1fr } }
</style></head><body>
<header><h1>VYRA image test</h1><p>${dirs.length} garment(s) · total ${usd(grand)} · click any picture to open it full size${sections.join('').includes('*</figcaption>') ? ' · * estimated, no usage data returned' : ''}</p></header>
${sections.join('\n') || '<section>No results yet.</section>'}
</body></html>
`
  await fs.writeFile(path.join(opts.output, 'index.html'), html)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n${err?.message ?? err}`)
    process.exit(1)
  })
}
