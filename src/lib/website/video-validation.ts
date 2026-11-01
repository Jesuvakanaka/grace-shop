// Product video validation (ZP-501). Pure; safe to import anywhere.
//
// The client's file name and MIME type are never trusted: the container is
// sniffed from the first bytes (sniffVideoContainer) and then confirmed by
// ffprobe (checkProbe), which also gives the duration and display size.
// See docs/storefront/videos.md.

/** Largest upload accepted (before transcoding). */
export const VIDEO_MAX_UPLOAD_BYTES = 60 * 1024 * 1024
export const VIDEO_MAX_UPLOAD_MB = 60
/** Longest clip accepted. */
export const VIDEO_MAX_DURATION_MS = 30_000
/** Containers report durations a little over the real length; this much over the limit is allowed. */
export const VIDEO_DURATION_TOLERANCE_MS = 500
/**
 * Uploads are sent in chunks of at most this size. Two hard limits make this
 * necessary: the Next proxy buffers at most 10 MB of a request body (and
 * silently truncates the rest), and Cloud Run refuses HTTP/1 requests above
 * 32 MiB. 8 MiB stays well under both.
 */
export const VIDEO_CHUNK_BYTES = 8 * 1024 * 1024
/**
 * Largest input frame: 4K (3840x2160) in either orientation. Bounds decoder
 * memory; ffmpeg/ffprobe also get `-max_pixels` so a stream that changes size
 * mid-way cannot decode larger frames than this.
 */
export const VIDEO_MAX_INPUT_LONG_SIDE = 3840
export const VIDEO_MAX_INPUT_SHORT_SIDE = 2160
export const VIDEO_MAX_INPUT_PIXELS = VIDEO_MAX_INPUT_LONG_SIDE * VIDEO_MAX_INPUT_SHORT_SIDE

/** HDR transfer characteristics (ffprobe color_transfer) that are tone-mapped to SDR. */
export const HDR_TRANSFERS = ['arib-std-b67', 'smpte2084'] as const
export type HdrTransfer = (typeof HDR_TRANSFERS)[number]

export const VIDEO_ACCEPT_LABEL = 'MP4, MOV or WebM, up to 60 MB and 30 seconds'
/** For <input accept>; a hint only, the server sniffs the bytes. */
export const VIDEO_INPUT_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm'

export type VideoContainer = 'mp4' | 'mov' | 'webm'

export const VIDEO_REFUSALS = {
  empty: 'The video file is empty.',
  tooLarge: `The video is too large (max ${VIDEO_MAX_UPLOAD_MB} MB).`,
  notVideo: 'That file is not a supported video. Use an MP4, MOV or WebM video.',
  unreadable: 'The video could not be read. Try exporting it again as MP4.',
  noVideoStream: 'That file has no video picture in it (only sound?).',
  tooBig: 'The video picture is too large (max 4K, 3840×2160). Export it at 1080p and try again.',
} as const

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string }

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end))

/** ISO-BMFF brands of MP4 video files. */
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso8', 'iso9',
  'mp41', 'mp42', 'mp71', 'avc1', 'hvc1', 'hev1', 'av01', 'M4V ', 'M4VP', 'mmp4', 'MSNV', 'dash', 'XAVC', 'NDAS',
])
const QUICKTIME_BRAND = 'qt  '
/** ISO-BMFF brands of still pictures (HEIC, AVIF): refused even if a video brand is also listed. */
const IMAGE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'mif2', 'msf1', 'avif', 'avis', 'miaf', 'jpeg', 'avci'])
/** QuickTime files written without an ftyp box start with one of these atoms. */
const LEGACY_QT_ATOMS = new Set(['moov', 'wide', 'mdat', 'free', 'pnot', 'skip'])

function sniffIsoBmff(b: Uint8Array): VideoContainer | null {
  const boxSize = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
  if (boxSize < 16 || b.length < 16) return null
  const end = Math.min(boxSize, b.length, 256)
  const brands = [ascii(b, 8, 12)]
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i, i + 4))
  if (brands.some((brand) => IMAGE_BRANDS.has(brand))) return null
  if (brands[0] === QUICKTIME_BRAND) return 'mov'
  if (brands.some((brand) => MP4_BRANDS.has(brand))) return 'mp4'
  if (brands.includes(QUICKTIME_BRAND)) return 'mov'
  return null
}

/** WebM: an EBML header whose DocType element (0x4282) says "webm". Other Matroska files are refused. */
function sniffWebm(b: Uint8Array): VideoContainer | null {
  const end = Math.min(b.length, 64)
  for (let i = 4; i + 3 < end; i++) {
    if (b[i] === 0x42 && b[i + 1] === 0x82) {
      const len = b[i + 2] & 0x7f
      if ((b[i + 2] & 0x80) === 0 || len === 0 || i + 3 + len > b.length) return null
      return ascii(b, i + 3, i + 3 + len) === 'webm' ? 'webm' : null
    }
  }
  return null
}

