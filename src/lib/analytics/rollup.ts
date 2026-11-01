// ZP-493: nightly rollup of AnalyticsEvent into the daily tables, and
// retention. Server / job only (scripts/analytics-rollup.ts).
//
// rollupDay(day) replaces that day's rows in every daily table inside one
// transaction, so running it again (or backfilling) is always safe.
// Visit metrics are by the day the visit STARTED; a visit_end after
// midnight (next analytics day) still counts for it. Everything else is by
// the day of the event. Columns are documented in prisma/schema.prisma and
// docs/storefront/analytics.md.
import type { PrismaClient } from '@prisma/client'
import { addDays, analyticsDay, isDay } from './events'

/** Raw events older than this many days are deleted. */
export const RAW_RETENTION_DAYS = 90
/** Daily rollups older than this many months are deleted. */
export const ROLLUP_RETENTION_MONTHS = 25
/** How many days the nightly run re-rolls by default: yesterday and the day before (late beacons, clock skew). */
export const DEFAULT_DAYS = 2

type Db = Pick<PrismaClient, '$transaction' | '$executeRawUnsafe'>
type Tx = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe'>

const BOUNCE_SECONDS = 5

/**
 * One row per visit that started on $1, with its latest/longest visit_end
 * and whether it enquired (that day or the next). One grouped pass over the
 * two days, no joins: at 500k events/day the earlier join form (CTE + IN
 * semi-joins) picked nested loops and ran for minutes.
 */
const VISITS_CTE = `
  pv AS (
    SELECT "visitId",
           (ARRAY_AGG("deviceId" ORDER BY "occurredAt") FILTER (WHERE type = 'visit_start' AND day = $1::date))[1] AS device_id,
           (ARRAY_AGG(props ORDER BY "occurredAt") FILTER (WHERE type = 'visit_start' AND day = $1::date))[1] AS start_props,
           MAX((props->>'duration')::float8) FILTER (WHERE type = 'visit_end') AS duration,
           MAX((props->>'looks')::int) FILTER (WHERE type = 'visit_end') AS looks,
           BOOL_OR(type = 'whatsapp_enquire') AS enquired
    FROM "AnalyticsEvent"
    WHERE day BETWEEN $1::date AND $1::date + 1
      AND type IN ('visit_start', 'visit_end', 'whatsapp_enquire')
    GROUP BY "visitId"
  ),
  v AS (
    SELECT "visitId",
           device_id AS "deviceId",
           COALESCE(start_props->>'ref', 'other') AS source,
           COALESCE(start_props->>'device', 'desktop') AS device_class,
           COALESCE(start_props->>'campaign', '') AS campaign,
           COALESCE((start_props->>'returning')::boolean, false) AS is_returning,
           duration,
           looks,
           (duration IS NOT NULL AND duration < ${BOUNCE_SECONDS} AND COALESCE(looks, 0) <= 1) AS bounce,
           COALESCE(enquired, false) AS enquired
    FROM pv
    WHERE start_props IS NOT NULL
  )`

const count = (type: string) => `COUNT(*) FILTER (WHERE type = '${type}')::int`
const sumProp = (type: string, prop: string) =>
  `COALESCE(SUM((props->>'${prop}')::float8) FILTER (WHERE type = '${type}'), 0)`

