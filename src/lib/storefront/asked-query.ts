// ZP-513: "X people asked about it this week", the query (no Next.js; the
// cached getter is ./asked.ts). Asked = distinct visits that tapped WhatsApp
// about the piece (whatsapp_enquire or restock_request) in the last 7
// analytics days: today and the 6 before, Harare days. One grouped query over
// the raw events for every piece at once, on the (day, type) index. Raw events
// are kept 90 days, so the week is always there and today's taps count at
// once (the daily rollups hold distinct visits per day, which do not add up
// over a week). Tested in tests/storefront-asked-db.test.ts.
import type { PrismaClient } from '@prisma/client'
import { addDays, analyticsDay } from '@/lib/analytics/events'

export const ASKED_DAYS = 7
const ASKED_TYPES = ['whatsapp_enquire', 'restock_request'] as const

type Db = Pick<PrismaClient, '$queryRawUnsafe'>

/** Distinct asking visits per piece slug over the last ASKED_DAYS analytics days. */
export async function countAskedBySlug(db: Db, now: Date = new Date()): Promise<Record<string, number>> {
  const today = analyticsDay(now)
  const from = addDays(today, -(ASKED_DAYS - 1))
  const rows = (await db.$queryRawUnsafe(
    `SELECT p.slug AS slug, COUNT(DISTINCT e."visitId")::int AS asked
       FROM "AnalyticsEvent" e
       JOIN "Product" p ON p.id = e."productId"
      WHERE e.day BETWEEN $1::date AND $2::date
        AND e.type IN ('${ASKED_TYPES.join("', '")}')
        AND p.slug IS NOT NULL
      GROUP BY p.slug`,
    from,
    today,
  )) as Array<{ slug: string; asked: number }>
  const out: Record<string, number> = {}
  for (const r of rows) out[r.slug] = r.asked
  return out
}