/** Detect the video container from the first bytes of the file. Never trusts a file name or MIME type. */
export function sniffVideoContainer(b: Uint8Array): VideoContainer | null {
  if (b.length < 12) return null
  if (ascii(b, 4, 8) === 'ftyp') return sniffIsoBmff(b)
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return sniffWebm(b)
  if (LEGACY_QT_ATOMS.has(ascii(b, 4, 8)) && /^[a-z]{4}$/.test(ascii(b, 4, 8))) {
    // "free"/"skip"/"mdat" alone are too generic to be sure; ffprobe (forced to
    // the mov demuxer) confirms it afterwards.
    return 'mov'
  }
  return null
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Body of POST .../video/uploads: { size } in bytes. */
export function parseUploadStart(body: unknown): Parsed<{ size: number; chunks: number }> {
  if (!isPlainObject(body)) return { ok: false, error: 'Expected { size } in bytes.' }
  const extra = Object.keys(body).filter((k) => k !== 'size')
  if (extra.length) return { ok: false, error: `Unknown field: ${extra[0]}` }
  const size = body.size
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
    return { ok: false, error: 'size must be the file size in bytes.' }
  }
  if (size === 0) return { ok: false, error: VIDEO_REFUSALS.empty }
  if (size > VIDEO_MAX_UPLOAD_BYTES) return { ok: false, error: VIDEO_REFUSALS.tooLarge }
  return { ok: true, data: { size, chunks: Math.ceil(size / VIDEO_CHUNK_BYTES) } }
}

/** Chunk index from the route: "0".."9" without leading zeros, below `chunks`. */
export function parseChunkIndex(raw: unknown, chunks: number): number | null {
  if (typeof raw !== 'string' || !/^(0|[1-9]\d?)$/.test(raw)) return null
  const n = Number(raw)
  return n < chunks ? n : null
}

/** Expected byte length of chunk `index` of an upload of `size` bytes. */
export function expectedChunkBytes(size: number, index: number): number {
  return Math.max(0, Math.min(VIDEO_CHUNK_BYTES, size - index * VIDEO_CHUNK_BYTES))
}

export type ProbedVideo = {
  /** Display size (rotation applied). */
  width: number
  height: number
  durationMs: number
  fps: number
  /** HLG or PQ transfer (iPhone HDR); null for SDR. */
  hdr: HdrTransfer | null
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function rate(v: unknown): number {
  if (typeof v !== 'string') return 0
  const m = /^(\d+)\/(\d+)$/.exec(v)
  if (!m || Number(m[2]) === 0) return num(v) ?? 0
  return Number(m[1]) / Number(m[2])
}

function rotationOf(stream: Record<string, unknown>): number {
  const side = Array.isArray(stream.side_data_list) ? stream.side_data_list : []
  for (const s of side) if (isPlainObject(s) && num(s.rotation) !== null) return num(s.rotation)!
  const tags = isPlainObject(stream.tags) ? stream.tags : {}
  return num(tags.rotate) ?? 0
}

/** Seconds -> " 42 s" style text for messages. */
const secondsText = (ms: number) => `${Math.round(ms / 1000)} s`

/**
 * Check `ffprobe -show_format -show_streams -print_format json` output:
 * the demuxer matches the sniffed container, there is a video stream with a
 * sane size, and the clip is at most 30 s.
 */
export function checkProbe(probe: unknown, container: VideoContainer): Parsed<ProbedVideo> {
  if (!isPlainObject(probe) || !isPlainObject(probe.format) || !Array.isArray(probe.streams)) {
    return { ok: false, error: VIDEO_REFUSALS.unreadable }
  }
  const formatName = typeof probe.format.format_name === 'string' ? probe.format.format_name : ''
  const formats = formatName.split(',')
  const formatOk = container === 'webm' ? formats.includes('webm') : formats.includes('mp4') || formats.includes('mov')
  if (!formatOk) return { ok: false, error: VIDEO_REFUSALS.notVideo }

  const video = probe.streams.find((s): s is Record<string, unknown> => isPlainObject(s) && s.codec_type === 'video')
  if (!video) return { ok: false, error: VIDEO_REFUSALS.noVideoStream }
  const w = num(video.width)
  const h = num(video.height)
  if (!w || !h || w <= 0 || h <= 0 || !Number.isInteger(w) || !Number.isInteger(h)) {
    return { ok: false, error: VIDEO_REFUSALS.unreadable }
  }
  if (Math.max(w, h) > VIDEO_MAX_INPUT_LONG_SIDE || Math.min(w, h) > VIDEO_MAX_INPUT_SHORT_SIDE) {
    return { ok: false, error: VIDEO_REFUSALS.tooBig }
  }

  const seconds = num(probe.format.duration) ?? num(video.duration)
  if (seconds === null || seconds <= 0) return { ok: false, error: VIDEO_REFUSALS.unreadable }
  const durationMs = Math.round(seconds * 1000)
  if (durationMs > VIDEO_MAX_DURATION_MS + VIDEO_DURATION_TOLERANCE_MS) {
    return {
      ok: false,
      error: `The video is ${secondsText(durationMs)} long; the limit is ${secondsText(VIDEO_MAX_DURATION_MS)}. Trim it and try again.`,
    }
  }

  const quarterTurns = Math.round(rotationOf(video) / 90)
  const sideways = Math.abs(quarterTurns) % 2 === 1
  return {
    ok: true,
    data: {
      width: sideways ? h : w,
      height: sideways ? w : h,
      durationMs: Math.min(durationMs, VIDEO_MAX_DURATION_MS + VIDEO_DURATION_TOLERANCE_MS),
      fps: Math.round((rate(video.avg_frame_rate) || rate(video.r_frame_rate) || 30) * 100) / 100,
      hdr: (HDR_TRANSFERS as readonly string[]).includes(String(video.color_transfer))
        ? (video.color_transfer as HdrTransfer)
        : null,
    },
  }
}
