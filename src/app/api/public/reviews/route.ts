// ZP-508: POST /api/public/reviews, the customer's review (no sign-in; the
// one-time link's token is the credential).
// Body (JSON only): { token, stars, shopStars?, comment, name, photo, photoConsent }
// 201 { ok: true, firstName } | 400 { error, errors } | 403 cross-site |
// 410 { error, reason: 'invalid' | 'expired' | 'used' } | 413 | 415 | 429.
// Guards: same-origin (Sec-Fetch-Site / Origin), JSON content type (no
// simple cross-site form posts), small body cap, per-IP token bucket, and the
// single-use claim is atomic (src/lib/reviews/invites.ts). The review is
// PENDING until the owner approves it; nothing is public before that.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { readReviewInvite, submitReview } from '@/lib/reviews/invites'
import { LINK_MESSAGES, validateReviewSubmission } from '@/lib/reviews/rules'
import { deletePhotoIfUnreferenced } from '@/lib/reviews/photos'
import { isSameOriginRequest } from '@/lib/reviews/same-origin'
import { getImageStorage } from '@/lib/storage/images'
import { TokenBucketLimiter, clientKey } from '@/lib/storefront/rate-limit'

export const dynamic = 'force-dynamic'

/** Room for a 1000-character comment in any script, plus the other fields. */
const MAX_BODY_BYTES = 16 * 1024
/** 10 attempts in a burst, then one every 30 s, per client address (per instance). */
const limiter = new TokenBucketLimiter({ capacity: 10, refillPerSecond: 1 / 30 })

const NO_STORE = { 'Cache-Control': 'no-store' }
const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } })

export async function POST(request: Request) {
  const limit = limiter.take(clientKey(request.headers))
  if (!limit.ok) return json({ error: 'Too many attempts. Please try again in a minute.' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) })
  if (!isSameOriginRequest(request.headers)) return json({ error: 'Forbidden' }, 403)
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'Expected JSON.' }, 415)
  }
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > MAX_BODY_BYTES) return json({ error: 'The review is too long.' }, 413)

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return json({ error: 'Could not read the review.' }, 400)
  }
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'The review is too long.' }, 413)
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Expected JSON.' }, 400)
  }
  const token = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).token : undefined

  try {
    const invite = await readReviewInvite(prisma, token)
    if (invite.state !== 'open') return json({ error: LINK_MESSAGES[invite.state], reason: invite.state }, 410)
    const valid = validateReviewSubmission(body, { shopOnly: invite.product === null, photoUploaded: invite.hasPhoto })
    if (!valid.ok) return json({ error: 'Please check the form.', errors: valid.errors }, 400)
    const result = await submitReview(prisma, token, valid.value)
    if (!result.ok) return json({ error: LINK_MESSAGES[result.state], reason: result.state }, 410)
    // A photo sent without consent (or removed before sending) is not kept.
    await deletePhotoIfUnreferenced(prisma, getImageStorage(), result.discardedPhotoKey)
    return json({ ok: true, firstName: valid.value.firstName }, 201)
  } catch (error) {
    console.error('[reviews] submit failed:', error instanceof Error ? error.message : error)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
}
