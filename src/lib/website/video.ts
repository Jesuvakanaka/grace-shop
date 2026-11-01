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
  /** An upload is being processed right now (first video or replacement). */
  processing: boolean
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
  uploadId: string | null
  uploadStartedAt: Date | null
  updatedAt: Date
}

const lockFresh = (row: Pick<VideoRow, 'uploadId' | 'uploadStartedAt'>, now: Date) =>
  row.uploadId !== null &&
  row.uploadStartedAt !== null &&
  now.getTime() - row.uploadStartedAt.getTime() <= VIDEO_PROCESSING_STALE_MS

const safeUrl = (key: string | null) => {
  try {
    return key ? privateVideoUrl(key) : null
  } catch {
    return null
  }
}

export function toAdminVideo(row: VideoRow | null, now = new Date()): AdminVideo | null {
  if (!row) return null
  const stale = row.status === 'PROCESSING' && !lockFresh(row, now)
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
    processing: lockFresh(row, now),
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
    const stat = await storage.stat(uploadChunkKey(upload.uploadId, i))
    if (stat?.size !== expectedChunkBytes(upload.size, i)) {
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
export const ALREADY_PROCESSING_ERROR = 'A video for this product is already being processed. Please wait for it to finish.'
export const REMOVED_WHILE_PROCESSING_ERROR =
  'The video was removed or replaced while this one was processing, so it was not saved.'

/**
 * Take the processing lock for this upload (any instance; atomic). A first
 * video becomes PROCESSING; a replacement keeps its READY status and keys so
 * the public video stays up. Returns whether this is a replacement. Throws
 * 409 while another upload holds a fresh lock.
 */
async function acquireLock(db: PrismaClient, upload: VideoUpload, now: Date): Promise<{ replacing: boolean }> {
  const where = { productId: upload.productId }
  const existing = await db.productVideo.findUnique({ where })
  const lock = { uploadId: upload.uploadId, uploadStartedAt: now, createdBy: upload.username }
  if (!existing) {
    try {
      await db.productVideo.create({ data: { productId: upload.productId, status: 'PROCESSING', ...lock } })
      return { replacing: false }
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2002') throw new WebsiteError(409, ALREADY_PROCESSING_ERROR)
      throw error
    }
  }
  const replacing = existing.status === 'READY'
  const { count } = await db.productVideo.updateMany({
    where: {
      ...where,
      OR: [{ uploadId: null }, { uploadStartedAt: null }, { uploadStartedAt: { lt: new Date(now.getTime() - VIDEO_PROCESSING_STALE_MS) } }],
    },
    data: replacing ? lock : { ...lock, status: 'PROCESSING', error: null, videoKey: null, posterKey: null },
  })
  if (count === 0) throw new WebsiteError(409, ALREADY_PROCESSING_ERROR)
  return { replacing }
}

export async function processVideoUpload(deps: ProcessUploadDeps, upload: VideoUpload): Promise<AdminVideo> {
  const { db, storage } = deps
  const product = await requireProduct(db, upload.productId)
  if (busy) throw new WebsiteError(503, 'Another video is being processed. Please try again in a minute.')
  const now = deps.now ?? (() => new Date())
  const mine = { productId: upload.productId, uploadId: upload.uploadId }
  let workDir: string | null = null
  let locked = false
  let replacing = false
  // 409 (someone else is processing) and 503 (this instance is busy): the
  // owner can retry with the same upload, so its chunks are kept.
  let keepChunks = false
  busy = true
  try {
    ;({ replacing } = await acquireLock(db, upload, now()))
    locked = true

    workDir = await makeWorkDir(deps.tempRoot)
    const input = path.join(workDir, 'input.bin')
    await assemble(storage, upload, input)
    const processed = await (deps.process ?? ((i, w) => processVideoFile(i, w, deps.processDeps)))(input, workDir)

    const videoKey = `${VIDEO_PREFIX}${processed.videoHash}.mp4`
    const posterKey = `${VIDEO_PREFIX}${processed.posterHash}.webp`
    await storage.putFile(videoKey, processed.videoFile, VIDEO_CONTENT_TYPE)
    await storage.putBytes(posterKey, processed.poster, POSTER_CONTENT_TYPE)

    // Only if this upload still holds the lock: a video removed (row deleted)
    // or taken over meanwhile is never brought back.
    const { count } = await db.productVideo.updateMany({
      where: mine,
      data: {
        status: 'READY',
        videoKey,
        posterKey,
        width: processed.width,
        height: processed.height,
        durationMs: processed.durationMs,
        sizeBytes: processed.videoBytes,
        error: null,
        createdBy: upload.username,
        uploadId: null,
        uploadStartedAt: null,
      },
    })
    locked = false
    if (count === 0) throw new WebsiteError(409, REMOVED_WHILE_PROCESSING_ERROR)
    deps.revalidate({ productSlugs: [product.slug] })
    return toAdminVideo(await db.productVideo.findUniqueOrThrow({ where: { productId: upload.productId } }), now())!
  } catch (error) {
    const known = error instanceof VideoRejectedError || error instanceof WebsiteError
    const message = known ? error.message : GENERIC_PROCESSING_ERROR
    if (error instanceof WebsiteError && error.status === 409 && error.message === ALREADY_PROCESSING_ERROR) keepChunks = true
    if (locked) {
      // Release the lock; a first video becomes FAILED with the reason, a
      // replacement leaves the current READY video exactly as it was.
      await db.productVideo
        .updateMany({
          where: mine,
          data: replacing
            ? { uploadId: null, uploadStartedAt: null }
            : { status: 'FAILED', error: message, uploadId: null, uploadStartedAt: null },
        })
        .catch(() => {})
    }
    if (error instanceof VideoRejectedError) throw new WebsiteError(400, error.message)
    if (error instanceof WebsiteError) throw error
    console.error('[website] video processing failed:', error instanceof Error ? error.message : error)
    throw new WebsiteError(500, GENERIC_PROCESSING_ERROR)
  } finally {
    busy = false
    if (workDir) await removeWorkDir(workDir).catch(() => {})
    if (!keepChunks) await removeChunks(storage, upload)
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
