// ZP-1119 (MM-14): results with what they mean (known, unknown, not available), the records behind them, and advice.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&campaignId= (default: the last 30 days, all shop). OWNER only (hub guard).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { parseRange } from '@/lib/marketing/results'
import { loadAdvice, loadTruth } from '@/lib/marketing/results-truth-db'
import { errorResponse, WebsiteError } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const q = new URL(request.url).searchParams
    const range = parseRange(q.get('from'), q.get('to'))
    const raw = q.get('campaignId')
    const campaignId = raw ? Number(raw) : null
    if (raw && (!Number.isInteger(campaignId) || (campaignId ?? 0) < 1)) throw new WebsiteError(400, 'Invalid campaign id.', { field: 'campaignId' })
    const [truth, advice] = await Promise.all([loadTruth(prisma, range, { campaignId }), campaignId ? Promise.resolve([]) : loadAdvice(prisma, range)])
    return NextResponse.json({ truth, advice })
  } catch (error) {
    return errorResponse(error, 'get results meaning')
  }
}
