// ZP-1200: one ad audience. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { deleteAudience, getAudience, updateAudience } from '@/lib/marketing/audiences'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid audience id')
  try {
    const audience = await getAudience(prisma, id)
    return audience ? NextResponse.json({ audience }) : notFound('Audience')
  } catch (error) {
    return errorResponse(error, 'get audience')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid audience id')
  try {
    return NextResponse.json({ audience: await updateAudience(prisma, id, await readJson(request), auth.session.username) })
  } catch (error) {
    return errorResponse(error, 'update audience')
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid audience id')
  try {
    await deleteAudience(prisma, id, auth.session.username)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'delete audience')
  }
}
