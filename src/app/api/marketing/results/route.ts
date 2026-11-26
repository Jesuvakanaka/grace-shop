// ZP-1200: results per post, channel, campaign and product for a date range, plus ad spend. OWNER only.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: the last 30 days)
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { parseRange, resultsReport } from '@/lib/marketing/results'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const q = new URL(request.url).searchParams
    const range = parseRange(q.get('from'), q.get('to'))
    return NextResponse.json({ report: await resultsReport(prisma, range) })
  } catch (error) {
    return errorResponse(error, 'get marketing results')
  }
}
