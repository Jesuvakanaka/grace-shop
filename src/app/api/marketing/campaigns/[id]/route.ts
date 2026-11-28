// ZP-1200: one campaign. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { archiveCampaign, getCampaign, updateCampaign } from '@/lib/marketing/campaigns'
import { badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid campaign id')
  try {
    const campaign = await getCampaign(prisma, id)
    return campaign ? NextResponse.json({ campaign }) : notFound('Campaign')
  } catch (error) {
    return errorResponse(error, 'get campaign')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid campaign id')
  try {
    return NextResponse.json({ campaign: await updateCampaign(prisma, id, await readJson(request), auth.session.username) })
  } catch (error) {
    return errorResponse(error, 'update campaign')
  }
}

/** DELETE archives the campaign (ZP-1124): nothing is removed, unsent posts are withdrawn. */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid campaign id')
  try {
    const campaign = await archiveCampaign(prisma, id, auth.session.username)
    return NextResponse.json({ ok: true, campaign })
  } catch (error) {
    return errorResponse(error, 'archive campaign')
  }
}
