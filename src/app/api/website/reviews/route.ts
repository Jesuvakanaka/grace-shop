// ZP-508: GET /api/website/reviews[?status=PENDING|APPROVED|HIDDEN] (OWNER only).
// The moderation queue, pending first. Deliberately no POST: the admin can
// never author a review (only customers, through a one-time link).
import { NextResponse, type NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { countPendingReviews, listOwnerReviews } from '@/lib/reviews/moderation'
import type { ReviewStatus } from '@/lib/reviews/rules'
import { badRequest, errorResponse } from '@/lib/website/http'

const STATUSES: readonly ReviewStatus[] = ['PENDING', 'APPROVED', 'HIDDEN']

export async function GET(request: NextRequest | Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const raw = new URL(request.url).searchParams.get('status')
  if (raw !== null && !(STATUSES as readonly string[]).includes(raw)) return badRequest('Unknown status.', 'status')
  try {
    const [reviews, pending] = await Promise.all([
      listOwnerReviews(prisma, { status: (raw as ReviewStatus | null) ?? undefined }),
      countPendingReviews(prisma),
    ])
    return NextResponse.json({ reviews, pending }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error, 'list reviews')
  }
}
