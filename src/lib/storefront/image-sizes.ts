// Responsive sizes for public pictures (ZP-484). Pure; safe to import anywhere.
//
// Storefront components use <img src srcset sizes> with these helpers, NOT
// next/image: the Next optimiser keeps serving a cached size after the
// picture is unpublished (docs/storefront/public-data-layer.md).
import { isValidImageKey, PRODUCT_IMAGE_PREFIX } from '@/lib/storage/keys'

/**
 * Longest side of a stored picture. Mirrors IMAGE_MAX_DIMENSION in
 * src/lib/storage/images.ts, which is server-only (a test keeps them equal).
 */
export const STORED_IMAGE_MAX_DIMENSION = 1200

/** URL prefix of the public image route (GET /api/images/public/<32 hex>.webp). */
export const PUBLIC_IMAGE_URL_PREFIX = '/api/images/public/'

/** The only widths GET /api/images/public/<key>?w= accepts. */
export const PUBLIC_IMAGE_WIDTHS = [320, 480, 640, 828, 1080, 1200, 1600] as const
export type PublicImageWidth = (typeof PUBLIC_IMAGE_WIDTHS)[number]

/**
 * Widths listed in srcset. Stored pictures are at most 1200 px on the
 * longest side and are never upscaled, so wider entries would only repeat
 * the 1200px picture. 1600 is accepted by the route but not listed.
 */
export const SRCSET_WIDTHS: readonly PublicImageWidth[] = PUBLIC_IMAGE_WIDTHS.filter(
  (w) => w <= STORED_IMAGE_MAX_DIMENSION,
)

export function isPublicImageWidth(value: unknown): value is PublicImageWidth {
  return typeof value === 'number' && (PUBLIC_IMAGE_WIDTHS as readonly number[]).includes(value)
}

/**
 * Parse the query of the public image route. Only `w`, at most once, with an
 * allow-listed width. No `w` means the original picture.
 */
export function parsePublicImageWidth(
  params: URLSearchParams,
): { ok: true; width: PublicImageWidth | null } | { ok: false; error: string } {
  const keys = [...params.keys()]
  if (keys.some((k) => k !== 'w')) return { ok: false, error: 'Only the "w" parameter is allowed' }
  if (keys.length === 0) return { ok: true, width: null }
  if (keys.length > 1) return { ok: false, error: '"w" may be given once' }
  const raw = params.get('w') ?? ''
  const width = /^[1-9]\d{2,3}$/.test(raw) ? Number(raw) : NaN
  if (!isPublicImageWidth(width)) return { ok: false, error: `"w" must be one of ${PUBLIC_IMAGE_WIDTHS.join(', ')}` }
  return { ok: true, width }
}

/** URL of a public picture, optionally at an allow-listed width. Throws for an invalid key or width. */
export function publicImageSrc(key: string, width?: PublicImageWidth | number): string {
  if (!isValidImageKey(key)) throw new Error('Invalid image key')
  const base = `${PUBLIC_IMAGE_URL_PREFIX}${key.slice(PRODUCT_IMAGE_PREFIX.length)}`
  if (width === undefined) return base
  if (!isPublicImageWidth(width)) throw new Error(`Width must be one of ${PUBLIC_IMAGE_WIDTHS.join(', ')}`)
  return `${base}?w=${width}`
}

/** `srcset` value: "<url>?w=320 320w, <url>?w=480 480w, ...". Throws for an invalid key. */
export function publicImageSrcSet(key: string): string {
  return SRCSET_WIDTHS.map((w) => `${publicImageSrc(key, w)} ${w}w`).join(', ')
}
