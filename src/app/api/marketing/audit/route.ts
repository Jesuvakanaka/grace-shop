// ZP-1200: recent marketing audit rows. OWNER only. GET ?limit=&entity=
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { recentAudit } from '@/lib/marketing/audit'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const q = new URL(request.url).searchParams
  try {
    return NextResponse.json({ entries: await recentAudit(prisma, Number(q.get('limit') ?? 50), q.get('entity') ?? undefined) })
  } catch (error) {
    return errorResponse(error, 'list marketing audit')
  }
}
