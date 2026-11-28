// ZP-1118 (MM-13-AC5): record a refund for a sale, dated now. OWNER only (it pays money out of the till).
// A retry with the same requestKey returns the first refund (200) instead of a second one (201).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { recordRefund } from '@/lib/sale-refunds'
import { errorResponse, readJson, WebsiteError } from '@/lib/website/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  try {
    const id = Number((await params).id)
    if (!Number.isInteger(id) || id <= 0) throw new WebsiteError(404, 'Sale not found')
    const out = await recordRefund(prisma, id, await readJson(request), auth.session.username)
    return NextResponse.json(out, { status: out.duplicate ? 200 : 201 })
  } catch (error) {
    return errorResponse(error, 'record refund')
  }
}
