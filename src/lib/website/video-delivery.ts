// Serving product videos and their posters (ZP-501). Server only.
//
// Public:  GET /api/videos/public/<32 hex>.mp4|.webp   no sign-in
//   Only for the video/poster of a READY ProductVideo whose product is public
//   (published, has a slug, category published: PUBLIC_PRODUCT_WHERE). The
//   check runs on every request. Anything else - bad name, unknown key,
//   unpublished, not READY, bytes missing - is the same plain 404.
// Private: GET /api/videos/<32 hex>.mp4|.webp            signed in (owner preview)
//
// Both support HTTP Range (206 + Content-Range, 416 for an unsatisfiable or
// malformed range), always send Accept-Ranges, X-Content-Type-Options:
// nosniff and a sandboxing CSP, and never derive the Content-Type from the
// stored object: .mp4 is video/mp4, .webp is image/webp.
//
// Keys are content-hashed (a new video has a new URL), so public responses
// are cacheable for a year (immutable). See docs/storefront/videos.md.
import { Readable } from 'node:stream'
import type { Db } from '@/lib/storefront-model/db'
import { PUBLIC_PRODUCT_WHERE } from '@/lib/storefront/queries'
import { POSTER_CONTENT_TYPE, VIDEO_CONTENT_TYPE, videoAssetFromFileName, type VideoAssetKind } from '@/lib/storage/video-keys'
import type { VideoStorage } from '@/lib/storage/videos'
import { parseRangeHeader, rangeHeaders } from './video-range'

export const PUBLIC_VIDEO_CACHE_CONTROL = 'public, max-age=31536000, immutable'
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
    const size = await options.storage.size(asset.key)
    if (size === null) return notFound()

    const range = parseRangeHeader(request.headers.get('range'), size)
    if (range.kind === 'invalid') return plain(416, 'Range Not Satisfiable', rangeHeaders(range, size))

    const headers: Record<string, string> = {
      'Content-Type': asset.kind === 'video' ? VIDEO_CONTENT_TYPE : POSTER_CONTENT_TYPE,
      'Cache-Control': options.visibility === 'public' ? PUBLIC_VIDEO_CACHE_CONTROL : PRIVATE_VIDEO_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      ...rangeHeaders(range, size),
    }
    const status = range.kind === 'partial' ? 206 : 200
    if (options.method === 'HEAD') return new Response(null, { status, headers })

    const stream = await options.storage.read(asset.key, range.kind === 'partial' ? range : undefined)
    if (!stream) return notFound()
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
  } catch (error) {
    console.error('Video read failed', error instanceof Error ? error.message : error)
    return plain(500, 'Video unavailable')
  }
}
