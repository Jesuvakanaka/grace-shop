// Object keys and URLs for product pictures (ZP-468). Pure; shared by the
// pipeline, the storage drivers and the /api/images route.

/** Folder (object prefix) for product pictures. */
export const PRODUCT_IMAGE_PREFIX = 'products/'
/** URL prefix; the route maps <hash>.webp to the object products/<hash>.webp. */
export const IMAGE_URL_PREFIX = '/api/images/'
export const IMAGE_CONTENT_TYPE = 'image/webp'

const IMAGE_FILE_NAME = /^[a-f0-9]{32}\.webp$/

/**
 * Validate the file name from GET /api/images/<name> and return its object
 * key. Only "<32 lowercase hex>.webp" is accepted: no slashes, dots, encoded
 * characters or other extensions, so no path traversal is possible.
 */
export function imageKeyFromFileName(fileName: unknown): string | null {
  if (typeof fileName !== 'string' || !IMAGE_FILE_NAME.test(fileName)) return null
  return `${PRODUCT_IMAGE_PREFIX}${fileName}`
}

/** True for a key the pipeline could have produced ("products/<32 hex>.webp"). */
export function isValidImageKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.startsWith(PRODUCT_IMAGE_PREFIX) &&
    IMAGE_FILE_NAME.test(key.slice(PRODUCT_IMAGE_PREFIX.length))
  )
}

export function imageUrlForKey(key: string): string {
  if (!isValidImageKey(key)) throw new Error('Invalid image key')
  return `${IMAGE_URL_PREFIX}${key.slice(PRODUCT_IMAGE_PREFIX.length)}`
}

export type StoredImage = {
  stream: ReadableStream<Uint8Array>
  size: number | null
  contentType: string
}

export interface ImageStorage {
  readonly kind: 'local' | 'gcs'
  /** Store bytes under key. Idempotent: an existing key is left as it is. */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>
  /** Null when the key does not exist. */
  get(key: string): Promise<StoredImage | null>
  exists(key: string): Promise<boolean>
}
