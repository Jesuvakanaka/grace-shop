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
import { createHash, randomBytes } from 'node:crypto'
import { ffmpegPath, ffprobePath, processVideoFile, type ProcessedVideo } from '../src/lib/website/video-process'
import { processVideoUpload, removeProductVideo, storeVideoChunk } from '../src/lib/website/video'
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

  // ─── Review fixes (no ffmpeg needed: processing is stubbed) ───────────────

  /** A tiny "MP4" that passes the sniffer (ISO-BMFF ftyp isom). */
  function fakeMp4(): Buffer {
    const b = Buffer.alloc(64)
    b.writeUInt32BE(16, 0)
    b.write('ftypisom', 4, 'latin1')
    randomBytes(40).copy(b, 24)
    return b
  }
  /** Stub for the ffmpeg step: a unique "video" and poster in the work folder. */
  async function fakeProcess(_input: string, workDir: string): Promise<ProcessedVideo> {
    const bytes = randomBytes(64)
    const poster = randomBytes(32)
    const videoFile = path.join(workDir, 'out.mp4')
    fs.writeFileSync(videoFile, bytes)
    const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 32)
    return {
      videoFile, videoHash: hash(bytes), videoBytes: bytes.length, poster, posterHash: hash(poster),
      width: 720, height: 1280, durationMs: 5000, sourceContainer: 'mp4', hdr: null, toneMap: null,
    }
  }
  async function storedUpload(productId: number) {
    const bytes = fakeMp4()
    const { upload: up } = await signVideoUpload({ productId, size: bytes.length, username: 'zp501-owner' })
    await storeVideoChunk(getVideoStorage(), up, 0, new Blob([new Uint8Array(bytes)]).stream())
    return up
  }
  const noop = () => {}
  const chunkExists = async (uploadId: string) => (await getVideoStorage().stat(`videos/uploads/${uploadId}/0.part`)) !== null

  test('a database error while taking the lock does not leave the instance busy (no 503 afterwards)', async () => {
    const p = await product()
    const failing = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === 'productVideo') throw new Error('database unavailable')
        return Reflect.get(target, prop, receiver)
      },
    })
    await assert.rejects(
      processVideoUpload({ db: failing, storage: getVideoStorage(), revalidate: noop, process: fakeProcess }, await storedUpload(p.id)),
      (e: any) => e.status === 500,
    )
    const ok = await processVideoUpload(
      { db: prisma, storage: getVideoStorage(), revalidate: noop, process: fakeProcess },
      await storedUpload(p.id),
    )
    assert.strictEqual(ok.status, 'READY')
  })

  test('removing the video while it processes: it is not brought back (409), first video and replacement', async () => {
    for (const withExisting of [false, true]) {
      const p = await product()
      const deps = { db: prisma, storage: getVideoStorage(), revalidate: noop }
      if (withExisting) await processVideoUpload({ ...deps, process: fakeProcess }, await storedUpload(p.id))
      const removingMidway = async (input: string, workDir: string) => {
        assert.strictEqual((await call(videoRoute.DELETE, 'DELETE', { id: String(p.id) })).status, 200)
        return fakeProcess(input, workDir)
      }
      await assert.rejects(
        processVideoUpload({ ...deps, process: removingMidway }, await storedUpload(p.id)),
        (e: any) => e.status === 409 && /removed or replaced while/.test(e.message),
      )
      assert.strictEqual(await prisma.productVideo.findUnique({ where: { productId: p.id } }), null, `withExisting=${withExisting}`)
    }
  })

  test('a second upload while one is processing (any instance) is 409 and keeps its chunks - replacements too; a stale lock is taken over', async () => {
    const p = await product()
    const deps = { db: prisma, storage: getVideoStorage(), revalidate: noop, process: fakeProcess }
    const first = await processVideoUpload(deps, await storedUpload(p.id))
    // Another instance is replacing it right now: READY stays (public video up), the lock is set.
    await prisma.productVideo.update({
      where: { productId: p.id },
      data: { uploadId: 'f'.repeat(32), uploadStartedAt: new Date() },
    })
    const state = await call(videoRoute.GET, 'GET', { id: String(p.id) })
    assert.strictEqual(state.json.video.status, 'READY')
    assert.strictEqual(state.json.video.processing, true)
    assert.strictEqual(state.json.video.url, first.url)

    const second = await storedUpload(p.id)
    await assert.rejects(processVideoUpload(deps, second), (e: any) => e.status === 409 && /already being processed/.test(e.message))
    assert.ok(await chunkExists(second.uploadId), 'chunks of the refused upload are kept for a retry')
    const row = await prisma.productVideo.findUniqueOrThrow({ where: { productId: p.id } })
    assert.strictEqual(row.status, 'READY')
    assert.strictEqual(row.uploadId, 'f'.repeat(32), 'the other upload keeps its lock')

    // The other instance died 11 minutes ago: its lock is stale, the retry wins.
    await prisma.productVideo.update({ where: { productId: p.id }, data: { uploadStartedAt: new Date(Date.now() - 11 * 60_000) } })
    const retried = await processVideoUpload(deps, second)
    assert.strictEqual(retried.status, 'READY')
    assert.strictEqual(retried.processing, false)
    assert.notStrictEqual(retried.url, first.url)
    assert.ok(!(await chunkExists(second.uploadId)), 'chunks deleted once processed')
  })

  // ─── Review fixes with real ffmpeg ─────────────────────────────────────────

  test('a WebM whose header claims 10 s but holds 40 s is refused after encoding', needsFfmpeg, async () => {
    const liar = makeClip('liar.webm', ['-f', 'lavfi', '-i', 'testsrc=duration=40:size=160x120:rate=10', '-c:v', 'libvpx-vp9', '-b:v', '50k', '-deadline', 'realtime'])
    const at = liar.indexOf(Buffer.from([0x44, 0x89, 0x88])) // Segment Info > Duration (float64, ms)
    assert.ok(at > 0)
    liar.writeDoubleBE(10_000, at + 3)
    const p = await product()
    const r = await call(videoRoute.POST, 'POST', { id: String(p.id) }, { body: { token: await upload(p.id, liar) } })
    assert.strictEqual(r.status, 400, JSON.stringify(r.json))
    assert.match(r.json.error, /longer than its file says \(10 s\)/)
  })

  test('input larger than 4K is refused', needsFfmpeg, async () => {
    const big = makeClip('big.mp4', ['-f', 'lavfi', '-i', 'color=c=red:size=4096x2160:duration=1:rate=5', '-c:v', 'libx264', '-preset', 'ultrafast'])
    const p = await product()
    const r = await call(videoRoute.POST, 'POST', { id: String(p.id) }, { body: { token: await upload(p.id, big) } })
    assert.strictEqual(r.status, 400)
    assert.match(r.json.error, /too large \(max 4K/)
  })

  test('HDR (10-bit HLG and PQ, e.g. iPhone) is tone-mapped to 8-bit SDR BT.709', needsFfmpeg, async () => {
    const hdrClip = (name: string, trc: string) =>
      makeClip(name, [
        '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=1080x1920:rate=30',
        '-vf', 'format=yuv420p10le', '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1',
        '-x265-params', `log-level=error:colorprim=bt2020:transfer=${trc}:colormatrix=bt2020nc`,
        '-color_primaries', 'bt2020', '-color_trc', trc, '-colorspace', 'bt2020nc',
      ])
    const hlg = hdrClip('hlg.mp4', 'arib-std-b67')
    const pq = hdrClip('pq.mp4', 'smpte2084')
    const input = ffprobeJson(path.join(TMP, 'hlg.mp4')).streams[0]
    assert.strictEqual(input.color_transfer, 'arib-std-b67')
    assert.strictEqual(input.pix_fmt, 'yuv420p10le')

    // Through the API (tone-map mode detected from this ffmpeg's filters).
    const p = await product()
    const r = await call(videoRoute.POST, 'POST', { id: String(p.id) }, { body: { token: await upload(p.id, hlg) } })
    assert.strictEqual(r.status, 200, JSON.stringify(r.json))
    const row = await prisma.productVideo.findUniqueOrThrow({ where: { productId: p.id } })
    const out = ffprobeJson((getVideoStorage() as any).pathFor(row.videoKey)).streams[0]
    assert.strictEqual(out.pix_fmt, 'yuv420p')
    assert.strictEqual(out.profile, 'High')
    assert.strictEqual(out.color_transfer, 'bt709')
    assert.strictEqual(out.color_primaries, 'bt709')
    assert.strictEqual(out.color_space, 'bt709')

    // Both tone-map paths directly, on PQ: zscale+tonemap, and the matrix fallback.
    const pqFile = path.join(TMP, 'pq.mp4')
    for (const toneMap of ['zscale', 'matrix'] as const) {
      const work = fs.mkdtempSync(path.join(process.env.GRACE_VIDEO_TMP_DIR!, 'hdr-'))
      try {
        const done = await processVideoFile(pqFile, work, { toneMap })
        assert.strictEqual(done.hdr, 'smpte2084')
        assert.strictEqual(done.toneMap, toneMap)
        const s = ffprobeJson(done.videoFile).streams[0]
        assert.strictEqual(s.pix_fmt, 'yuv420p', toneMap)
        assert.strictEqual(s.color_transfer, 'bt709', toneMap)
      } finally {
        fs.rmSync(work, { recursive: true, force: true })
      }
    }
    assert.ok(pq.length > 0)
  })
})
