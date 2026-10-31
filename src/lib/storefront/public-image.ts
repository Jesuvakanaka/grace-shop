// GET /api/images/public/<32 hex>.webp (ZP-484). Server only.
//
// Serves a picture without sign-in, but only when isPublicImageKey says it
// belongs to a public product or a published category's hero. Everything
// else (bad key, unknown key, unpublished, bytes missing) is the same plain
// 404, so the route never reveals that a private picture exists.
import { imageKeyFromFileName, type ImageStorage } from '@/lib/storage/keys'
import type { Db } from '@/lib/storefront-model/db'
import { isPublicImageKey } from './queries'

if (typeof window !== 'undefined') throw new Error('src/lib/storefront is server-only')

/**
 * Browsers, shared caches and the Next image optimiser may reuse a picture
 * for 5 minutes; a shared cache may serve it stale once more while it
 * revalidates in the background. Keys are content-hashed, so a new photo has
 * a new URL; the short lifetime only bounds how long an UNPUBLISHED picture
 * stays visible.
 *
 * s-maxage is 300, not 3600: the optimiser (/_next/image) caches each resized
 * variant for s-maxage (preferred over max-age) or images.minimumCacheTTL,
 * whichever is larger, and that cache cannot be invalidated. With 3600 an
 * unpublished picture stayed resizable for an hour. See
 * docs/storefront/public-data-layer.md.
 */
export const PUBLIC_IMAGE_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400'

export function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // A picture published a moment later must not be hidden by a cached 404.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function servePublicImage(
  fileName: string,
  deps: { db: Db; storage: ImageStorage },
): Promise<Response> {
  const key = imageKeyFromFileName(fileName)
  if (!key) return notFound()
  try {
    if (!(await isPublicImageKey(deps.db, key))) return notFound()
    const image = await deps.storage.get(key)
    if (!image) return notFound()
    const headers: Record<string, string> = {
      'Content-Type': image.contentType,
      'Cache-Control': PUBLIC_IMAGE_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    }
    if (image.size !== null) headers['Content-Length'] = String(image.size)
    return new Response(image.stream, { status: 200, headers })
  } catch (error) {
    console.error('Public image read failed', error instanceof Error ? error.message : error)
    return new Response('Image unavailable', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
}
