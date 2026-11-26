// ZP-1200: one Meta ad. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { deleteAd, getAd, updateAd } from '@/lib/marketing/ads'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid ad id')
  try {
    const ad = await getAd(prisma, id)
    return ad ? NextResponse.json({ ad }) : notFound('Ad')
  } catch (error) {
    return errorResponse(error, 'get ad')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid ad id')
  try {
    const actor = { username: auth.session.username, role: auth.session.role }
    return NextResponse.json({ ad: await updateAd(prisma, id, await readJson(request), actor, { host: request.headers.get('host') }) })
  } catch (error) {
    return errorResponse(error, 'update ad')
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid ad id')
  try {
    await deleteAd(prisma, id, auth.session.username)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'delete ad')
  }
}
