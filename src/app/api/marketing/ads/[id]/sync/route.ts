// ZP-1200: pull an ad's results from Meta into MarketingMetric. OWNER only. Read-only on Meta.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { syncAd } from '@/lib/marketing/ads'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid ad id')
  try {
    const actor = { username: auth.session.username, role: auth.session.role }
    return NextResponse.json({ ad: await syncAd(prisma, id, actor, { fetch: (u, i) => fetch(u, i) }) })
  } catch (error) {
    return errorResponse(error, 'sync ad')
  }
}
