// ZP-508: one review (OWNER only).
// PATCH { action: 'approve' } | { action: 'hide', note? } | { action: 'unpublish' }
//       | { action: 'reply', reply }   -> 200 the updated review
// DELETE                                -> 200 { ok: true }
// Every change expires the storefront's review entry (`storefront:reviews`),
// so aggregates and lists update at once. No PUT/POST: stars, comment and
// name can never be changed by the admin.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { deleteReview, moderateReview } from '@/lib/reviews/moderation'
import { deletePhotoIfUnreferenced } from '@/lib/reviews/photos'
import { getImageStorage } from '@/lib/storage/images'
import { parseModerationAction } from '@/lib/reviews/rules'
import { badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'
import { revalidateStorefront } from '@/lib/website/revalidate'

type Ctx = { params: Promise<{ id: string }> }

function parseId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseId((await params).id)
  if (id === null) return notFound('Review')
  const action = parseModerationAction(await readJson(request))
  if (!action.ok) return badRequest(action.error)
  try {
    const review = await moderateReview(prisma, id, action.value, auth.session.username)
    if (!review) return notFound('Review')
    revalidateStorefront({ reviews: true })
    return NextResponse.json(review, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error, 'moderate review')
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseId((await params).id)
  if (id === null) return notFound('Review')
  try {
    const deleted = await deleteReview(prisma, id)
    if (!deleted) return notFound('Review')
    revalidateStorefront({ reviews: true })
    // The customer's photo goes too, unless the same picture is used elsewhere.
    await deletePhotoIfUnreferenced(prisma, getImageStorage(), deleted.photoKey)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'delete review')
  }
}
