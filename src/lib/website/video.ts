// Product video: upload, processing and removal for the admin (ZP-501). Server only.
//
// Flow (OWNER only, from the product's Website panel):
//   1. POST   /api/website/products/:id/video/uploads        { size } -> { token, chunkSize, chunks }
//   2. PUT    /api/website/products/:id/video/chunks/:index  raw bytes (<= 8 MiB), header X-Upload-Token
//   3. POST   /api/website/products/:id/video                { token } -> processes, returns the video
//   DELETE    /api/website/products/:id/video                removes it
// Processing is synchronous in step 3 (a 30 s clip takes seconds; see
// docs/storefront/videos.md for numbers). A first video is PROCESSING while
// it runs; a replacement leaves the current READY video live until the new
// one is stored, so the public site never shows a gap. A failed first video
// is FAILED with the reason; a failed replacement leaves the old video.
// Publishing rules are unchanged: a video is optional, a photo is required.
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { PrismaClient } from '@prisma/client'
import {
  POSTER_CONTENT_TYPE,
  VIDEO_CONTENT_TYPE,
  VIDEO_PREFIX,
  privateVideoUrl,
  uploadChunkKey,
} from '@/lib/storage/video-keys'
import type { VideoStorage } from '@/lib/storage/videos'
import { WebsiteError } from './http'
import type { RevalidateScope } from './revalidate'
import {
  makeWorkDir,
  processVideoFile,
  removeWorkDir,
  VideoRejectedError,
  type ProcessDeps,
  type ProcessedVideo,
} from './video-process'
import type { VideoUpload } from './video-upload-token'
import { expectedChunkBytes, sniffVideoContainer, VIDEO_REFUSALS } from './video-validation'

/** A PROCESSING row older than this is shown as failed (the instance stopped mid-way). */
export const VIDEO_PROCESSING_STALE_MS = 10 * 60 * 1000
export const STALE_PROCESSING_ERROR = 'Processing did not finish. Please upload the video again.'
export const GENERIC_PROCESSING_ERROR = 'The video could not be processed. Please try again.'

export type AdminVideoStatus = 'PROCESSING' | 'READY' | 'FAILED'

/** What the Website panel shows. Signed-in URLs only (the owner may preview before publishing). */
export type AdminVideo = {
  status: AdminVideoStatus
  url: string | null
  posterUrl: string | null
  width: number | null
  height: number | null
  durationMs: number | null
  sizeBytes: number | null
  error: string | null
  updatedAt: string
}

type VideoRow = {
  status: AdminVideoStatus
  videoKey: string | null
  posterKey: string | null
  width: number | null
  height: number | null
  durationMs: number | null
  sizeBytes: number | null
  error: string | null
  updatedAt: Date
}

const safeUrl = (key: string | null) => {
  try {
    return key ? privateVideoUrl(key) : null
  } catch {
    return null
  }
}

export function toAdminVideo(row: VideoRow | null, now = new Date()): AdminVideo | null {
  if (!row) return null
  const stale = row.status === 'PROCESSING' && now.getTime() - row.updatedAt.getTime() > VIDEO_PROCESSING_STALE_MS
  const ready = row.status === 'READY'
  return {
    status: stale ? 'FAILED' : row.status,
    url: ready ? safeUrl(row.videoKey) : null,
    posterUrl: ready ? safeUrl(row.posterKey) : null,
    width: ready ? row.width : null,
    height: ready ? row.height : null,
    durationMs: ready ? row.durationMs : null,
    sizeBytes: ready ? row.sizeBytes : null,
    error: stale ? STALE_PROCESSING_ERROR : row.status === 'FAILED' ? row.error : null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getAdminVideo(db: PrismaClient, productId: number, now = new Date()): Promise<AdminVideo | null> {
  return toAdminVideo(await db.productVideo.findUnique({ where: { productId } }), now)
}

async function requireProduct(db: PrismaClient, productId: number): Promise<{ slug: string | null }> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { slug: true } })
  if (!product) throw new WebsiteError(404, 'Product not found')
  return product
}

export { requireProduct as requireVideoProduct }

/**
 * Read one chunk body with a hard byte cap (never buffers more than the
 * expected chunk size + one network read), check its length and, for the
 * first chunk, that the bytes are a supported video container.
 */
export async function storeVideoChunk(
  storage: VideoStorage,
  upload: VideoUpload,
  index: number,
  body: ReadableStream<Uint8Array> | null,
): Promise<{ received: number }> {
  const expected = expectedChunkBytes(upload.size, index)
  if (!body || expected === 0) throw new WebsiteError(400, 'Missing video data.')
  const parts: Uint8Array[] = []
  let received = 0
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      if (received > expected) {
        await reader.cancel().catch(() => {})
        throw new WebsiteError(413, VIDEO_REFUSALS.tooLarge)
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (received !== expected) {
    throw new WebsiteError(400, `This part of the video is incomplete (${received} of ${expected} bytes). Please try again.`)
  }
  const bytes = Buffer.concat(parts)
  if (index === 0 && !sniffVideoContainer(bytes.subarray(0, 256))) {
    throw new WebsiteError(400, VIDEO_REFUSALS.notVideo)
  }
  await storage.putBytes(uploadChunkKey(upload.uploadId, index), bytes, 'application/octet-stream')
  return { received }
}

async function removeChunks(storage: VideoStorage, upload: VideoUpload) {
  await Promise.all(
    Array.from({ length: upload.chunks }, (_, i) =>
      storage.remove(uploadChunkKey(upload.uploadId, i)).catch(() => {}),
    ),
  )
}

/** Concatenate the stored chunks into one local file, checking every size and the total cap. */
async function assemble(storage: VideoStorage, upload: VideoUpload, target: string) {
  for (let i = 0; i < upload.chunks; i++) {
    const size = await storage.size(uploadChunkKey(upload.uploadId, i))
    if (size !== expectedChunkBytes(upload.size, i)) {
      throw new WebsiteError(400, 'The upload is incomplete. Please upload the video again.')
    }
  }
  const out = createWriteStream(target, { flags: 'wx' })
  let total = 0
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      total += chunk.length
      if (total > upload.size) done(new WebsiteError(413, VIDEO_REFUSALS.tooLarge))
      else done(null, chunk)
    },
  })
  // One pass through a single capped transform into the file.
  const source = (async function* () {
    for (let i = 0; i < upload.chunks; i++) {
      const stream = await storage.read(uploadChunkKey(upload.uploadId, i))
      if (!stream) throw new WebsiteError(400, 'The upload is incomplete. Please upload the video again.')
      for await (const chunk of stream) yield chunk as Buffer
    }
  })()
  await pipeline(source, cap, out)
  if (total !== upload.size) throw new WebsiteError(400, 'The upload is incomplete. Please upload the video again.')
}

