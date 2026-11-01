/* eslint-disable @typescript-eslint/no-explicit-any -- JSON response bodies in assertions */
// ZP-501: admin video API end to end, against DATABASE_URL, a temp local
// storage and the REAL ffmpeg/ffprobe (GRACE_FFMPEG_PATH / GRACE_FFPROBE_PATH
// or PATH). The ffmpeg-dependent tests are skipped when ffmpeg is missing.
// Only touches rows it creates (item numbers "ZP501A-*", category slugs "zp501a-*").
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.JWT_SECRET = 'zp501-video-admin-tests-secret-0123456789abcdef'
const TMP = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'zp501-admin-'))
process.env.GRACE_IMAGE_STORAGE = 'local'
process.env.GRACE_IMAGE_DIR = path.join(TMP, 'storage')
process.env.GRACE_VIDEO_TMP_DIR = path.join(TMP, 'work')
fs.mkdirSync(process.env.GRACE_VIDEO_TMP_DIR, { recursive: true })

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import { getVideoStorage } from '../src/lib/storage/videos'
import * as videoRoute from '../src/app/api/website/products/[id]/video/route'
import * as uploadsRoute from '../src/app/api/website/products/[id]/video/uploads/route'
import * as chunkRoute from '../src/app/api/website/products/[id]/video/chunks/[index]/route'
import * as publicRoute from '../src/app/api/videos/public/[key]/route'
import * as websiteProduct from '../src/app/api/website/products/[id]/route'
import { ffmpegPath, ffprobePath } from '../src/lib/website/video-process'
import { processVideoUpload, removeProductVideo } from '../src/lib/website/video'
import { signVideoUpload } from '../src/lib/website/video-upload-token'
import { VIDEO_CHUNK_BYTES, VIDEO_MAX_UPLOAD_BYTES } from '../src/lib/website/video-validation'
import type { RevalidateScope } from '../src/lib/website/revalidate'

const FFMPEG = ffmpegPath()
const HAS_FFMPEG =
  spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' }).status === 0 &&
  spawnSync(ffprobePath(), ['-version'], { encoding: 'utf8' }).status === 0
const needsFfmpeg = { skip: HAS_FFMPEG ? false : 'ffmpeg/ffprobe not found (set GRACE_FFMPEG_PATH / GRACE_FFPROBE_PATH)' }

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
let ownerToken = ''
let staffToken = ''

async function call(
  fn: unknown,
  method: string,
  params: Record<string, string>,
  opts: { body?: unknown; raw?: Uint8Array; token?: string | null; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: any; res: Response }> {
  const headers: Record<string, string> = { ...opts.headers }
  const token = opts.token === undefined ? ownerToken : opts.token
  if (token) headers.cookie = `auth-token=${token}`
  let body: BodyInit | undefined
  if (opts.raw) {
    headers['Content-Type'] = 'application/octet-stream'
    body = opts.raw as unknown as BodyInit
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await (fn as Handler)(new Request('http://localhost/api/test', { method, headers, body }), {
    params: Promise.resolve(params),
  })
  const text = await res.clone().text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json, res }
}

function makeClip(name: string, args: string[]): Buffer {
  const out = path.join(TMP, name)
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args, out], { encoding: 'utf8' })
  assert.strictEqual(r.status, 0, r.stderr)
  return fs.readFileSync(out)
}