const STATEMENTS: string[] = [
  `DELETE FROM "AnalyticsDailyVisits" WHERE day = $1::date`,
  `DELETE FROM "AnalyticsDailySource" WHERE day = $1::date`,
  `DELETE FROM "AnalyticsDailyPiece" WHERE day = $1::date`,
  `DELETE FROM "AnalyticsDailyPhoto" WHERE day = $1::date`,
  `DELETE FROM "AnalyticsDailyVideo" WHERE day = $1::date`,

  `WITH ${VISITS_CTE}
   INSERT INTO "AnalyticsDailyVisits"
     (day, visits, devices, "returningVisits", "endedVisits", bounces, "totalSeconds", "looksSeen", "enquiringVisits", "updatedAt")
   SELECT $1::date,
          COUNT(*)::int,
          COUNT(DISTINCT "deviceId")::int,
          COUNT(*) FILTER (WHERE is_returning)::int,
          COUNT(duration)::int,
          COUNT(*) FILTER (WHERE bounce)::int,
          COALESCE(SUM(duration), 0),
          COALESCE(SUM(looks), 0)::int,
          COUNT(*) FILTER (WHERE enquired)::int,
          now()
   FROM v`,

  `WITH ${VISITS_CTE}
   INSERT INTO "AnalyticsDailySource" (day, source, "deviceClass", campaign, visits, bounces, "enquiringVisits", "totalSeconds")
   SELECT $1::date, source, device_class, campaign,
          COUNT(*)::int,
          COUNT(*) FILTER (WHERE bounce)::int,
          COUNT(*) FILTER (WHERE enquired)::int,
          COALESCE(SUM(duration), 0)
   FROM v
   GROUP BY source, device_class, campaign`,

  `WITH last_end AS (
     SELECT DISTINCT ON ("visitId") "visitId", "productId"
     FROM "AnalyticsEvent"
     WHERE day = $1::date AND type = 'visit_end'
     ORDER BY "visitId", "occurredAt" DESC
   ),
   exits AS (
     SELECT "productId", COUNT(*)::int AS n FROM last_end WHERE "productId" IS NOT NULL GROUP BY "productId"
   ),
   agg AS (
     SELECT "productId",
            (ARRAY_AGG(slug ORDER BY "occurredAt" DESC))[1] AS slug,
            ${count('look_view')} AS views,
            (COUNT(DISTINCT "visitId") FILTER (WHERE type = 'look_view'))::int AS viewers,
            ${sumProp('look_dwell', 'seconds')} AS dwell_seconds,
            ${count('look_dwell')} AS dwell_count,
            ${count('photo_view')} AS photo_views,
            ${count('video_start')} AS video_starts,
            ${count('details_show')} AS details_shows,
            ${count('product_open')} AS product_opens,
            ${count('size_select')} AS size_selects,
            ${count('colour_select')} AS colour_selects,
            ${count('gallery_zoom')} AS gallery_zooms,
            ${count('whatsapp_enquire')} AS enquiries,
            ${count('restock_request')} AS restock_requests,
            ${count('share')} AS shares,
            ${count('love_on')} AS love_on,
            ${count('love_off')} AS love_off
     FROM "AnalyticsEvent"
     WHERE day = $1::date AND "productId" IS NOT NULL AND slug IS NOT NULL
     GROUP BY "productId"
   )
   INSERT INTO "AnalyticsDailyPiece"
     (day, "productId", slug, views, viewers, "dwellSeconds", "dwellCount", "photoViews", "videoStarts", "detailsShows",
      "productOpens", "sizeSelects", "colourSelects", "galleryZooms", enquiries, "restockRequests", shares, "loveOn", "loveOff", exits)
   SELECT $1::date, a."productId", a.slug, a.views, a.viewers, a.dwell_seconds, a.dwell_count, a.photo_views, a.video_starts,
          a.details_shows, a.product_opens, a.size_selects, a.colour_selects, a.gallery_zooms, a.enquiries, a.restock_requests,
          a.shares, a.love_on, a.love_off, COALESCE(x.n, 0)
   FROM agg a LEFT JOIN exits x ON x."productId" = a."productId"`,

  `INSERT INTO "AnalyticsDailyPhoto" (day, "productId", "photoIndex", image, slug, views, viewers, "dwellSeconds", "dwellCount")
   SELECT $1::date, "productId", (props->>'index')::int, COALESCE(props->>'image', ''),
          (ARRAY_AGG(slug ORDER BY "occurredAt" DESC))[1],
          ${count('photo_view')},
          (COUNT(DISTINCT "visitId") FILTER (WHERE type = 'photo_view'))::int,
          ${sumProp('photo_dwell', 'seconds')},
          ${count('photo_dwell')}
   FROM "AnalyticsEvent"
   WHERE day = $1::date AND type IN ('photo_view', 'photo_dwell') AND "productId" IS NOT NULL AND slug IS NOT NULL
   GROUP BY "productId", (props->>'index')::int, COALESCE(props->>'image', '')`,

  `INSERT INTO "AnalyticsDailyVideo"
     (day, "productId", slug, starts, viewers, replays, reached25, reached50, reached75, reached100, "watchSeconds")
   SELECT $1::date, "productId", (ARRAY_AGG(slug ORDER BY "occurredAt" DESC))[1],
          ${count('video_start')},
          (COUNT(DISTINCT "visitId") FILTER (WHERE type = 'video_start'))::int,
          ${count('video_replay')},
          (COUNT(*) FILTER (WHERE type = 'video_progress' AND props->>'pct' = '25'))::int,
          (COUNT(*) FILTER (WHERE type = 'video_progress' AND props->>'pct' = '50'))::int,
          (COUNT(*) FILTER (WHERE type = 'video_progress' AND props->>'pct' = '75'))::int,
          (COUNT(*) FILTER (WHERE type = 'video_progress' AND props->>'pct' = '100'))::int,
          ${sumProp('video_seconds', 'seconds')}
   FROM "AnalyticsEvent"
   WHERE day = $1::date AND type IN ('video_start', 'video_progress', 'video_replay', 'video_seconds')
     AND "productId" IS NOT NULL AND slug IS NOT NULL
   GROUP BY "productId"`,
]

