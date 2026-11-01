// ZP-508: POST /api/public/reviews/photo, the customer's optional photo of
// them wearing the piece (no sign-in; gated by an OPEN piece review link).
// multipart/form-data: token, file. 200 { ok: true } (the storage key is
// never returned) | 400 not a picture | 403 cross-site | 410 link not open
// | 413 too large | 429.
// The picture goes through the product photo pipeline: type sniffed from the
// bytes, re-encoded to WebP (max 1200px), ALL metadata (EXIF, GPS location)
// stripped. It is parked on the invite and only attached when the review is
// sent; it is public only once the review is APPROVED and the customer
// agreed (src/lib/storefront/queries.ts isPublicImageKey).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { readReviewInvite, setInvitePhoto } from '@/lib/reviews/invites'
import { LINK_MESSAGES, REVIEW_PHOTO_MAX_BYTES } from '@/lib/reviews/rules'
import { isSameOriginRequest } from '@/lib/reviews/same-origin'
import { ImageRejectedError, saveProductImage } from '@/lib/storage/images'
import { TokenBucketLimiter, clientKey } from '@/lib/storefront/rate-limit'

export const dynamic = 'force-dynamic'

const MULTIPART_HEADROOM = 64 * 1024
/** 6 uploads in a burst, then one a minute, per client address (per instance). */
const limiter = new TokenBucketLimiter({ capacity: 6, refillPerSecond: 1 / 60 })

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

const TOO_LARGE = `The photo is too large (max ${REVIEW_PHOTO_MAX_BYTES / 1024 / 1024} MB).`

export async function POST(request: Request) {
  const limit = limiter.take(clientKey(request.headers))
  if (!limit.ok) return json({ error: 'Too many uploads. Please try again in a minute.' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) })
  if (!isSameOriginRequest(request.headers)) return json({ error: 'Forbidden' }, 403)
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > REVIEW_PHOTO_MAX_BYTES + MULTIPART_HEADROOM) return json({ error: TOO_LARGE }, 413)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'Expected a photo upload.' }, 400)
  }
  const token = form.get('token')
  const file = form.get('file')
  if (!file || typeof file === 'string') return json({ error: 'No photo was chosen.' }, 400)
  if (file.size > REVIEW_PHOTO_MAX_BYTES) return json({ error: TOO_LARGE }, 413)

  try {
    // The link first: no decoding work for a bad, used or shop-only link.
    const invite = await readReviewInvite(prisma, token)
    if (invite.state !== 'open') return json({ error: LINK_MESSAGES[invite.state], reason: invite.state }, 410)
    if (invite.product === null) return json({ error: 'A photo can only be added to a piece review.' }, 400)

    const image = await saveProductImage(new Uint8Array(await file.arrayBuffer()))
    if (!(await setInvitePhoto(prisma, token, image.key))) {
      return json({ error: LINK_MESSAGES.used, reason: 'used' }, 410)
    }
    return json({ ok: true }, 200)
  } catch (error) {
    if (error instanceof ImageRejectedError) return json({ error: 'Please choose a JPEG, PNG or WebP photo.' }, 400)
    console.error('[reviews] photo upload failed:', error instanceof Error ? error.message : error)
    return json({ error: 'The photo could not be uploaded. Please try again.' }, 500)
  }
}
