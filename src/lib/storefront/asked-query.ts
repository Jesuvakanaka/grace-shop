// ZP-513: "X people asked about it this week", the query (no Next.js; the
// cached getter is ./asked.ts). Asked = distinct visits that tapped WhatsApp
// about the piece (whatsapp_enquire or restock_request) in the last 7
// analytics days: today and the 6 before, Harare days. One grouped query over
// the raw events for every piece at once, on the (day, type) index. Raw events
// are kept 90 days, so the week is always there and today's taps count at
// once (the daily rollups hold distinct visits per day, which do not add up
// over a week). Review: a visit counts only when it also has a look_view or
// details_sheet_open for that piece in the window, once per visit. Residual
// risk: anyone can still script a visit that sends a view and then an
// enquiry (the endpoint is anonymous and rate-limited per IP / visit, not
// authenticated); the number is a nicety, shown only from 3, never money.
// Tested in tests/storefront-asked-db.test.ts.
import type { PrismaClient } from '@prisma/client'
import { addDays, analyticsDay } from '@/lib/analytics/events'

export const ASKED_DAYS = 7
const ASKED_TYPES = ['whatsapp_enquire', 'restock_request'] as const
/** A visit counts only when it was also shown the piece in the window (review). */
const SEEN_TYPES = ['look_view', 'details_sheet_open'] as const

type Db = Pick<PrismaClient, '$queryRawUnsafe'>

/** Distinct asking visits per piece slug over the last ASKED_DAYS analytics days. */
export async function countAskedBySlug(db: Db, now: Date = new Date()): Promise<Record<string, number>> {
  const today = analyticsDay(now)
  const from = addDays(today, -(ASKED_DAYS - 1))
  // Review: only visits that were also shown the piece (its look or its sheet)
  // in the window count, once each; a bare POST of enquiry events never does.
  const rows = (await db.$queryRawUnsafe(
    `WITH asked AS (
       SELECT DISTINCT "productId", "visitId" FROM "AnalyticsEvent"
        WHERE day BETWEEN $1::date AND $2::date AND type IN ('${ASKED_TYPES.join("', '")}') AND "productId" IS NOT NULL
     ), seen AS (
       SELECT DISTINCT "productId", "visitId" FROM "AnalyticsEvent"
        WHERE day BETWEEN $1::date AND $2::date AND type IN ('${SEEN_TYPES.join("', '")}') AND "productId" IS NOT NULL
     )
     SELECT p.slug AS slug, COUNT(*)::int AS asked
       FROM asked a
       JOIN seen s ON s."productId" = a."productId" AND s."visitId" = a."visitId"
       JOIN "Product" p ON p.id = a."productId"
      WHERE p.slug IS NOT NULL
      GROUP BY p.slug`,
    from,
    today,
  )) as Array<{ slug: string; asked: number }>
  const out: Record<string, number> = {}
  for (const r of rows) out[r.slug] = r.asked
  return out
}
