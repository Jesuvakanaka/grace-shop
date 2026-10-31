// Product picture pipeline and storage selection (ZP-468).
//
// One pipeline for every product picture (spreadsheet import and the owner's
// upload): sniff the real type from the bytes, re-encode with sharp (auto
// rotate, max 1200px on the longest side, WebP quality 80, metadata stripped),
// store under a content-hashed key, and serve through the authenticated route
// GET /api/images/<hash>.webp.
//
// Driver chosen by env GRACE_IMAGE_STORAGE:
// - "local" (default): files under GRACE_IMAGE_DIR, default <cwd>/.data/uploads
//   (gitignored; never public/, which standalone Next does not serve after start).
// - "gcs": private objects in bucket GRACE_IMAGE_BUCKET, via application
//   default credentials (Cloud Run runtime service account).
import { createHash } from 'node:crypto'
import path from 'node:path'
import sharp from 'sharp'
import { LocalImageStorage } from './local'
import { GcsImageStorage } from './gcs'
import {
  IMAGE_CONTENT_TYPE,
  PRODUCT_IMAGE_PREFIX,
  imageUrlForKey,
  type ImageStorage,
} from './keys'

export {
  IMAGE_CONTENT_TYPE,
  IMAGE_URL_PREFIX,
  PRODUCT_IMAGE_PREFIX,
  imageKeyFromFileName,
  imageUrlForKey,
  isValidImageKey,
  type ImageStorage,
  type StoredImage,
} from './keys'

export const IMAGE_MAX_DIMENSION = 1200
export const IMAGE_WEBP_QUALITY = 80
/** Files above this are rejected before decoding. */
export const IMAGE_MAX_UPLOAD_BYTES = 15 * 1024 * 1024
/** Decompression-bomb guard: refuse images above this many pixels. */
export const IMAGE_MAX_INPUT_PIXELS = 120_000_000

export type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end))

/** Detect the image type from magic bytes. Never trusts a filename or client MIME type. */
export function sniffImageType(b: Uint8Array): SniffedImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png'
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return 'image/gif'
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** The input is not an acceptable picture (shown to the user as a 400). */
export class ImageRejectedError extends Error {}

export type ProcessedImage = {
  /** Object key, e.g. "products/<32 hex>.webp". */
  key: string
  /** URL to store in Product.imageUrl, e.g. "/api/images/<32 hex>.webp". */
  url: string
  bytes: Buffer
  contentType: typeof IMAGE_CONTENT_TYPE
  width: number
  height: number
  sourceType: SniffedImageType
}

/** Re-encode a picture for the web. Throws ImageRejectedError for anything that is not a supported picture. */
export async function processProductImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageRejectedError('The file is empty.')
  if (input.length > IMAGE_MAX_UPLOAD_BYTES) {
    throw new ImageRejectedError(`The picture is too large (max ${IMAGE_MAX_UPLOAD_BYTES / 1024 / 1024} MB).`)
  }
  const sourceType = sniffImageType(input)
  if (!sourceType) throw new ImageRejectedError('Only JPEG, PNG, GIF or WebP pictures are allowed.')

  let output: { data: Buffer; info: { width: number; height: number } }
  try {
    output = await sharp(input, { limitInputPixels: IMAGE_MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate() // apply EXIF orientation; metadata is not copied to the output
      .resize({
        width: IMAGE_MAX_DIMENSION,
        height: IMAGE_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: IMAGE_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true })
  } catch (err) {
    throw new ImageRejectedError(
      `The picture could not be read (${err instanceof Error ? err.message : 'decode error'}).`,
    )
  }
  const hash = createHash('sha256').update(output.data).digest('hex').slice(0, 32)
  const key = `${PRODUCT_IMAGE_PREFIX}${hash}.webp`
  return {
    key,
    url: imageUrlForKey(key),
    bytes: output.data,
    contentType: IMAGE_CONTENT_TYPE,
    width: output.info.width,
    height: output.info.height,
    sourceType,
  }
}

/** Process and store a picture. Returns the processed image (use `.url` for Product.imageUrl). */
export async function saveProductImage(
  input: Uint8Array,
  storage: ImageStorage = getImageStorage(),
): Promise<ProcessedImage> {
  const processed = await processProductImage(input)
  await storage.put(processed.key, processed.bytes, processed.contentType)
  return processed
}

let cached: { signature: string; storage: ImageStorage } | null = null

/** Storage driver from the environment (cached per configuration). */
export function getImageStorage(env: Record<string, string | undefined> = process.env): ImageStorage {
  const kind = (env.GRACE_IMAGE_STORAGE || 'local').trim().toLowerCase()
  const dir = env.GRACE_IMAGE_DIR || path.join(process.cwd(), '.data', 'uploads')
  const bucket = env.GRACE_IMAGE_BUCKET?.trim() ?? ''
  const signature = `${kind}|${bucket}|${dir}`
  if (cached?.signature === signature) return cached.storage

  let storage: ImageStorage
  if (kind === 'local') storage = new LocalImageStorage(dir)
  else if (kind === 'gcs') {
    if (!bucket) throw new Error('GRACE_IMAGE_STORAGE=gcs needs GRACE_IMAGE_BUCKET.')
    storage = new GcsImageStorage(bucket)
  } else throw new Error(`Unknown GRACE_IMAGE_STORAGE "${kind}" (use "local" or "gcs").`)

  cached = { signature, storage }
  return storage
}
