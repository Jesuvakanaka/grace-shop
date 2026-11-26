// ZP-1200: marketing campaigns. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { createCampaign, listCampaigns } from '@/lib/marketing/campaigns'
import { errorResponse, readJson } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ campaigns: await listCampaigns(prisma, new URL(request.url).searchParams.get('status')) })
  } catch (error) {
    return errorResponse(error, 'list campaigns')
  }
}

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ campaign: await createCampaign(prisma, await readJson(request), auth.session.username) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'create campaign')
  }
}
