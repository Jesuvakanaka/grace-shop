// Google Cloud Storage image driver and gs:// reader (ZP-468).
//
// Uses application default credentials (on Cloud Run: the runtime service
// account, which has objectUser on the images bucket). Objects stay private;
// the app serves them through the authenticated /api/images route.
// @google-cloud/storage is loaded lazily so the local driver never pulls it in.
import { Readable } from 'node:stream'
import { isValidImageKey, type ImageStorage, type StoredImage } from './keys'

/** The small part of the @google-cloud/storage client this module uses. */
export type GcsFileLike = {
  save(data: Buffer, options: { contentType: string; resumable: boolean; metadata?: Record<string, unknown> }): Promise<unknown>
  exists(): Promise<[boolean]>
  getMetadata(): Promise<[{ size?: string | number; contentType?: string }, ...unknown[]]>
  createReadStream(): NodeJS.ReadableStream
  download(): Promise<[Buffer]>
  /** ZP-508; optional so read-only test doubles need not implement it. */
  delete?(options: { ignoreNotFound: boolean }): Promise<unknown>
}
export type GcsClientLike = { bucket(name: string): { file(name: string): GcsFileLike } }

async function defaultClient(): Promise<GcsClientLike> {
  const { Storage } = await import('@google-cloud/storage')
  return new Storage() as unknown as GcsClientLike
}

export class GcsImageStorage implements ImageStorage {
  readonly kind = 'gcs' as const
  private clientPromise: Promise<GcsClientLike> | null

  constructor(
    readonly bucketName: string,
    client?: GcsClientLike,
  ) {
    this.clientPromise = client ? Promise.resolve(client) : null
  }

  private async file(key: string): Promise<GcsFileLike> {
    if (!isValidImageKey(key)) throw new Error('Invalid image key')
    this.clientPromise ??= defaultClient()
    return (await this.clientPromise).bucket(this.bucketName).file(key)
  }

  async exists(key: string): Promise<boolean> {
    if (!isValidImageKey(key)) return false
    const [exists] = await (await this.file(key)).exists()
    return exists
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const file = await this.file(key)
    const [exists] = await file.exists()
    if (exists) return // content-hashed: same key, same bytes
    await file.save(bytes, {
      contentType,
      resumable: false,
      metadata: { cacheControl: 'private, max-age=86400' },
    })
  }

  /** Needs storage.objects.delete on the bucket for the runtime service account. */
  async delete(key: string): Promise<void> {
    const file = await this.file(key)
    if (!file.delete) throw new Error('This storage client cannot delete objects')
    await file.delete({ ignoreNotFound: true })
  }

  async get(key: string): Promise<StoredImage | null> {
    if (!isValidImageKey(key)) return null
    const file = await this.file(key)
    const [exists] = await file.exists()
    if (!exists) return null
    const [meta] = await file.getMetadata()
    const size = meta.size === undefined ? null : Number(meta.size)
    const nodeStream = file.createReadStream() as Readable
    return {
      stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
      size: Number.isFinite(size) ? size : null,
      contentType: 'image/webp',
    }
  }
}

/** Parse "gs://bucket/path/to/object" -> { bucket, object }; null when not a valid gs:// URI. */
export function parseGsUri(uri: string): { bucket: string; object: string } | null {
  const m = /^gs:\/\/([a-z0-9][a-z0-9._-]{1,220}[a-z0-9])\/(.+)$/.exec(uri.trim())
  if (!m || m[2].endsWith('/')) return null
  return { bucket: m[1], object: m[2] }
}

/** Download a whole object (used to read the spreadsheet from a private bucket). */
export async function downloadGsObject(uri: string, client?: GcsClientLike): Promise<Buffer> {
  const parsed = parseGsUri(uri)
  if (!parsed) throw new Error(`Not a gs://bucket/object URI: ${uri}`)
  const c = client ?? (await defaultClient())
  const [data] = await c.bucket(parsed.bucket).file(parsed.object).download()
  return data
}