/**
 * Transaction limits for one day's rollup. Prisma's interactive-transaction
 * default is 5 s, which a busy day (~400k events) exceeded. The statement
 * timeout (set inside the transaction) stops a runaway query before the
 * transaction timeout, so the job fails cleanly instead of hanging.
 */
export const ROLLUP_TRANSACTION = { timeout: 10 * 60_000, maxWait: 30_000 }
export const ROLLUP_STATEMENT_TIMEOUT = '9min'

export type RollupDayResult = { day: string; status: 'done' | 'skipped'; reason?: string }

/** The oldest day whose raw events are all still there (older ones are pruned). */
export function oldestRollableDay(now: Date = new Date()): string {
  return addDays(analyticsDay(now), -RAW_RETENTION_DAYS)
}

/**
 * Recompute every daily table for one analytics day ("YYYY-MM-DD").
 * Idempotent. Never touches a day it cannot rebuild correctly:
 * - older than RAW_RETENTION_DAYS (its raw events are pruned or being
 *   pruned; rebuilding would replace real totals with zeros), or
 * - with no raw events at all while rollups for it exist.
 * Such a day is skipped and its rollups are left exactly as they are.
 */
export async function rollupDay(db: Db, day: string, options: { now?: Date } = {}): Promise<RollupDayResult> {
  if (!isDay(day)) throw new Error(`Not a date: ${day}`)
  const oldest = oldestRollableDay(options.now)
  if (day < oldest) {
    return { day, status: 'skipped', reason: `older than ${RAW_RETENTION_DAYS} days (raw events pruned); rollups kept` }
  }
  return db.$transaction(async (tx: Tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${ROLLUP_STATEMENT_TIMEOUT}'`)
    const [{ raw, rolled }] = (await tx.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM "AnalyticsEvent" WHERE day = $1::date) AS raw,
              (EXISTS (SELECT 1 FROM "AnalyticsDailyVisits" WHERE day = $1::date)
               OR EXISTS (SELECT 1 FROM "AnalyticsDailyPiece" WHERE day = $1::date)) AS rolled`,
      day,
    )) as Array<{ raw: boolean; rolled: boolean }>
    if (!raw && rolled) {
      return { day, status: 'skipped' as const, reason: 'no raw events but rollups exist; rollups kept' }
    }
    for (const sql of STATEMENTS) await tx.$executeRawUnsafe(sql, day)
    return { day, status: 'done' as const }
  }, ROLLUP_TRANSACTION)
}

const ROLLUP_TABLES = [
  'AnalyticsDailyVisits',
  'AnalyticsDailySource',
  'AnalyticsDailyPiece',
  'AnalyticsDailyPhoto',
  'AnalyticsDailyVideo',
]

/** Subtract whole months from "YYYY-MM-DD" (clamped to the month's last day). */
function subtractMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const total = y * 12 + (m - 1) - months
  const year = Math.floor(total / 12)
  const month = total % 12
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Delete raw events older than 90 days and rollups older than 25 months (analytics days, Harare). */
export async function pruneAnalytics(db: Pick<PrismaClient, '$executeRawUnsafe'>, now: Date = new Date()) {
  const today = analyticsDay(now)
  const rawCutoff = addDays(today, -RAW_RETENTION_DAYS)
  const rollupCutoff = subtractMonths(today, ROLLUP_RETENTION_MONTHS)
  const rawDeleted = await db.$executeRawUnsafe(`DELETE FROM "AnalyticsEvent" WHERE day < $1::date`, rawCutoff)
  let rollupsDeleted = 0
  for (const table of ROLLUP_TABLES) {
    rollupsDeleted += await db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE day < $1::date`, rollupCutoff)
  }
  return { rawCutoff, rollupCutoff, rawDeleted, rollupsDeleted }
}