function ffprobeJson(file: string): any {
  const r = spawnSync(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    encoding: 'utf8',
  })
  assert.strictEqual(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

/** Start an upload and send every chunk; returns the upload token. */
async function upload(productId: number, bytes: Buffer): Promise<string> {
  const id = String(productId)
  const start = await call(uploadsRoute.POST, 'POST', { id }, { body: { size: bytes.length } })
  assert.strictEqual(start.status, 200, JSON.stringify(start.json))
  assert.strictEqual(start.json.chunkSize, VIDEO_CHUNK_BYTES)
  for (let i = 0; i < start.json.chunks; i++) {
    const part = bytes.subarray(i * VIDEO_CHUNK_BYTES, (i + 1) * VIDEO_CHUNK_BYTES)
    const r = await call(chunkRoute.PUT, 'PUT', { id, index: String(i) }, {
      raw: new Uint8Array(part),
      headers: { 'x-upload-token': start.json.token },
    })
    assert.strictEqual(r.status, 200, JSON.stringify(r.json))
  }
  return start.json.token
}

let n = 0
async function product(publish = true) {
  n += 1
  const cat = await prisma.category.create({ data: { name: `zp501a cat ${n}`, slug: `zp501a-cat-${n}`, published: true } })
  return prisma.product.create({
    data: {
      itemNumber: `ZP501A-${n}`,
      productName: `ZP501A ${n}`,
      categoryId: cat.id,
      published: publish,
      publishedAt: publish ? new Date() : null,
      slug: `zp501a-${n}`,
      images: { create: { imageKey: `products/${'f'.repeat(32)}.webp`, isPrimary: true } },
    },
  })
}

async function cleanup() {
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP501A-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp501a-' } } })
}

let portrait: Buffer
describe('admin video API (ZP-501)', () => {
  before(async () => {
    ownerToken = await createToken(900501, 'zp501-owner', 'OWNER')
    staffToken = await createToken(900502, 'zp501-staff', 'STAFF')
    await cleanup()
    if (HAS_FFMPEG) {
      // 5 s 1080x1920 with sound and a title tag, both of which must be stripped.
      portrait = makeClip('portrait.mp4', [
        '-f', 'lavfi', '-i', 'testsrc=duration=5:size=1080x1920:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
        '-metadata', 'title=SECRET-LOCATION', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest',
      ])
    }
  })
  after(async () => {
    await cleanup()
    await prisma.$disconnect()
    fs.rmSync(TMP, { recursive: true, force: true })
  })

  test('owner only: signed out 401, staff 403 on every video endpoint', async () => {
    const p = await product()
    const id = String(p.id)
    for (const token of [null, staffToken]) {
      const expected = token ? 403 : 401
      assert.strictEqual((await call(videoRoute.GET, 'GET', { id }, { token })).status, expected)
      assert.strictEqual((await call(videoRoute.POST, 'POST', { id }, { token, body: { token: 'x' } })).status, expected)
      assert.strictEqual((await call(videoRoute.DELETE, 'DELETE', { id }, { token })).status, expected)
      assert.strictEqual((await call(uploadsRoute.POST, 'POST', { id }, { token, body: { size: 10 } })).status, expected)
      assert.strictEqual((await call(chunkRoute.PUT, 'PUT', { id, index: '0' }, { token, raw: new Uint8Array(10) })).status, expected)
    }
  })

  test('invalid ids are 400, unknown products 404', async () => {
    for (const id of ['0', '-1', 'abc', '1.5', '99999999999']) {
      assert.strictEqual((await call(videoRoute.GET, 'GET', { id })).status, 400, id)
      assert.strictEqual((await call(uploadsRoute.POST, 'POST', { id }, { body: { size: 10 } })).status, 400, id)
    }
    assert.strictEqual((await call(videoRoute.GET, 'GET', { id: '999999999' })).status, 404)
    assert.strictEqual((await call(uploadsRoute.POST, 'POST', { id: '999999999' }, { body: { size: 10 } })).status, 404)
  })

  test('refusals before any processing: over 60 MB, empty, not a video, a chunk larger than declared, a foreign token', async () => {
    const p = await product()
    const id = String(p.id)
    const big = await call(uploadsRoute.POST, 'POST', { id }, { body: { size: VIDEO_MAX_UPLOAD_BYTES + 1 } })
    assert.strictEqual(big.status, 400)
    assert.match(big.json.error, /too large.*60 MB/i)
    assert.strictEqual((await call(uploadsRoute.POST, 'POST', { id }, { body: { size: 0 } })).status, 400)

    // A PNG renamed .mp4: refused from its first bytes.
    const png = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(200)])
    const start = await call(uploadsRoute.POST, 'POST', { id }, { body: { size: png.length } })
    const r = await call(chunkRoute.PUT, 'PUT', { id, index: '0' }, { raw: new Uint8Array(png), headers: { 'x-upload-token': start.json.token } })
    assert.strictEqual(r.status, 400)
    assert.match(r.json.error, /not a supported video/i)

    // More bytes than declared: 413, nothing stored.
    const s2 = await call(uploadsRoute.POST, 'POST', { id }, { body: { size: 100 } })
    const over = await call(chunkRoute.PUT, 'PUT', { id, index: '0' }, { raw: new Uint8Array(101), headers: { 'x-upload-token': s2.json.token } })
    assert.strictEqual(over.status, 413)
    // Chunk index beyond the upload: 400.
    const idx = await call(chunkRoute.PUT, 'PUT', { id, index: '1' }, { raw: new Uint8Array(10), headers: { 'x-upload-token': s2.json.token } })
    assert.strictEqual(idx.status, 400)

    // A token for another product, a missing token, a garbage token: 403.
    const other = await product()
    const s3 = await call(uploadsRoute.POST, 'POST', { id: String(other.id) }, { body: { size: 100 } })
    for (const token of [s3.json.token, undefined, 'garbage']) {
      const headers: Record<string, string> = token ? { 'x-upload-token': token } : {}
      assert.strictEqual((await call(chunkRoute.PUT, 'PUT', { id, index: '0' }, { raw: new Uint8Array(100), headers })).status, 403)
    }
    assert.strictEqual((await call(videoRoute.POST, 'POST', { id }, { body: { token: s3.json.token } })).status, 403)

    // Processing before the chunks arrived: 400 incomplete, and the video is FAILED with that reason.
    const s4 = await call(uploadsRoute.POST, 'POST', { id }, { body: { size: 100 } })
    const early = await call(videoRoute.POST, 'POST', { id }, { body: { token: s4.json.token } })
    assert.strictEqual(early.status, 400)
    assert.match(early.json.error, /incomplete/i)
    const state = await call(videoRoute.GET, 'GET', { id })
    assert.strictEqual(state.json.video.status, 'FAILED')
  })

  test('upload a 5 s 1080x1920 clip: processed to 720x1280 H.264 High yuv420p, no audio, no metadata, faststart; public after publish', needsFfmpeg, async () => {
    const p = await product()
    const id = String(p.id)
    const token = await upload(p.id, portrait)
    const t0 = Date.now()
    const done = await call(videoRoute.POST, 'POST', { id }, { body: { token } })
    const ms = Date.now() - t0
    assert.strictEqual(done.status, 200, JSON.stringify(done.json))
    const v = done.json.video
    assert.strictEqual(v.status, 'READY')
    assert.strictEqual(v.width, 720)
    assert.strictEqual(v.height, 1280)
    assert.ok(Math.abs(v.durationMs - 5000) < 200, String(v.durationMs))
    assert.match(v.url, /^\/api\/videos\/[a-f0-9]{32}\.mp4$/)
    assert.match(v.posterUrl, /^\/api\/videos\/[a-f0-9]{32}\.webp$/)
    console.log(`  processed 5 s 1080x1920 in ${ms} ms (${v.sizeBytes} bytes)`)

    const row = await prisma.productVideo.findUniqueOrThrow({ where: { productId: p.id } })
    assert.strictEqual(row.createdBy, 'zp501-owner')
    const file = (getVideoStorage() as any).pathFor(row.videoKey)
    const info = ffprobeJson(file)
    const streams = info.streams as any[]
    assert.deepStrictEqual(streams.map((s) => s.codec_type), ['video'], 'audio stripped')
    assert.strictEqual(streams[0].codec_name, 'h264')
    assert.strictEqual(streams[0].profile, 'High')
    assert.strictEqual(streams[0].pix_fmt, 'yuv420p')
    assert.ok(!JSON.stringify(info.format.tags ?? {}).includes('SECRET-LOCATION'), 'metadata stripped')
    const bytes = fs.readFileSync(file)
    assert.ok(bytes.indexOf('moov') < bytes.indexOf('mdat'), 'faststart: moov before mdat')
    // Chunks were deleted.
    assert.ok(!fs.existsSync(path.join(process.env.GRACE_IMAGE_DIR!, 'videos', 'uploads')) ||
      fs.readdirSync(path.join(process.env.GRACE_IMAGE_DIR!, 'videos', 'uploads')).every((d) =>
        fs.readdirSync(path.join(process.env.GRACE_IMAGE_DIR!, 'videos', 'uploads', d)).length === 0))
    // Temp work folders are gone.
    assert.deepStrictEqual(fs.readdirSync(process.env.GRACE_VIDEO_TMP_DIR!), [])

    // Public: served with Range; the website product GET still says ready (video optional).
    const name = row.videoKey!.slice('videos/'.length)
    const pub = await (publicRoute.GET as any)(new Request('http://x/', { headers: { range: 'bytes=0-1' } }), { params: Promise.resolve({ key: name }) })
    assert.strictEqual(pub.status, 206)
    assert.strictEqual((await pub.arrayBuffer()).byteLength, 2)
    const wp = await call(websiteProduct.GET, 'GET', { id })
    assert.strictEqual(wp.status, 200)
  })

  test('WebM and MOV inputs are accepted; a 32 s clip and an audio-only file are refused with a reason', needsFfmpeg, async () => {
    const webm = makeClip('small.webm', ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15', '-c:v', 'libvpx-vp9', '-b:v', '200k', '-deadline', 'realtime'])
    const mov = makeClip('small.mov', ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=1920x1080:rate=60', '-c:v', 'libx264', '-preset', 'ultrafast'])
    const long = makeClip('long.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=32:size=160x284:rate=10', '-c:v', 'libx264', '-preset', 'ultrafast'])
    const audio = makeClip('audio.mp4', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac'])

    const a = await product()
    const w = await call(videoRoute.POST, 'POST', { id: String(a.id) }, { body: { token: await upload(a.id, webm) } })
    assert.strictEqual(w.status, 200, JSON.stringify(w.json))
    assert.deepStrictEqual([w.json.video.width, w.json.video.height], [320, 240])

    const b = await product()
    const m = await call(videoRoute.POST, 'POST', { id: String(b.id) }, { body: { token: await upload(b.id, mov) } })
    assert.strictEqual(m.status, 200, JSON.stringify(m.json))
    assert.deepStrictEqual([m.json.video.width, m.json.video.height], [1280, 720])

    const c = await product()
    const l = await call(videoRoute.POST, 'POST', { id: String(c.id) }, { body: { token: await upload(c.id, long) } })
    assert.strictEqual(l.status, 400)
    assert.match(l.json.error, /32 s long; the limit is 30 s/)
    assert.strictEqual((await call(videoRoute.GET, 'GET', { id: String(c.id) })).json.video.status, 'FAILED')

    const d = await product()
    const s = await call(videoRoute.POST, 'POST', { id: String(d.id) }, { body: { token: await upload(d.id, audio) } })
    assert.strictEqual(s.status, 400)
    assert.match(s.json.error, /no video picture/i)
  })

  test('replace keeps the old video live if the new one fails; remove deletes it; both expire the product tags', needsFfmpeg, async () => {
    const p = await product()
    const scopes: RevalidateScope[] = []
    const deps = { db: prisma, storage: getVideoStorage(), revalidate: (s: RevalidateScope) => scopes.push(s) }
    const sign = (size: number) => signVideoUpload({ productId: p.id, size, username: 'zp501-owner' })

    // First video through the API, then capture the READY row. A clip no other
    // test uses: keys are content-hashed, so an identical video of another
    // public product would (correctly) stay public after this one is removed.
    const own = makeClip('own.mp4', ['-f', 'lavfi', '-i', 'testsrc2=duration=2:size=540x960:rate=30', '-c:v', 'libx264', '-preset', 'ultrafast'])
    const token = await upload(p.id, own)
    assert.strictEqual((await call(videoRoute.POST, 'POST', { id: String(p.id) }, { body: { token } })).status, 200)
    const first = await prisma.productVideo.findUniqueOrThrow({ where: { productId: p.id } })

    // A failing replacement (processing throws): the old video stays READY with its keys.
    const bad = await sign(portrait.length)
    await (await import('../src/lib/website/video')).storeVideoChunk(getVideoStorage(), bad.upload, 0, new Blob([new Uint8Array(portrait.subarray(0, VIDEO_CHUNK_BYTES))]).stream())
    await assert.rejects(
      processVideoUpload({ ...deps, process: async () => { throw new Error('boom') } }, bad.upload),
      (e: any) => e.status === 500,
    )
    const still = await prisma.productVideo.findUniqueOrThrow({ where: { productId: p.id } })
    assert.strictEqual(still.status, 'READY')
    assert.strictEqual(still.videoKey, first.videoKey)

    const removed = await removeProductVideo(prisma, p.id, deps.revalidate)
    assert.deepStrictEqual(removed, { removed: true })
    assert.strictEqual(await prisma.productVideo.findUnique({ where: { productId: p.id } }), null)
    assert.deepStrictEqual(scopes.at(-1), { productSlugs: [p.slug] })

    // The API's DELETE answers with no video.
    const del = await call(videoRoute.DELETE, 'DELETE', { id: String(p.id) })
    assert.strictEqual(del.status, 200)
    assert.strictEqual(del.json.video, null)
    // The old public URL is now 404.
    const name = first.videoKey!.slice('videos/'.length)
    const pub = await (publicRoute.GET as any)(new Request('http://x/'), { params: Promise.resolve({ key: name }) })
    assert.strictEqual(pub.status, 404)
  })

  test('a successful upload expires the product tags', needsFfmpeg, async () => {
    const p = await product()
    const scopes: RevalidateScope[] = []
    const token = await upload(p.id, portrait)
    const { verifyVideoUpload } = await import('../src/lib/website/video-upload-token')
    const up = await verifyVideoUpload(token, { productId: p.id, username: 'zp501-owner' })
    assert.ok(up)
    await processVideoUpload({ db: prisma, storage: getVideoStorage(), revalidate: (s) => scopes.push(s) }, up)
    assert.deepStrictEqual(scopes, [{ productSlugs: [p.slug] }])
  })
})
