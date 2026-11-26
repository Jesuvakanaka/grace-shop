// ZP-1200: who a broadcast was planned for and what happened to each. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid message id')
  try {
    const rows = await prisma.marketingBroadcastRecipient.findMany({
      where: { broadcastId: id }, orderBy: { id: 'asc' }, take: 500,
      select: { id: true, status: true, error: true, sentAt: true, contact: { select: { id: true, name: true, phone: true, email: true } } },
    })
    return NextResponse.json({ recipients: rows })
  } catch (error) {
    return errorResponse(error, 'list recipients')
  }
}
