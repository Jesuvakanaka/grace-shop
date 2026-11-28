// ZP-1118 (MM-13): the sales report from the existing ledger: all shop, per campaign, per channel, uncredited.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (Harare days). OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { marketingSalesReport } from '@/lib/marketing/sale-attribution'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const q = new URL(request.url).searchParams
    return NextResponse.json({ report: await marketingSalesReport(prisma, { from: q.get('from') ?? '', to: q.get('to') ?? '' }) })
  } catch (error) {
    return errorResponse(error, 'marketing sales report')
  }
}
