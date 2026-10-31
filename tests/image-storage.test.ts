// ZP-468: product picture pipeline, storage drivers and the picture routes.
// No database access (business-rules.test.ts wipes the shared test DB).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import {
  processProductImage,
  saveProductImage,
  sniffImageType,
  getImageStorage,
  ImageRejectedError,
  imageKeyFromFileName,
  isValidImageKey,
} from '../src/lib/storage/images'
import { LocalImageStorage } from '../src/lib/storage/local'
import { GcsImageStorage, parseGsUri, downloadGsObject, type GcsClientLike } from '../src/lib/storage/gcs'

const TEST_SECRET = 'zp468-unit-test-secret-0123456789abcdef'
let tmp: string
let bigJpeg: Buffer
let smallPng: Buffer

const readAll = async (stream: ReadableStream<Uint8Array>) => Buffer.from(await new Response(stream).arrayBuffer())

before(async () => {
  tmp = await mkdtemp(path.join(process.env.TEMP || tmpdir(), 'zp468-images-'))
  bigJpeg = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: 'secret-camera-owner' } } })
    .toBuffer()
  smallPng = await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 0, g: 90, b: 0 } } })
    .png()
    .toBuffer()
})

after(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('sniffImageType', () => {
  test('detects JPEG, PNG, GIF and WebP from the bytes', async () => {
    assert.strictEqual(sniffImageType(bigJpeg), 'image/jpeg')
    assert.strictEqual(sniffImageType(smallPng), 'image/png')
    assert.strictEqual(sniffImageType(new TextEncoder().encode('GIF89a......')), 'image/gif')
    assert.strictEqual(sniffImageType(await sharp(smallPng).webp().toBuffer()), 'image/webp')
  })

  test('rejects SVG, HTML and text, whatever the file is called', () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<html><script>alert(1)</script>', 'hello']) {
      assert.strictEqual(sniffImageType(new TextEncoder().encode(text)), null)
    }
  })
})

describe('processProductImage', () => {
  test('resizes to max 1200px on the longest side, WebP, metadata stripped', async () => {
    const out = await processProductImage(bigJpeg)
    assert.strictEqual(out.contentType, 'image/webp')
    assert.strictEqual(out.sourceType, 'image/jpeg')
    assert.deepStrictEqual([out.width, out.height], [1200, 600])
    const meta = await sharp(out.bytes).metadata()
    assert.strictEqual(meta.format, 'webp')
    assert.strictEqual(meta.exif, undefined)
    assert.ok(!out.bytes.includes(Buffer.from('secret-camera-owner')))
    assert.ok(out.bytes.length < bigJpeg.length)
  })

  test('never enlarges small pictures', async () => {
    const out = await processProductImage(smallPng)
    assert.deepStrictEqual([out.width, out.height], [40, 20])
  })

  test('content-hashed key and URL; the same picture always gets the same key', async () => {
    const a = await processProductImage(smallPng)
    const b = await processProductImage(smallPng)
    assert.match(a.key, /^products\/[a-f0-9]{32}\.webp$/)
    assert.strictEqual(a.url, `/api/images/${a.key.slice('products/'.length)}`)
    assert.strictEqual(a.key, b.key)
    assert.notStrictEqual(a.key, (await processProductImage(bigJpeg)).key)
  })

  test('rejects non-images, empty files and corrupt pictures with ImageRejectedError', async () => {
    await assert.rejects(processProductImage(new TextEncoder().encode('<svg/>')), ImageRejectedError)
    await assert.rejects(processProductImage(new Uint8Array()), ImageRejectedError)
    const corrupt = Buffer.concat([bigJpeg.subarray(0, 4), Buffer.alloc(200, 7)])
    await assert.rejects(processProductImage(corrupt), ImageRejectedError)
  })
})

describe('image keys', () => {
  test('only <32 hex>.webp file names are accepted (no traversal)', () => {
    const good = 'a'.repeat(32) + '.webp'
    assert.strictEqual(imageKeyFromFileName(good), `products/${good}`)
    for (const bad of [
      '../etc/passwd',
      '..%2F..%2Fsecret',
      'A'.repeat(32) + '.webp',
      'a'.repeat(31) + '.webp',
      'a'.repeat(32) + '.png',
      'a'.repeat(32) + '.webp/..',
      'products/' + good,
      '',
      undefined,
    ]) {
      assert.strictEqual(imageKeyFromFileName(bad), null, String(bad))
    }
    assert.ok(isValidImageKey(`products/${good}`))
    assert.ok(!isValidImageKey(`products/../${good}`))
  })
})

