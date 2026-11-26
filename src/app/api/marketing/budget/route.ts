// ZP-1200: this month's ad budget: cap, committed, remaining. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { budgetSummary } from '@/lib/marketing/budget'
import { marketingAuth } from '@/lib/marketing/guard'
import { getSettings } from '@/lib/marketing/settings'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ budget: await budgetSummary(prisma, await getSettings(prisma)) })
  } catch (error) {
    return errorResponse(error, 'get ad budget')
  }
}
