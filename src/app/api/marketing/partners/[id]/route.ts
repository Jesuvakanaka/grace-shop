// ZP-1200: one partner with results. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { getPartner, updatePartner } from '@/lib/marketing/partners'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid partner id')
  try {
    return NextResponse.json({ partner: await getPartner(prisma, id) })
  } catch (error) {
    return errorResponse(error, 'get partner')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid partner id')
  try {
    return NextResponse.json({ partner: await updatePartner(prisma, id, await readJson(request), auth.session.username) })
  } catch (error) {
    return errorResponse(error, 'update partner')
  }
}