describe('LocalImageStorage', () => {
  test('put/get/exists round trip; put is idempotent', async () => {
    const storage = new LocalImageStorage(path.join(tmp, 'local'))
    const img = await processProductImage(smallPng)
    assert.strictEqual(await storage.exists(img.key), false)
    assert.strictEqual(await storage.get(img.key), null)
    await storage.put(img.key, img.bytes)
    await storage.put(img.key, img.bytes)
    assert.strictEqual(await storage.exists(img.key), true)
    const got = (await storage.get(img.key))!
    assert.strictEqual(got.contentType, 'image/webp')
    assert.strictEqual(got.size, img.bytes.length)
    assert.ok((await readAll(got.stream)).equals(img.bytes))
    const files = await readdir(path.join(tmp, 'local', 'products'))
    assert.deepStrictEqual(files, [img.key.slice('products/'.length)]) // no temp files left behind
  })

  test('refuses keys outside the pattern', async () => {
    const storage = new LocalImageStorage(path.join(tmp, 'local'))
    await assert.rejects(storage.put('../escape.webp', Buffer.from('x')), /Invalid image key/)
    assert.strictEqual(await storage.get('products/../../x.webp'), null)
  })
})

function fakeGcs() {
  const objects = new Map<string, { data: Buffer; contentType: string; metadata?: Record<string, unknown> }>()
  const saves: string[] = []
  const client: GcsClientLike = {
    bucket(bucketName) {
      return {
        file(name) {
          const id = `${bucketName}/${name}`
          return {
            async save(data, opts) {
              saves.push(id)
              objects.set(id, { data, contentType: opts.contentType, metadata: opts.metadata })
            },
            async exists() {
              return [objects.has(id)] as [boolean]
            },
            async getMetadata() {
              const o = objects.get(id)!
              return [{ size: String(o.data.length), contentType: o.contentType }]
            },
            createReadStream() {
              return Readable.from([objects.get(id)!.data])
            },
            async download() {
              const o = objects.get(id)
              if (!o) throw new Error('No such object')
              return [o.data] as [Buffer]
            },
          }
        },
      }
    },
  }
  return { client, objects, saves }
}

