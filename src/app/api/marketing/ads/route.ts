// ZP-1200: Meta ads. OWNER only. GET ?status=&campaignId=
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createAd, listAds } from '@/lib/marketing/ads'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { AD_STATUSES } from '@/lib/marketing/ad-state'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const q = new URL(request.url).searchParams
    const status = q.get('status')
    if (status && !(AD_STATUSES as readonly string[]).includes(status)) return badRequest('Unknown status.', 'status')
    const campaignId = q.get('campaignId') ? Number(q.get('campaignId')) : null
    if (campaignId !== null && (!Number.isInteger(campaignId) || campaignId < 1)) return badRequest('Invalid campaignId.', 'campaignId')
    return NextResponse.json({ ads: await listAds(prisma, { status, campaignId }) })
  } catch (error) {
    return errorResponse(error, 'list ads')
  }
}

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const ad = await createAd(prisma, await readJson(request), auth.session.username, { host: request.headers.get('host') })
    return NextResponse.json({ ad }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'create ad')
  }
}
