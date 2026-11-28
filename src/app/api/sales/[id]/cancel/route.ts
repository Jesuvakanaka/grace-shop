// ZP-1118 (MM-13-AC5): cancel a sale nothing was collected for. The row stays, marked cancelled. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { cancelSale } from '@/lib/sale-refunds'
import { errorResponse, readJson, WebsiteError } from '@/lib/website/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  try {
    const id = Number((await params).id)
    if (!Number.isInteger(id) || id <= 0) throw new WebsiteError(404, 'Sale not found')
    const body = await readJson(request)
    const reason = typeof body === 'object' && body !== null ? (body as { reason?: unknown }).reason : undefined
    return NextResponse.json({ sale: await cancelSale(prisma, id, reason, auth.session.username) })
  } catch (error) {
    return errorResponse(error, 'cancel sale')
  }
}
