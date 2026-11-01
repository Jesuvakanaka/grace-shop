// ZP-508: GET /api/website/reviews/count (OWNER only) -> { pending }.
// The admin nav badge on "Website".
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { countPendingReviews } from '@/lib/reviews/moderation'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ pending: await countPendingReviews(prisma) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error, 'count reviews')
  }
}