describe('GcsImageStorage (fake client)', () => {
  test('stores private objects with content type, idempotently, and streams them back', async () => {
    const gcs = fakeGcs()
    const storage = new GcsImageStorage('grace-test-images', gcs.client)
    const img = await saveProductImage(smallPng, storage)
    await saveProductImage(smallPng, storage)
    assert.deepStrictEqual(gcs.saves, [`grace-test-images/${img.key}`])
    const obj = gcs.objects.get(`grace-test-images/${img.key}`)!
    assert.strictEqual(obj.contentType, 'image/webp')
    assert.deepStrictEqual(obj.metadata, { cacheControl: 'private, max-age=86400' })
    const got = (await storage.get(img.key))!
    assert.strictEqual(got.size, img.bytes.length)
    assert.ok((await readAll(got.stream)).equals(img.bytes))
    assert.strictEqual(await storage.get('products/' + 'b'.repeat(32) + '.webp'), null)
    assert.strictEqual(await storage.get('../x'), null)
  })

  test('gs:// URIs are parsed and downloaded', async () => {
    assert.deepStrictEqual(parseGsUri('gs://grace-imports/august/August trip.xlsx'), {
      bucket: 'grace-imports',
      object: 'august/August trip.xlsx',
    })
    for (const bad of ['gs://', 'gs://bucket', 'gs://bucket/', 's3://b/o', 'C:\\x.xlsx', 'gs://UPPER/x']) {
      assert.strictEqual(parseGsUri(bad), null, bad)
    }
    const gcs = fakeGcs()
    await gcs.client.bucket('grace-imports').file('a.xlsx').save(Buffer.from('xlsx-bytes'), { contentType: 'x', resumable: false })
    assert.strictEqual((await downloadGsObject('gs://grace-imports/a.xlsx', gcs.client)).toString(), 'xlsx-bytes')
    await assert.rejects(downloadGsObject('not-a-uri', gcs.client), /gs:\/\//)
  })
})

describe('getImageStorage (env selection)', () => {
  test('local by default, gcs with a bucket, errors otherwise', () => {
    assert.strictEqual(getImageStorage({ GRACE_IMAGE_DIR: tmp }).kind, 'local')
    const gcs = getImageStorage({ GRACE_IMAGE_STORAGE: 'gcs', GRACE_IMAGE_BUCKET: 'b-1' })
    assert.strictEqual(gcs.kind, 'gcs')
    assert.strictEqual((gcs as GcsImageStorage).bucketName, 'b-1')
    assert.throws(() => getImageStorage({ GRACE_IMAGE_STORAGE: 'gcs' }), /GRACE_IMAGE_BUCKET/)
    assert.throws(() => getImageStorage({ GRACE_IMAGE_STORAGE: 's3' }), /Unknown/)
  })
})

describe('picture routes', () => {
  let createToken: (userId: number, username: string, role: string) => Promise<string>
  let getImage: (req: Request, ctx: { params: Promise<{ key: string }> }) => Promise<Response>
  let upload: (req: Request) => Promise<Response>

  before(async () => {
    process.env.JWT_SECRET = TEST_SECRET
    process.env.GRACE_IMAGE_STORAGE = 'local'
    process.env.GRACE_IMAGE_DIR = path.join(tmp, 'routes')
    ;({ createToken } = await import('../src/lib/auth'))
    ;({ GET: getImage } = await import('../src/app/api/images/[key]/route'))
    ;({ POST: upload } = await import('../src/app/api/upload/route'))
  })

  const cookie = async (role: 'OWNER' | 'STAFF') =>
    `auth-token=${await createToken(role === 'OWNER' ? 1 : 2, role.toLowerCase(), role)}`
  const ctx = (key: string) => ({ params: Promise.resolve({ key }) })
  const uploadRequest = async (role: 'OWNER' | 'STAFF' | null, bytes: Uint8Array, name: string, type: string) => {
    const form = new FormData()
    form.append('file', new File([Buffer.from(bytes)], name, { type }))
    const headers: Record<string, string> = {}
    if (role) headers.cookie = await cookie(role)
    return new Request('http://localhost/api/upload', { method: 'POST', body: form, headers })
  }

  test('GET /api/images without a cookie -> 401', async () => {
    const res = await getImage(new Request('http://localhost/api/images/x'), ctx('a'.repeat(32) + '.webp'))
    assert.strictEqual(res.status, 401)
  })

  test('GET /api/images with a bad key -> 400; unknown key -> 404', async () => {
    const headers = { cookie: await cookie('STAFF') }
    const bad = await getImage(new Request('http://localhost/api/images/x', { headers }), ctx('..%2F.env'))
    assert.strictEqual(bad.status, 400)
    const missing = await getImage(new Request('http://localhost/api/images/x', { headers }), ctx('c'.repeat(32) + '.webp'))
    assert.strictEqual(missing.status, 404)
  })

  test('POST /api/upload: no cookie -> 401, STAFF -> 403', async () => {
    assert.strictEqual((await upload(await uploadRequest(null, smallPng, 'a.png', 'image/png'))).status, 401)
    assert.strictEqual((await upload(await uploadRequest('STAFF', smallPng, 'a.png', 'image/png'))).status, 403)
  })

  test('POST /api/upload rejects a non-image even when it claims to be a PNG', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
    const res = await upload(await uploadRequest('OWNER', svg, 'evil.png', 'image/png'))
    assert.strictEqual(res.status, 400)
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>')
    assert.strictEqual((await upload(await uploadRequest('OWNER', html, 'x.jpg', 'image/jpeg'))).status, 400)
  })

  test('OWNER upload re-encodes to WebP; staff can then view it with private caching', async () => {
    // Client says GIF with a .html name: both are ignored, the bytes decide.
    const res = await upload(await uploadRequest('OWNER', bigJpeg, 'photo.html', 'image/gif'))
    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.match(body.url, /^\/api\/images\/[a-f0-9]{32}\.webp$/)
    assert.deepStrictEqual([body.width, body.height], [1200, 600])

    const fileName = body.url.slice('/api/images/'.length)
    const got = await getImage(
      new Request(`http://localhost${body.url}`, { headers: { cookie: await cookie('STAFF') } }),
      ctx(fileName),
    )
    assert.strictEqual(got.status, 200)
    assert.strictEqual(got.headers.get('content-type'), 'image/webp')
    assert.strictEqual(got.headers.get('cache-control'), 'private, max-age=86400')
    assert.strictEqual(got.headers.get('x-content-type-options'), 'nosniff')
    const bytes = Buffer.from(await got.arrayBuffer())
    assert.strictEqual((await sharp(bytes).metadata()).format, 'webp')
  })
})
