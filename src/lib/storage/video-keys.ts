// Object keys and URLs for product videos (ZP-501). Pure; shared by the
// pipeline, the video storage drivers and the /api/videos routes.
//
// Everything lives under the "videos/" prefix of the existing images bucket
// (or local image directory):
//   videos/<32 hex>.mp4                 transcoded video (content-hashed)
//   videos/<32 hex>.webp                poster frame (content-hashed)
//   videos/uploads/<32 hex>/<n>.part    upload chunk n of an upload in progress
// Each pattern is anchored and has no "/", "." or ".." the caller controls,
// so no key can escape the prefix (no path traversal).

export const VIDEO_PREFIX = 'videos/'
export const VIDEO_UPLOAD_PREFIX = 'videos/uploads/'
export const VIDEO_CONTENT_TYPE = 'video/mp4'
export const POSTER_CONTENT_TYPE = 'image/webp'

/** Private (signed-in) route: /api/videos/<32 hex>.mp4|.webp */
export const VIDEO_URL_PREFIX = '/api/videos/'
/** Public route (READY videos of public products only): /api/videos/public/<32 hex>.mp4|.webp */
export const PUBLIC_VIDEO_URL_PREFIX = '/api/videos/public/'

/** Most chunks one upload may have (60 MB / 8 MiB rounds up to 8). */
export const VIDEO_MAX_CHUNKS = 8

const HEX32 = /^[a-f0-9]{32}$/
const VIDEO_FILE = /^[a-f0-9]{32}\.mp4$/
const POSTER_FILE = /^[a-f0-9]{32}\.webp$/

export type VideoAssetKind = 'video' | 'poster'

export function isValidVideoKey(key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(VIDEO_PREFIX) && VIDEO_FILE.test(key.slice(VIDEO_PREFIX.length))
}

export function isValidPosterKey(key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(VIDEO_PREFIX) && POSTER_FILE.test(key.slice(VIDEO_PREFIX.length))
}

export function isValidUploadId(id: unknown): id is string {
  return typeof id === 'string' && HEX32.test(id)
}

export function uploadChunkKey(uploadId: string, index: number): string {
  if (!isValidUploadId(uploadId)) throw new Error('Invalid upload id')
  if (!Number.isInteger(index) || index < 0 || index >= VIDEO_MAX_CHUNKS) throw new Error('Invalid chunk index')
  return `${VIDEO_UPLOAD_PREFIX}${uploadId}/${index}.part`
}

export function isValidUploadChunkKey(key: unknown): key is string {
  if (typeof key !== 'string' || !key.startsWith(VIDEO_UPLOAD_PREFIX)) return false
  const m = /^([a-f0-9]{32})\/([0-9])\.part$/.exec(key.slice(VIDEO_UPLOAD_PREFIX.length))
  return m !== null && Number(m[2]) < VIDEO_MAX_CHUNKS
}

/** Any key the video storage may read or write. */
export function isVideoStorageKey(key: unknown): key is string {
  return isValidVideoKey(key) || isValidPosterKey(key) || isValidUploadChunkKey(key)
}

/**
 * Validate the file name from GET /api/videos[/public]/<name>: only
 * "<32 lowercase hex>.mp4" (video) or "<32 lowercase hex>.webp" (poster).
 */
export function videoAssetFromFileName(fileName: unknown): { kind: VideoAssetKind; key: string } | null {
  if (typeof fileName !== 'string') return null
  if (VIDEO_FILE.test(fileName)) return { kind: 'video', key: `${VIDEO_PREFIX}${fileName}` }
  if (POSTER_FILE.test(fileName)) return { kind: 'poster', key: `${VIDEO_PREFIX}${fileName}` }
  return null
}

function fileNameOf(key: string): string {
  if (!isValidVideoKey(key) && !isValidPosterKey(key)) throw new Error('Invalid video key')
  return key.slice(VIDEO_PREFIX.length)
}

/** Public URL for a video or poster key. Throws for any other key. */
export function publicVideoUrl(key: string): string {
  return `${PUBLIC_VIDEO_URL_PREFIX}${fileNameOf(key)}`
}

/** Signed-in URL (owner preview) for a video or poster key. Throws for any other key. */
export function privateVideoUrl(key: string): string {
  return `${VIDEO_URL_PREFIX}${fileNameOf(key)}`
}
