// Local-disk image storage driver (ZP-468). Used in development and tests.
import { createReadStream } from 'node:fs'
import { mkdir, rename, stat, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { isValidImageKey, type ImageStorage, type StoredImage } from './keys'

export class LocalImageStorage implements ImageStorage {
  readonly kind = 'local' as const
  readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  /** Absolute path for a key; throws for any key the pipeline could not have made. */
  pathFor(key: string): string {
    if (!isValidImageKey(key)) throw new Error('Invalid image key')
    const full = path.resolve(this.root, ...key.split('/'))
    // Belt and braces: the key pattern already rules out traversal.
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid image key')
    return full
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile()
    } catch {
      return false
    }
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const target = this.pathFor(key)
    if (await this.exists(key)) return // content-hashed: same key, same bytes
    await mkdir(path.dirname(target), { recursive: true })
    // Write then rename, so a reader never sees a half-written file.
    const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(tmp, bytes)
      await rename(tmp, target)
    } finally {
      await rm(tmp, { force: true })
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  async get(key: string): Promise<StoredImage | null> {
    if (!isValidImageKey(key)) return null
    const file = this.pathFor(key)
    let size: number
    try {
      const s = await stat(file)
      if (!s.isFile()) return null
      size = s.size
    } catch {
      return null
    }
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>
    return { stream, size, contentType: 'image/webp' }
  }
}
