// ZP-505: the Insights report for the admin. OWNER only.
// GET ?range=today|7d|30d|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]          -> JSON (InsightsReport)
// GET ...&csv=overview|looks|photos|videos|funnel|depth|demand|sources|heatmap|health -> CSV download
// Reads rollups only; today (and yesterday before the nightly job) is rolled
// up live inside a rolled-back transaction (src/lib/insights/report.ts).
// Live answers are cached in memory for a minute so reloads and CSV
// downloads of the same range do not redo the work.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { analyticsDay } from '@/lib/analytics/events'
import { parseInsightsRange } from '@/lib/insights/range'
import { loadInsights } from '@/lib/insights/report'
import { isInsightsReportName, reportCsv } from '@/lib/insights/csv'
import type { InsightsReport } from '@/lib/insights/types'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const LIVE_CACHE_MS = 60_000
const LIVE_CACHE_MAX = 20
const liveCache = new Map<string, { at: number; report: InsightsReport }>()

async function getReport(range: Parameters<typeof loadInsights>[1], now: Date): Promise<InsightsReport> {
  const key = `${range.from}|${range.to}|${analyticsDay(now)}`
  const hit = liveCache.get(key)
  if (hit && now.getTime() - hit.at < LIVE_CACHE_MS) return hit.report
  const report = await loadInsights(prisma, range, { now })
  if (report.range.liveDays.length > 0) {
    if (liveCache.size >= LIVE_CACHE_MAX) liveCache.delete(liveCache.keys().next().value as string)
    liveCache.set(key, { at: now.getTime(), report })
  }
  return { ...report, range: { ...report.range, preset: range.preset } }
}

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
    const report = await getReport(parsed.range, now)
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
