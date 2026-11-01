// ZP-513: size charts (body measurements in cm) for the details card's
// "Size guide". Pure; client and server. A product may have its own chart
// (Product.sizeChart); the site settings hold a default (defaultSizeChart).
// Stored as JSON rows { size, bust, waist, hips } of short text ("86–90").
// Tested in tests/storefront-details-card.test.ts.

export type SizeChartRow = { size: string; bust: string; waist: string; hips: string }

export const SIZE_CHART_MAX_ROWS = 12
export const SIZE_LABEL_MAX = 12
export const MEASURE_MAX = 16

const KEYS = ['size', 'bust', 'waist', 'hips'] as const
/** Letters, digits, spaces and the few signs a measurement needs (no markup). */
const SAFE = /^[\p{L}\p{N} .,/+\-–—~()']*$/u

export type SizeChartResult = { ok: true; value: SizeChartRow[] | null } | { ok: false; error: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validate a chart from the admin (an array, or its JSON text from a
 * textarea). Empty input or no rows means "no chart" (null). Each row needs
 * exactly size (<= 12 characters, unique) and bust / waist / hips (text or
 * numbers, <= 16 characters each, may be ""); at most 12 rows.
 */
export function parseSizeChart(input: unknown): SizeChartResult {
  let value = input
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value === 'string') {
    if (value.trim() === '') return { ok: true, value: null }
    try {
      value = JSON.parse(value)
    } catch {
      return { ok: false, error: 'The size chart is not valid JSON.' }
    }
  }
  if (!Array.isArray(value)) return { ok: false, error: 'The size chart must be a list of rows.' }
  if (value.length === 0) return { ok: true, value: null }
  if (value.length > SIZE_CHART_MAX_ROWS) return { ok: false, error: `The size chart can have at most ${SIZE_CHART_MAX_ROWS} rows.` }
  const rows: SizeChartRow[] = []
  const seen = new Set<string>()
  for (const [i, raw] of value.entries()) {
    const at = `Size chart row ${i + 1}`
    if (!isPlainObject(raw)) return { ok: false, error: `${at} must be an object.` }
    const extra = Object.keys(raw).find((k) => !(KEYS as readonly string[]).includes(k))
    if (extra) return { ok: false, error: `${at}: unknown field "${extra.slice(0, 20)}".` }
    const row = {} as SizeChartRow
    for (const key of KEYS) {
      const v = raw[key]
      if (v === undefined) return { ok: false, error: `${at} needs ${key} (it may be empty: "").` }
      const text = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : v === null ? '' : null
      if (text === null) return { ok: false, error: `${at}: ${key} must be text or a number.` }
      const max = key === 'size' ? SIZE_LABEL_MAX : MEASURE_MAX
      if (text.length > max) return { ok: false, error: `${at}: ${key} can be at most ${max} characters.` }
      if (!SAFE.test(text)) return { ok: false, error: `${at}: ${key} contains characters that are not allowed.` }
      row[key] = text
    }
    if (!row.size) return { ok: false, error: `${at} needs a size.` }
    const k = row.size.toLowerCase()
    if (seen.has(k)) return { ok: false, error: `${at}: size ${row.size} is listed twice.` }
    seen.add(k)
    rows.push(row)
  }
  return { ok: true, value: rows }
}

/** The admin's text form: one row per line, "size | bust | waist | hips". */
export function sizeChartToText(rows: readonly SizeChartRow[] | null): string {
  return (rows ?? []).map((r) => [r.size, r.bust, r.waist, r.hips].join(' | ')).join('\n')
}

/**
 * Rows from the admin's text form (blank lines skipped; a short line keeps
 * its missing measurements empty). Not validated here: parseSizeChart on the
 * server does that and names the bad row.
 */
export function sizeChartFromText(text: string): SizeChartRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [size = '', bust = '', waist = '', hips = ''] = line.split('|').map((c) => c.trim())
      return { size, bust, waist, hips }
    })
}

/** A stored chart (JSON column) as rows, or null when unset or no longer valid. */
export function readSizeChart(stored: unknown): SizeChartRow[] | null {
  if (stored === null || stored === undefined || typeof stored === 'string') return null
  const r = parseSizeChart(stored)
  return r.ok ? r.value : null
}

/**
 * The rows the card shows: the piece's own chart, else the default chart,
 * filtered to the piece's sizes (case-insensitive; all rows when the piece
 * lists no sizes). Null when nothing is left (the "Size guide" link hides).
 */
export function chartForSizes(input: {
  piece: SizeChartRow[] | null
  fallback: SizeChartRow[] | null
  sizes: readonly string[]
}): SizeChartRow[] | null {
  const chart = input.piece ?? input.fallback
  if (!chart || chart.length === 0) return null
  if (input.sizes.length === 0) return chart
  const wanted = new Set(input.sizes.map((s) => s.trim().toLowerCase()))
  const rows = chart.filter((r) => wanted.has(r.size.toLowerCase()))
  return rows.length > 0 ? rows : null
}
