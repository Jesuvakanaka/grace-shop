// ZP-1200: pull the latest results (analytics visits and enquiries, platform insights, ad insights) into MarketingMetric.
// OWNER only. Read-only on the platforms.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { syncAllResults } from '@/lib/marketing/results'
import { errorResponse } from '@/lib/website/http'

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const actor = { username: auth.session.username, role: auth.session.role }
    return NextResponse.json({ summary: await syncAllResults(prisma, actor, { fetch: (u, i) => fetch(u, i) }) })
  } catch (error) {
    return errorResponse(error, 'sync marketing results')
  }
}
