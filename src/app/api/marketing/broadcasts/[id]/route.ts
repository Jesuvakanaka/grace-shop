// ZP-1200: one broadcast with its audience count and the reasons a send is blocked. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getBroadcastDetail, updateBroadcast } from '@/lib/marketing/broadcasts'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid message id')
  try {
    return NextResponse.json(await getBroadcastDetail(prisma, id))
  } catch (error) {
    return errorResponse(error, 'get broadcast')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid message id')
  try {
    return NextResponse.json({ broadcast: await updateBroadcast(prisma, id, await readJson(request), { username: auth.session.username, role: auth.session.role }) })
  } catch (error) {
    return errorResponse(error, 'update broadcast')
  }
}
