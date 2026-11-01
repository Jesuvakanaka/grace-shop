// Serving product videos and their posters (ZP-501). Server only.
//
// Public:  GET|HEAD /api/videos/public/<32 hex>.mp4|.webp   no sign-in
//   Only for the video/poster of a READY ProductVideo whose product is public
//   (published, has a slug, category published: PUBLIC_PRODUCT_WHERE). The
//   check runs on every request, before any conditional (304) answer.
//   Anything else - bad name, unknown key, unpublished, not READY, bytes
//   missing - is the same plain 404.
// Private: GET|HEAD /api/videos/<32 hex>.mp4|.webp            signed in (owner preview)
//
// Both support HTTP Range (206; 416 only for a well-formed range past the
// end; a malformed or multi-range header is ignored -> 200), conditional
// requests (strong ETag = the content hash in the key, Last-Modified =
// the stored object's time; If-None-Match / If-Modified-Since -> 304,
// If-Range honoured only on a strong ETag or exact date match), always send
// Accept-Ranges, X-Content-Type-Options: nosniff and a sandboxing CSP, and
// never derive the Content-Type from the stored object.
//
// Cache policy (owner decision): the same as public photos,
// PUBLIC_IMAGE_CACHE_CONTROL (5 minutes), so an unpublished video stops
// being reused by browsers and shared caches within minutes; revalidation is
// cheap thanks to the ETag. See docs/storefront/videos.md.
import type { Db } from '@/lib/storefront-model/db'
import { PUBLIC_PRODUCT_WHERE } from '@/lib/storefront/queries'
import { PUBLIC_IMAGE_CACHE_CONTROL } from '@/lib/storefront/public-image'
import { POSTER_CONTENT_TYPE, VIDEO_CONTENT_TYPE, videoAssetFromFileName, type VideoAssetKind } from '@/lib/storage/video-keys'
import type { VideoStorage } from '@/lib/storage/videos'
import { Readable } from 'node:stream'
import { parseRangeHeader, rangeHeaders, type RangeResult } from './video-range'

export const PUBLIC_VIDEO_CACHE_CONTROL = PUBLIC_IMAGE_CACHE_CONTROL
export const PRIVATE_VIDEO_CACHE_CONTROL = 'private, max-age=86400'

const plain = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  })

const notFound = () => plain(404, 'Not Found')

/** Whether this video/poster key belongs to a READY video of a public product. Not cached. */
export async function isPublicVideoAsset(db: Db, kind: VideoAssetKind, key: string): Promise<boolean> {
  const row = await db.productVideo.findFirst({
    where: {
      status: 'READY',
      ...(kind === 'video' ? { videoKey: key } : { posterKey: key }),
      product: PUBLIC_PRODUCT_WHERE,
    },
    select: { id: true },
  })
  return row !== null
}

/** Strong ETag from the content hash in the file name ("<32 hex>.mp4" -> "\"<32 hex>\""). */
export function etagFor(fileName: string): string {
  return `"${fileName.slice(0, 32)}"`
}

const opaque = (tag: string) => tag.trim().replace(/^W\//, '')

/** If-None-Match uses the weak comparison: W/"x" matches "x"; "*" matches anything. */
export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false
  if (header.trim() === '*') return true
  return header.split(',').some((t) => opaque(t) === etag)
}

const seconds = (d: Date) => Math.floor(d.getTime() / 1000)

/**
 * If-Range: the range is honoured only when the validator still matches -
 * a strong ETag equal to ours, or exactly our Last-Modified date. Otherwise
 * the whole (changed) representation is sent.
 */
export function ifRangeHolds(header: string | null, etag: string, lastModified: Date): boolean {
  if (header === null) return true
  const h = header.trim()
  if (h.startsWith('"') || h.startsWith('W/')) return h === etag
  const date = Date.parse(h)
  return !Number.isNaN(date) && Math.floor(date / 1000) === seconds(lastModified)
}

export type ServeVideoOptions = {
  visibility: 'public' | 'private'
  db: Db
  storage: VideoStorage
  method?: 'GET' | 'HEAD'
}

export async function serveVideoAsset(fileName: string, request: Request, options: ServeVideoOptions): Promise<Response> {
  const asset = videoAssetFromFileName(fileName)
  if (!asset) return notFound()
  try {
    if (options.visibility === 'public' && !(await isPublicVideoAsset(options.db, asset.kind, asset.key))) {
      return notFound()
    }
    // One metadata request; its size is passed on to the ranged read.
    const stat = await options.storage.stat(asset.key)
    if (!stat) return notFound()

    const etag = etagFor(fileName)
    const validators: Record<string, string> = {
      ETag: etag,
      'Last-Modified': stat.updatedAt.toUTCString(),
      'Cache-Control': options.visibility === 'public' ? PUBLIC_VIDEO_CACHE_CONTROL : PRIVATE_VIDEO_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    }

    // Conditional GET: If-None-Match wins; If-Modified-Since only without it.
    const inm = request.headers.get('if-none-match')
    const ims = request.headers.get('if-modified-since')
    const imsDate = ims ? Date.parse(ims) : NaN
    const notModified = inm
      ? ifNoneMatchHits(inm, etag)
      : !Number.isNaN(imsDate) && seconds(stat.updatedAt) <= Math.floor(imsDate / 1000)
    if (notModified) return new Response(null, { status: 304, headers: { ...validators, 'Accept-Ranges': 'bytes' } })

    let range: RangeResult = parseRangeHeader(request.headers.get('range'), stat.size)
    if (range.kind !== 'full' && !ifRangeHolds(request.headers.get('if-range'), etag, stat.updatedAt)) {
      range = { kind: 'full' }
    }
    if (range.kind === 'unsatisfiable') return plain(416, 'Range Not Satisfiable', rangeHeaders(range, stat.size))

    const headers: Record<string, string> = {
      ...validators,
      'Content-Type': asset.kind === 'video' ? VIDEO_CONTENT_TYPE : POSTER_CONTENT_TYPE,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      ...rangeHeaders(range, stat.size),
    }
    const status = range.kind === 'partial' ? 206 : 200
    if (options.method === 'HEAD') return new Response(null, { status, headers })

    const stream = await options.storage.read(asset.key, range.kind === 'partial' ? range : undefined)
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
  } catch (error) {
    console.error('Video read failed', error instanceof Error ? error.message : error)
    return plain(500, 'Video unavailable')
  }
}
