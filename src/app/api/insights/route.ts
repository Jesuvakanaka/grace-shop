// ZP-505: the Insights report for the admin. OWNER only. Never writes.
// GET ?range=today|7d|30d|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]          -> JSON (InsightsReport)
// GET ...&csv=overview|looks|photos|videos|funnel|depth|demand|sources|heatmap|health -> CSV download
// Past days come from the rollups; today (and yesterday before the nightly
// job) from read-only queries over raw events, cached per day for a minute
// (src/lib/insights/live.ts).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { parseInsightsRange } from '@/lib/insights/range'
import { loadInsights } from '@/lib/insights/report'
import { isInsightsReportName, reportCsv } from '@/lib/insights/csv'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export async function GET(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response

  const params = new URL(request.url).searchParams
  const now = new Date()
  const parsed = parseInsightsRange(params, now)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE })
  const csv = params.get('csv')
  if (csv !== null && !isInsightsReportName(csv)) {
    return NextResponse.json({ error: 'Unknown report' }, { status: 400, headers: NO_STORE })
  }

  try {
    const report = await loadInsights(prisma, parsed.range, { now })
    if (csv !== null && isInsightsReportName(csv)) {
      const file = `vyra-insights-${csv}-${report.range.from}-to-${report.range.to}.csv`
      return new NextResponse(reportCsv(report, csv), {
        status: 200,
        headers: {
          ...NO_STORE,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${file}"`,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    return NextResponse.json(report, { headers: NO_STORE })
  } catch (error) {
    console.error('[insights] report failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not load the insights. Try again in a minute.' }, { status: 500, headers: NO_STORE })
  }
}
