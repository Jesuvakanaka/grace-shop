// ZP-1200: partners (influencers, resellers, ambassadors) with their results. OWNER only. The hub pays nothing.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { createPartner, listPartners } from '@/lib/marketing/partners'
import { errorResponse, readJson } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const days = Number(new URL(request.url).searchParams.get('days'))
    return NextResponse.json({ partners: await listPartners(prisma, Number.isInteger(days) && days > 0 && days <= 365 ? days : 30) })
  } catch (error) {
    return errorResponse(error, 'list partners')
  }
}

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ partner: await createPartner(prisma, await readJson(request), auth.session.username) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'create partner')
  }
}
