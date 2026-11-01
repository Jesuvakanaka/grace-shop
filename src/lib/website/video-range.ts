// HTTP Range parsing for video delivery (ZP-501). Pure.
//
// Browsers stream <video> with single byte ranges ("bytes=0-", "bytes=0-1",
// "bytes=12345-"). Only one range is supported; a multi-range request, a
// malformed "bytes=" range or one that starts past the end is answered with
// 416 and "Content-Range: bytes */<size>". A Range in another unit is
// ignored (RFC 9110 §14.2), so the whole file is sent.

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'invalid' }

export function parseRangeHeader(header: string | null | undefined, size: number): RangeResult {
  if (header === null || header === undefined) return { kind: 'full' }
  const m = /^\s*([A-Za-z]+)\s*=(.*)$/.exec(header)
  if (!m) return { kind: 'invalid' }
  if (m[1].toLowerCase() !== 'bytes') return { kind: 'full' }
  const spec = /^\s*(\d{0,15})\s*-\s*(\d{0,15})\s*$/.exec(m[2])
  if (!spec || (spec[1] === '' && spec[2] === '') || size <= 0) return { kind: 'invalid' }

  if (spec[1] === '') {
    // Suffix range: the last N bytes.
    const n = Number(spec[2])
    if (n === 0) return { kind: 'invalid' }
    return { kind: 'partial', start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(spec[1])
  const end = spec[2] === '' ? size - 1 : Math.min(Number(spec[2]), size - 1)
  if (start >= size || Number(spec[2] === '' ? start : spec[2]) < start) return { kind: 'invalid' }
  return { kind: 'partial', start, end }
}

/** Response headers for a range result (Content-Range, Content-Length, Accept-Ranges). */
export function rangeHeaders(range: RangeResult, size: number): Record<string, string> {
  if (range.kind === 'invalid') return { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${size}` }
  if (range.kind === 'full') return { 'Accept-Ranges': 'bytes', 'Content-Length': String(size) }
  return {
    'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    'Content-Length': String(range.end - range.start + 1),
  }
}
