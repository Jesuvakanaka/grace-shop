// Product video storage (ZP-501). Server only.
//
// Same place as product pictures, under the "videos/" prefix: the driver and
// location come from the image settings (GRACE_IMAGE_STORAGE, GRACE_IMAGE_DIR,
// GRACE_IMAGE_BUCKET; see ./images.ts), so UAT uses the private images bucket
// through the runtime service account and development uses .data/uploads.
// Only keys accepted by isVideoStorageKey (./video-keys) can be read or
// written, so no request value can reach another object or path.
// Unlike pictures, reads support byte ranges (video streaming) and objects
// can be removed (upload chunks are deleted once the video is processed).
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomBytes } from 'node:crypto'
import { isVideoStorageKey } from './video-keys'

export type ByteRange = { start: number; end: number }

export interface VideoStorage {
  readonly kind: 'local' | 'gcs'
  /** Store bytes. Content-hashed keys are idempotent: an existing key is left as it is. */
  putBytes(key: string, bytes: Buffer, contentType: string): Promise<void>
  /** Store a local file (streamed, never fully in memory). Idempotent like putBytes. */
  putFile(key: string, file: string, contentType: string): Promise<void>
  /** Object size in bytes, or null when it does not exist. */
  size(key: string): Promise<number | null>
  /** Node stream of the object (or an inclusive byte range); null when it does not exist. */
  read(key: string, range?: ByteRange): Promise<Readable | null>
  /** Delete; a missing object is fine. */
  remove(key: string): Promise<void>
}

function assertKey(key: string) {
  if (!isVideoStorageKey(key)) throw new Error('Invalid video key')
}

export class LocalVideoStorage implements VideoStorage {
  readonly kind = 'local' as const
  readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  pathFor(key: string): string {
    assertKey(key)
    const full = path.resolve(this.root, ...key.split('/'))
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid video key')
    return full
  }

  async size(key: string): Promise<number | null> {
    if (!isVideoStorageKey(key)) return null
    try {
      const s = await stat(this.pathFor(key))
      return s.isFile() ? s.size : null
    } catch {
      return null
    }
  }

  private async writeVia(key: string, write: (tmp: string) => Promise<void>, overwrite: boolean) {
    const target = this.pathFor(key)
    if (!overwrite && (await this.size(key)) !== null) return
    await mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await write(tmp)
      await rename(tmp, target)
    } finally {
      await rm(tmp, { force: true })
    }
  }

  async putBytes(key: string, bytes: Buffer): Promise<void> {
    const overwrite = key.endsWith('.part')
    await this.writeVia(key, (tmp) => pipeline(Readable.from([bytes]), createWriteStream(tmp)), overwrite)
  }

  async putFile(key: string, file: string): Promise<void> {
    const overwrite = key.endsWith('.part')
    await this.writeVia(key, (tmp) => pipeline(createReadStream(file), createWriteStream(tmp)), overwrite)
  }

  async read(key: string, range?: ByteRange): Promise<Readable | null> {
    if ((await this.size(key)) === null) return null
    return createReadStream(this.pathFor(key), range ? { start: range.start, end: range.end } : undefined)
  }

  async remove(key: string): Promise<void> {
    const file = this.pathFor(key)
    await rm(file, { force: true })
    // An upload's folder (videos/uploads/<id>/) goes once its last chunk is gone.
    if (key.endsWith('.part')) await rmdir(path.dirname(file)).catch(() => {})
  }
}

/** The small part of the @google-cloud/storage File API this driver uses. */
export type GcsVideoFileLike = {
  save(data: Buffer, options: { contentType: string; resumable: boolean; metadata?: Record<string, unknown> }): Promise<unknown>
  exists(): Promise<[boolean]>
  getMetadata(): Promise<[{ size?: string | number }, ...unknown[]]>
  createReadStream(options?: { start?: number; end?: number }): NodeJS.ReadableStream
  createWriteStream(options: { contentType: string; resumable: boolean; metadata?: Record<string, unknown> }): NodeJS.WritableStream
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>
}
export type GcsVideoClientLike = { bucket(name: string): { file(name: string): GcsVideoFileLike } }

const GCS_METADATA = { cacheControl: 'private, max-age=86400' }

export class GcsVideoStorage implements VideoStorage {
  readonly kind = 'gcs' as const
  private clientPromise: Promise<GcsVideoClientLike> | null

  constructor(
    readonly bucketName: string,
    client?: GcsVideoClientLike,
  ) {
    this.clientPromise = client ? Promise.resolve(client) : null
  }

  private async file(key: string): Promise<GcsVideoFileLike> {
    assertKey(key)
    this.clientPromise ??= import('@google-cloud/storage').then(
      ({ Storage }) => new Storage() as unknown as GcsVideoClientLike,
    )
    return (await this.clientPromise).bucket(this.bucketName).file(key)
  }

  async size(key: string): Promise<number | null> {
    if (!isVideoStorageKey(key)) return null
    const file = await this.file(key)
    const [exists] = await file.exists()
    if (!exists) return null
    const [meta] = await file.getMetadata()
    const size = Number(meta.size)
    return Number.isFinite(size) ? size : null
  }

  async putBytes(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const file = await this.file(key)
    if (!key.endsWith('.part')) {
      const [exists] = await file.exists()
      if (exists) return
    }
    await file.save(bytes, { contentType, resumable: false, metadata: GCS_METADATA })
  }

  async putFile(key: string, localFile: string, contentType: string): Promise<void> {
    const file = await this.file(key)
    if (!key.endsWith('.part')) {
      const [exists] = await file.exists()
      if (exists) return // content-hashed: same key, same bytes
    }
    await pipeline(
      createReadStream(localFile),
      file.createWriteStream({ contentType, resumable: false, metadata: GCS_METADATA }),
    )
  }

  async read(key: string, range?: ByteRange): Promise<Readable | null> {
    if ((await this.size(key)) === null) return null
    const file = await this.file(key)
    return file.createReadStream(range ? { start: range.start, end: range.end } : undefined) as Readable
  }

  async remove(key: string): Promise<void> {
    await (await this.file(key)).delete({ ignoreNotFound: true })
  }
}

let cached: { signature: string; storage: VideoStorage } | null = null

/** Video storage from the image storage environment (cached per configuration). */
export function getVideoStorage(env: Record<string, string | undefined> = process.env): VideoStorage {
  const kind = (env.GRACE_IMAGE_STORAGE || 'local').trim().toLowerCase()
  const dir = env.GRACE_IMAGE_DIR || path.join(process.cwd(), '.data', 'uploads')
  const bucket = env.GRACE_IMAGE_BUCKET?.trim() ?? ''
  const signature = `${kind}|${bucket}|${dir}`
  if (cached?.signature === signature) return cached.storage

  let storage: VideoStorage
  if (kind === 'local') storage = new LocalVideoStorage(dir)
  else if (kind === 'gcs') {
    if (!bucket) throw new Error('GRACE_IMAGE_STORAGE=gcs needs GRACE_IMAGE_BUCKET.')
    storage = new GcsVideoStorage(bucket)
  } else throw new Error(`Unknown GRACE_IMAGE_STORAGE "${kind}" (use "local" or "gcs").`)

  cached = { signature, storage }
  return storage
}
