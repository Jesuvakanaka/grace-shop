// ZP-1200: the weekly advice. OWNER only. GET ?status=NEW|DONE|DISMISSED&week=YYYY-MM-DD (a Monday)
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { listRecommendations, RECOMMENDATION_STATUSES } from '@/lib/marketing/ai/recommend'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const q = new URL(request.url).searchParams
    const status = q.get('status')
    if (status && !(RECOMMENDATION_STATUSES as readonly string[]).includes(status)) return badRequest('Unknown status.', 'status')
    const week = q.get('week')
    let weekOf: Date | null = null
    if (week) {
      weekOf = new Date(`${week}T00:00:00.000Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || Number.isNaN(weekOf.getTime()) || weekOf.toISOString().slice(0, 10) !== week) return badRequest('week is not a date (use YYYY-MM-DD).', 'week')
    }
    return NextResponse.json({ recommendations: await listRecommendations(prisma, { status, weekOf }) })
  } catch (error) {
    return errorResponse(error, 'list recommendations')
  }
}
