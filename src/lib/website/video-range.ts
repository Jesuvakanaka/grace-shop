// HTTP Range parsing for video delivery (ZP-501). Pure.
//
// Browsers stream <video> with single byte ranges ("bytes=0-", "bytes=0-1",
// "bytes=12345-"). Following RFC 9110 §14.2, a Range header the server does
// not understand or support is IGNORED and the whole file is sent (200):
// another unit, malformed syntax, last < first, numbers too large, or several
// ranges. Only a well-formed single byte range that cannot be satisfied
// (starts at or past the end, "bytes=-0", any range of an empty file) is 416
// with "Content-Range: bytes */<size>".

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' }

const FULL: RangeResult = { kind: 'full' }

export function parseRangeHeader(header: string | null | undefined, size: number): RangeResult {
  if (header === null || header === undefined) return FULL
  const m = /^\s*([A-Za-z]+)\s*=(.*)$/.exec(header)
  if (!m || m[1].toLowerCase() !== 'bytes') return FULL
  const spec = /^\s*(\d{0,15})\s*-\s*(\d{0,15})\s*$/.exec(m[2])
  if (!spec || (spec[1] === '' && spec[2] === '')) return FULL

  if (spec[1] === '') {
    // Suffix range: the last N bytes.
    const n = Number(spec[2])
    if (n === 0 || size <= 0) return { kind: 'unsatisfiable' }
    return { kind: 'partial', start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(spec[1])
  if (spec[2] !== '' && Number(spec[2]) < start) return FULL // invalid: last < first
  if (start >= size) return { kind: 'unsatisfiable' }
  const end = spec[2] === '' ? size - 1 : Math.min(Number(spec[2]), size - 1)
  return { kind: 'partial', start, end }
}

/** Response headers for a range result (Content-Range, Content-Length, Accept-Ranges). */
export function rangeHeaders(range: RangeResult, size: number): Record<string, string> {
  if (range.kind === 'unsatisfiable') return { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${size}` }
  if (range.kind === 'full') return { 'Accept-Ranges': 'bytes', 'Content-Length': String(size) }
  return {
    'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    'Content-Length': String(range.end - range.start + 1),
  }
}
