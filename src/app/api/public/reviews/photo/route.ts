// ZP-508: the customer's optional photo of them wearing the piece (no
// sign-in; gated by an OPEN piece review link).
//
// POST   /api/public/reviews/photo   header X-Review-Token, multipart field "file"
//        200 { ok: true } (the storage key is never returned)
// DELETE /api/public/reviews/photo   header X-Review-Token -> 200 { ok: true }
//        (the customer removed it in the form; the file is deleted)
// Errors: 400 not a JPEG/PNG/WebP picture | 403 cross-site | 410 link not
// open | 411 no Content-Length | 413 too large | 429 rate limit or the
// per-link upload cap (REVIEW_PHOTO_MAX_UPLOADS).
//
// Order of checks (POST): rate limit, same-origin, Content-Length present
// and <= cap, then the token (header) and the link (open, piece, uploads
// left) — all BEFORE the body is read. Then the picture goes through the
// product photo pipeline: type sniffed from the bytes (JPEG/PNG/WebP only),
// re-encoded to WebP (max 1200px), ALL metadata (EXIF, GPS location)
// stripped. A replaced photo is deleted. The photo is public only once the
// review is APPROVED and the customer agreed (isPublicImageKey).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { clearInvitePhoto, readReviewInvite, setInvitePhoto } from '@/lib/reviews/invites'
import { deletePhotoIfUnreferenced } from '@/lib/reviews/photos'
import { LINK_MESSAGES, REVIEW_PHOTO_MAX_BYTES, REVIEW_PHOTO_MAX_UPLOADS, REVIEW_TOKEN_HEADER } from '@/lib/reviews/rules'
import { isSameOriginRequest } from '@/lib/reviews/same-origin'
import { getImageStorage, ImageRejectedError, saveProductImage, sniffImageType } from '@/lib/storage/images'
import { TokenBucketLimiter, clientKey } from '@/lib/storefront/rate-limit'

export const dynamic = 'force-dynamic'

const MULTIPART_HEADROOM = 64 * 1024
/** 6 requests in a burst, then one a minute, per client address (per instance). */
const limiter = new TokenBucketLimiter({ capacity: 6, refillPerSecond: 1 / 60 })

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

const TOO_LARGE = `The photo is too large (max ${REVIEW_PHOTO_MAX_BYTES / 1024 / 1024} MB).`
const LIMIT = `You can change the photo at most ${REVIEW_PHOTO_MAX_UPLOADS} times with this link.`
const NOT_A_PHOTO = 'Please choose a JPEG, PNG or WebP photo.'

function guard(request: Request): Response | null {
  const limit = limiter.take(clientKey(request.headers))
  if (!limit.ok) return json({ error: 'Too many uploads. Please try again in a minute.' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) })
  if (!isSameOriginRequest(request.headers)) return json({ error: 'Forbidden' }, 403)
  return null
}

export async function POST(request: Request) {
  const refused = guard(request)
  if (refused) return refused

  // Size first, from the header: nothing is read without a declared, small body.
  const declared = request.headers.get('content-length')
  if (declared === null || !/^\d+$/.test(declared)) return json({ error: 'Content-Length is required.' }, 411)
  if (Number(declared) > REVIEW_PHOTO_MAX_BYTES + MULTIPART_HEADROOM) return json({ error: TOO_LARGE }, 413)

  const token = request.headers.get(REVIEW_TOKEN_HEADER)
  try {
    // The link, before any body is read or decoded.
    const invite = await readReviewInvite(prisma, token)
    if (invite.state !== 'open') return json({ error: LINK_MESSAGES[invite.state], reason: invite.state }, 410)
    if (invite.product === null) return json({ error: 'A photo can only be added to a piece review.' }, 400)
    if (invite.photoUploadsLeft <= 0) return json({ error: LIMIT, reason: 'limit' }, 429)

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return json({ error: 'Expected a photo upload.' }, 400)
    }
    const file = form.get('file')
    if (!file || typeof file === 'string') return json({ error: 'No photo was chosen.' }, 400)
    if (file.size > REVIEW_PHOTO_MAX_BYTES) return json({ error: TOO_LARGE }, 413)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const type = sniffImageType(bytes)
    if (type !== 'image/jpeg' && type !== 'image/png' && type !== 'image/webp') return json({ error: NOT_A_PHOTO }, 400)

    const storage = getImageStorage()
    const image = await saveProductImage(bytes, storage)
    const change = await setInvitePhoto(prisma, token, image.key)
    if (!change.ok) {
      // Stored but not attached (link closed meanwhile or cap reached): don't keep it.
      await deletePhotoIfUnreferenced(prisma, storage, image.key)
      if (change.reason === 'limit') return json({ error: LIMIT, reason: 'limit' }, 429)
      if (change.reason === 'shop-only') return json({ error: 'A photo can only be added to a piece review.' }, 400)
      return json({ error: LINK_MESSAGES.used, reason: 'used' }, 410)
    }
    await deletePhotoIfUnreferenced(prisma, storage, change.previousKey)
    return json({ ok: true }, 200)
  } catch (error) {
    if (error instanceof ImageRejectedError) return json({ error: NOT_A_PHOTO }, 400)
    console.error('[reviews] photo upload failed:', error instanceof Error ? error.message : error)
    return json({ error: 'The photo could not be uploaded. Please try again.' }, 500)
  }
}

export async function DELETE(request: Request) {
  const refused = guard(request)
  if (refused) return refused
  try {
    const change = await clearInvitePhoto(prisma, request.headers.get(REVIEW_TOKEN_HEADER))
    if (!change.ok) return json({ error: LINK_MESSAGES.used, reason: 'closed' }, 410)
    await deletePhotoIfUnreferenced(prisma, getImageStorage(), change.previousKey)
    return json({ ok: true }, 200)
  } catch (error) {
    console.error('[reviews] photo remove failed:', error instanceof Error ? error.message : error)
    return json({ error: 'The photo could not be removed. Please try again.' }, 500)
  }
}