export type RollupPlan = { from: string; to: string; prune: boolean }

/**
 * Arguments of `npm run analytics:rollup`:
 *   (none)                         the day before yesterday and yesterday (Harare), then prune
 *   --date YYYY-MM-DD              one day
 *   --from YYYY-MM-DD --to YYYY-MM-DD   a range, both inclusive (backfill)
 *   --no-prune                     skip the retention deletes
 * Days older than RAW_RETENTION_DAYS are refused: their raw events are gone,
 * so rebuilding them would replace real totals with zeros.
 */
export function parseRollupArgs(argv: readonly string[], now: Date = new Date()): RollupPlan {
  let date: string | undefined
  let from: string | undefined
  let to: string | undefined
  let prune = true
  const value = (i: number, flag: string) => {
    const v = argv[i + 1]
    if (!isDay(v)) throw new Error(`${flag} needs a date YYYY-MM-DD`)
    return v
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--date') date = value(i++, arg)
    else if (arg === '--from') from = value(i++, arg)
    else if (arg === '--to') to = value(i++, arg)
    else if (arg === '--no-prune') prune = false
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (date && (from || to)) throw new Error('Use --date or --from/--to, not both')
  if ((from && !to) || (to && !from)) throw new Error('--from and --to go together')
  const oldest = oldestRollableDay(now)
  const tooOld = (day: string) => {
    if (day < oldest) {
      throw new Error(`${day} is older than ${RAW_RETENTION_DAYS} days (oldest: ${oldest}); its raw events are gone`)
    }
  }
  if (date) {
    tooOld(date)
    return { from: date, to: date, prune }
  }
  if (from && to) {
    if (from > to) throw new Error('--from is after --to')
    tooOld(from)
    return { from, to, prune }
  }
  const yesterday = addDays(analyticsDay(now), -1)
  return { from: addDays(yesterday, -(DEFAULT_DAYS - 1)), to: yesterday, prune }
}

/** Roll up every day of the plan (oldest first), then prune if asked. Skipped days are reported, never deleted. */
export async function runRollup(db: Db, plan: RollupPlan & { now?: Date }) {
  const days: string[] = []
  const skipped: string[] = []
  for (let d = plan.from; d <= plan.to; d = addDays(d, 1)) days.push(d)
  for (const day of days) {
    const result = await rollupDay(db, day, { now: plan.now })
    if (result.status === 'skipped') skipped.push(day)
  }
  const pruned = plan.prune ? await pruneAnalytics(db, plan.now ?? new Date()) : null
  return { days, skipped, pruned }
}
