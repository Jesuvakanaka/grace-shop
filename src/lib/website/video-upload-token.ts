// Video upload tokens (ZP-501). Server only.
//
// A video is uploaded in chunks (VIDEO_CHUNK_BYTES each) because the proxy
// buffers at most 10 MB of a request body and Cloud Run refuses HTTP/1
// requests above 32 MiB. Chunks may land on different instances, so they are
// stored in the video storage (videos/uploads/<uploadId>/<n>.part), and the
// upload's identity travels in this short-lived signed token instead of
// server memory: { productId, uploadId, size, username }. Every chunk and the
// final "process" call must present it, for the same product, by the same
// signed-in owner. Signed with the session secret; it is never a session
// (verifyToken needs userId/role) nor a preview token (purpose differs).
import { randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { getJwtSecret } from '@/lib/auth'
import { isValidUploadId } from '@/lib/storage/video-keys'
import { VIDEO_CHUNK_BYTES, VIDEO_MAX_UPLOAD_BYTES } from './video-validation'

export const VIDEO_UPLOAD_PURPOSE = 'video-upload'
/** One hour: enough for a slow phone connection. */
export const VIDEO_UPLOAD_TTL_SECONDS = 60 * 60

export type VideoUpload = { productId: number; uploadId: string; size: number; username: string; chunks: number }

const seconds = (d: Date) => Math.floor(d.getTime() / 1000)

export async function signVideoUpload(
  input: { productId: number; size: number; username: string },
  options: { now?: Date; uploadId?: string } = {},
): Promise<{ token: string; upload: VideoUpload; expiresAt: Date }> {
  const uploadId = options.uploadId ?? randomBytes(16).toString('hex')
  const now = options.now ?? new Date()
  const exp = seconds(now) + VIDEO_UPLOAD_TTL_SECONDS
  const token = await new SignJWT({
    purpose: VIDEO_UPLOAD_PURPOSE,
    productId: input.productId,
    uploadId,
    size: input.size,
    username: input.username,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(seconds(now))
    .setExpirationTime(exp)
    .sign(getJwtSecret())
  return {
    token,
    upload: { ...input, uploadId, chunks: Math.ceil(input.size / VIDEO_CHUNK_BYTES) },
    expiresAt: new Date(exp * 1000),
  }
}

/** The upload for a valid token issued for exactly this product and owner, else null. */
export async function verifyVideoUpload(
  token: string | null | undefined,
  expected: { productId: number; username: string },
  options: { now?: Date } = {},
): Promise<VideoUpload | null> {
  if (typeof token !== 'string' || token === '' || token.length > 2048) return null
  const key = getJwtSecret()
  try {
    const { payload: p } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat'],
      currentDate: options.now,
    })
    if (p.purpose !== VIDEO_UPLOAD_PURPOSE) return null
    if (p.productId !== expected.productId || p.username !== expected.username) return null
    if (!isValidUploadId(p.uploadId)) return null
    const size = p.size
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > VIDEO_MAX_UPLOAD_BYTES) return null
    return {
      productId: expected.productId,
      username: expected.username,
      uploadId: p.uploadId,
      size,
      chunks: Math.ceil(size / VIDEO_CHUNK_BYTES),
    }
  } catch {
    return null
  }
}
