// GET /api/images/public/<32 hex>.webp[?w=<width>] (ZP-484). Server only.
//
// Serves a picture without sign-in, but only when isPublicImageKey says it
// belongs to a public product or a published category's hero. That check
// runs on EVERY request, before any cache is read. Everything else (bad
// key, unknown key, unpublished, bytes missing) is the same plain 404, so the
// route never reveals that a private picture exists.
//
// `?w=` (one of PUBLIC_IMAGE_WIDTHS) returns a WebP resized to that width,
// never upscaled. Resized bytes are kept in an in-process LRU (resize-cache.ts).
// The Next image optimiser is NOT used for storefront pictures: it keeps
// serving a cached size after the picture is unpublished.
import { imageKeyFromFileName, type ImageStorage } from '@/lib/storage/keys'
import type { Db } from '@/lib/storefront-model/db'
import { parsePublicImageWidth, STORED_IMAGE_MAX_DIMENSION, type PublicImageWidth } from './image-sizes'
import { isPublicImageKey } from './queries'
import { ByteLruCache } from './resize-cache'

if (typeof window !== 'undefined') throw new Error('src/lib/storefront is server-only')

/**
 * Browsers and shared caches (a CDN, if one is added) may reuse a picture
 * for 5 minutes; a shared cache may serve it stale once more while it
 * revalidates in the background. The origin stops serving an unpublished
 * picture at once. Keys are content-hashed, so a new photo has a new URL.
 * See docs/storefront/public-data-layer.md.
 */
export const PUBLIC_IMAGE_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400'

/** Byte budget of the resized-picture cache, per server instance. */
export const RESIZE_CACHE_BYTES = 64 * 1024 * 1024
const RESIZE_WEBP_QUALITY = 80 // as the upload pipeline (IMAGE_WEBP_QUALITY)
/** Stored pictures are <=1200px; this guards against an unexpected huge one. */
const RESIZE_MAX_INPUT_PIXELS = STORED_IMAGE_MAX_DIMENSION * STORED_IMAGE_MAX_DIMENSION * 4

const defaultCache = new ByteLruCache(RESIZE_CACHE_BYTES)
/** Concurrent requests for the same size share one resize. */
const inFlight = new Map<string, Promise<Buffer | null>>()

const plain = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // A picture published a moment later must not be hidden by a cached error.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })

export function notFound(): Response {
  return plain(404, 'Not Found')
}

function imageHeaders(contentType: string, size: number | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': PUBLIC_IMAGE_CACHE_CONTROL,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  }
  if (size !== null) headers['Content-Length'] = String(size)
  return headers
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer())
}

/** Resize to `width` (never upscaled) as WebP. Null when the bytes are missing. */
async function resize(storage: ImageStorage, key: string, width: PublicImageWidth): Promise<Buffer | null> {
  const image = await storage.get(key)
  if (!image) return null
  const input = await readAll(image.stream)
  // Loaded on first use, like the upload pipeline, so other routes never load sharp.
  const { default: sharp } = await import('sharp')
  return sharp(input, { limitInputPixels: RESIZE_MAX_INPUT_PIXELS, failOn: 'error' })
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: RESIZE_WEBP_QUALITY })
    .toBuffer()
}

export async function servePublicImage(
  fileName: string,
  query: URLSearchParams,
  deps: { db: Db; storage: ImageStorage; cache?: ByteLruCache },
): Promise<Response> {
  const key = imageKeyFromFileName(fileName)
  if (!key) return notFound()
  // The query is checked before the database, and the answer does not
  // depend on the key, so a 400 reveals nothing about the picture.
  const parsed = parsePublicImageWidth(query)
  if (!parsed.ok) return plain(400, parsed.error)

  try {
    // Visibility first, on every request, before any cache.
    if (!(await isPublicImageKey(deps.db, key))) return notFound()

    if (parsed.width === null) {
      const image = await deps.storage.get(key)
      if (!image) return notFound()
      return new Response(image.stream, { status: 200, headers: imageHeaders(image.contentType, image.size) })
    }

    const cache = deps.cache ?? defaultCache
    const cacheKey = `${key}|${parsed.width}`
    let bytes = cache.get(cacheKey) ?? null
    if (!bytes) {
      let pending = inFlight.get(cacheKey)
      if (!pending) {
        pending = resize(deps.storage, key, parsed.width).finally(() => inFlight.delete(cacheKey))
        inFlight.set(cacheKey, pending)
      }
      bytes = await pending
      if (!bytes) return notFound()
      cache.set(cacheKey, bytes)
    }
    return new Response(new Uint8Array(bytes), { status: 200, headers: imageHeaders('image/webp', bytes.length) })
  } catch (error) {
    console.error('Public image read failed', error instanceof Error ? error.message : error)
    return plain(500, 'Image unavailable')
  }
}