/** One video at a time per server instance (CPU and memory: see docs/storefront/videos.md). */
let busy = false

export type ProcessUploadDeps = {
  db: PrismaClient
  storage: VideoStorage
  revalidate: (scope: RevalidateScope) => unknown
  process?: (inputFile: string, workDir: string) => Promise<ProcessedVideo>
  processDeps?: ProcessDeps
  tempRoot?: string
  now?: () => Date
}

/**
 * Assemble, validate, transcode and store an uploaded video, then make it
 * the product's video. Throws WebsiteError (400 refusals with the reason,
 * 404, 409, 503) or an unexpected error (500).
 */
export async function processVideoUpload(deps: ProcessUploadDeps, upload: VideoUpload): Promise<AdminVideo> {
  const { db, storage } = deps
  const product = await requireProduct(db, upload.productId)
  if (busy) throw new WebsiteError(503, 'Another video is being processed. Please try again in a minute.')
  busy = true
  const now = deps.now ?? (() => new Date())
  let workDir: string | null = null
  const existing = await db.productVideo.findUnique({ where: { productId: upload.productId } })
  const replacing = existing?.status === 'READY'
  try {
    if (existing?.status === 'PROCESSING' && now().getTime() - existing.updatedAt.getTime() <= VIDEO_PROCESSING_STALE_MS) {
      throw new WebsiteError(409, 'A video for this product is already being processed.')
    }
    if (!replacing) {
      await db.productVideo.upsert({
        where: { productId: upload.productId },
        create: { productId: upload.productId, status: 'PROCESSING', createdBy: upload.username },
        update: { status: 'PROCESSING', error: null, videoKey: null, posterKey: null, createdBy: upload.username },
      })
    }

    workDir = await makeWorkDir(deps.tempRoot)
    const input = path.join(workDir, 'input.bin')
    await assemble(storage, upload, input)
    const processed = await (deps.process ?? ((i, w) => processVideoFile(i, w, deps.processDeps)))(input, workDir)

    const videoKey = `${VIDEO_PREFIX}${processed.videoHash}.mp4`
    const posterKey = `${VIDEO_PREFIX}${processed.posterHash}.webp`
    await storage.putFile(videoKey, processed.videoFile, VIDEO_CONTENT_TYPE)
    await storage.putBytes(posterKey, processed.poster, POSTER_CONTENT_TYPE)

    const row = await db.productVideo.upsert({
      where: { productId: upload.productId },
      create: {
        productId: upload.productId,
        status: 'READY',
        videoKey,
        posterKey,
        width: processed.width,
        height: processed.height,
        durationMs: processed.durationMs,
        sizeBytes: processed.videoBytes,
        createdBy: upload.username,
      },
      update: {
        status: 'READY',
        videoKey,
        posterKey,
        width: processed.width,
        height: processed.height,
        durationMs: processed.durationMs,
        sizeBytes: processed.videoBytes,
        error: null,
        createdBy: upload.username,
      },
    })
    deps.revalidate({ productSlugs: [product.slug] })
    return toAdminVideo(row, now())!
  } catch (error) {
    const known = error instanceof VideoRejectedError || error instanceof WebsiteError
    const message = known ? error.message : GENERIC_PROCESSING_ERROR
    const alreadyRunning = error instanceof WebsiteError && error.status === 409
    if (!replacing && !alreadyRunning) {
      await db.productVideo
        .update({ where: { productId: upload.productId }, data: { status: 'FAILED', error: message } })
        .catch(() => {})
    }
    if (error instanceof VideoRejectedError) throw new WebsiteError(400, error.message)
    if (error instanceof WebsiteError) throw error
    console.error('[website] video processing failed:', error instanceof Error ? error.message : error)
    throw new WebsiteError(500, GENERIC_PROCESSING_ERROR)
  } finally {
    busy = false
    if (workDir) await removeWorkDir(workDir).catch(() => {})
    await removeChunks(storage, upload)
  }
}

/** Remove the product's video (the stored objects stay; they are no longer served publicly). */
export async function removeProductVideo(
  db: PrismaClient,
  productId: number,
  revalidate: (scope: RevalidateScope) => unknown,
): Promise<{ removed: boolean }> {
  const product = await requireProduct(db, productId)
  const { count } = await db.productVideo.deleteMany({ where: { productId } })
  if (count > 0) revalidate({ productSlugs: [product.slug] })
  return { removed: count > 0 }
}
