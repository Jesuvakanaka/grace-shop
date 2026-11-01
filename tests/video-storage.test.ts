// ZP-501: video storage drivers. GCS with a fake client (one metadata
// request per stat, reads pass the range straight through), local with a
// temp folder. No network, no database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { GcsVideoStorage, LocalVideoStorage, type GcsVideoClientLike } from '../src/lib/storage/videos'

const KEY = `videos/${'a'.repeat(32)}.mp4`

function fakeGcs(objects: Record<string, { bytes: Buffer; updated: string }>) {
  const calls: string[] = []
  const client: GcsVideoClientLike = {
    bucket: () => ({
      file: (name: string) => ({
        save: async () => calls.push(`save ${name}`),
        exists: async () => {
          calls.push(`exists ${name}`)
          return [name in objects] as [boolean]
        },
        getMetadata: async () => {
          calls.push(`getMetadata ${name}`)
          const o = objects[name]
          if (!o) throw Object.assign(new Error('No such object'), { code: 404 })
          return [{ size: String(o.bytes.length), updated: o.updated }]
        },
        createReadStream: (opts?: { start?: number; end?: number }) => {
          calls.push(`read ${name} ${opts ? `${opts.start}-${opts.end}` : 'all'}`)
          const b = objects[name].bytes
          return Readable.from([opts ? b.subarray(opts.start, (opts.end ?? b.length - 1) + 1) : b])
        },
        createWriteStream: () => {
          throw new Error('unused')
        },
        delete: async () => calls.push(`delete ${name}`),
      }),
    }),
  }
  return { client, calls }
}

async function text(stream: NodeJS.ReadableStream | null) {
  const parts: Buffer[] = []
  for await (const c of stream as Readable) parts.push(c as Buffer)
  return Buffer.concat(parts).toString()
}

describe('GCS video storage', () => {
  test('stat is ONE metadata request (size + updated); a missing object is null', async () => {
    const { client, calls } = fakeGcs({ [KEY]: { bytes: Buffer.from('0123456789'), updated: '2026-11-01T10:00:00.000Z' } })
    const s = new GcsVideoStorage('bucket', client)
    assert.deepStrictEqual(await s.stat(KEY), { size: 10, updatedAt: new Date('2026-11-01T10:00:00.000Z') })
    assert.deepStrictEqual(calls, [`getMetadata ${KEY}`])
    assert.strictEqual(await s.stat(`videos/${'b'.repeat(32)}.mp4`), null)
    assert.strictEqual(await s.stat('../etc/passwd'), null)
  })

  test('read passes the range straight to the object stream, with no extra metadata requests', async () => {
    const { client, calls } = fakeGcs({ [KEY]: { bytes: Buffer.from('0123456789'), updated: '2026-11-01T10:00:00.000Z' } })
    const s = new GcsVideoStorage('bucket', client)
    assert.strictEqual(await text(await s.read(KEY, { start: 2, end: 4 })), '234')
    assert.deepStrictEqual(calls, [`read ${KEY} 2-4`])
  })
})

describe('local video storage', () => {
  test('stat gives size and mtime; read honours the range; keys outside the patterns throw', async () => {
    const dir = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'zp501-storage-'))
    try {
      const s = new LocalVideoStorage(dir)
      await s.putBytes(KEY, Buffer.from('0123456789'), 'video/mp4')
      const st = await s.stat(KEY)
      assert.strictEqual(st?.size, 10)
      assert.ok(st?.updatedAt instanceof Date)
      assert.strictEqual(await text(await s.read(KEY, { start: 5, end: 9 })), '56789')
      assert.strictEqual(await s.stat(`videos/${'c'.repeat(32)}.mp4`), null)
      assert.throws(() => s.pathFor('videos/../x.mp4'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
