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
import { addDays, ANALYTICS_TIME_ZONE, analyticsDay, isDay } from './events'

/** Raw events older than this many days are deleted. */
export const RAW_RETENTION_DAYS = 90
/** Daily rollups older than this many months are deleted. */
export const ROLLUP_RETENTION_MONTHS = 25
/** How many days the nightly run re-rolls by default: yesterday and the day before (late beacons, clock skew). */
export const DEFAULT_DAYS = 2

type Db = Pick<PrismaClient, '$transaction' | '$executeRawUnsafe'>
type Tx = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe'>

const BOUNCE_SECONDS = 5
/** ZP-505: depth rows are capped here: looks = MAX_DEPTH means "this many or more". */
export const MAX_DEPTH = 100

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

/**
 * Event types that count as opening a piece. ZP-510 adds the details sheet
 * (`details_sheet_open`), which replaces navigating to the product page.
 */
const OPEN_TYPES = ['product_open', 'details_sheet_open']
export { OPEN_TYPES }
/** ZP-506 ranking: one visit's look_dwell on a piece counts for at most this many seconds a day. */
export const RANK_DWELL_CAP_SECONDS = 60

const count = (type: string) => `COUNT(*) FILTER (WHERE type = '${type}')::int`
const sumProp = (type: string, prop: string) =>
  `COALESCE(SUM((props->>'${prop}')::float8) FILTER (WHERE type = '${type}'), 0)`

/**
 * The SELECT that produces one analytics day's rows of each rollup table
 * ($1 = the day), with columns named exactly like the table's. Shared by the
 * nightly INSERTs below and by the read-only live view of the Insights page
 * (ZP-505, src/lib/insights/live.ts), so live and stored numbers are the
 * same by construction.
 *
 * journey / depth / hour read `analytics_rollup_visit`: one row per visit
 * from VISIT_ROWS_SELECT. The nightly job puts those rows in a temp table;
 * the live view uses a CTE of the same name.
 */
export const VISIT_ROWS_SELECT = `
  WITH pv AS (
    SELECT "visitId",
           (ARRAY_AGG(props ORDER BY "occurredAt") FILTER (WHERE type = 'visit_start' AND day = $1::date))[1] AS start_props,
           MIN("occurredAt") FILTER (WHERE type = 'visit_start' AND day = $1::date) AS started_at,
           MAX((props->>'looks')::int) FILTER (WHERE type = 'visit_end') AS end_looks,
           COUNT(DISTINCT "productId") FILTER (WHERE type = 'look_view') AS seen,
           BOOL_OR(type = 'details_show') AS details,
           BOOL_OR(type IN (${OPEN_TYPES.map((t) => `'${t}'`).join(', ')})) AS opened, -- ZP-510: a details sheet open counts
           BOOL_OR(type = 'size_select') AS sized,
           COUNT(*) FILTER (WHERE type = 'whatsapp_enquire') AS taps,
           BOOL_OR(type = 'feed_end_reached') AS feed_end
    FROM "AnalyticsEvent"
    WHERE day BETWEEN $1::date AND $1::date + 1
      AND type IN ('visit_start', 'visit_end', 'look_view', 'details_show', ${OPEN_TYPES.map((t) => `'${t}'`).join(', ')}, 'size_select',
                   'whatsapp_enquire', 'feed_end_reached')
    GROUP BY "visitId"
  ),
  v AS (
    SELECT COALESCE(start_props->>'ref', 'other') AS source,
           COALESCE(start_props->>'device', 'desktop') AS device_class,
           COALESCE(start_props->>'campaign', '') AS campaign,
           EXTRACT(HOUR FROM (started_at AT TIME ZONE 'UTC') AT TIME ZONE '${ANALYTICS_TIME_ZONE}')::int AS hour,
           LEAST(GREATEST(COALESCE(end_looks, 0), seen), ${MAX_DEPTH})::int AS looks,
           details, opened, sized, taps, feed_end
    FROM pv
    WHERE start_props IS NOT NULL
  )
  -- step = the furthest funnel step: 0 landed, 1 saw a 2nd look, 2 Show details,
  -- 3 opened a piece, 4 chose a size, 5 WhatsApp.
  SELECT source, device_class, campaign, hour, looks,
         (CASE WHEN taps > 0 THEN 5 WHEN sized THEN 4 WHEN opened THEN 3 WHEN details THEN 2 WHEN looks >= 2 THEN 1 ELSE 0 END)::int AS step,
         feed_end, taps::int AS taps
  FROM v`

type RollupSelect = { table: string; columns: string[]; select: string }

const cols = (list: string) => list.split(',').map((c) => c.trim())

export const ROLLUP_SELECTS = {
  visits: {
    table: 'AnalyticsDailyVisits',
    columns: cols('visits, devices, "returningVisits", "endedVisits", bounces, "totalSeconds", "looksSeen", "enquiringVisits"'),
    select: `WITH ${VISITS_CTE}
      SELECT COUNT(*)::int AS visits,
             COUNT(DISTINCT "deviceId")::int AS devices,
             COUNT(*) FILTER (WHERE is_returning)::int AS "returningVisits",
             COUNT(duration)::int AS "endedVisits",
             COUNT(*) FILTER (WHERE bounce)::int AS bounces,
             COALESCE(SUM(duration), 0)::float8 AS "totalSeconds",
             COALESCE(SUM(looks), 0)::int AS "looksSeen",
             COUNT(*) FILTER (WHERE enquired)::int AS "enquiringVisits"
      FROM v`,
  },
  source: {
    table: 'AnalyticsDailySource',
    columns: cols('source, "deviceClass", campaign, visits, bounces, "enquiringVisits", "totalSeconds"'),
    select: `WITH ${VISITS_CTE}
      SELECT source, device_class AS "deviceClass", campaign,
             COUNT(*)::int AS visits,
             COUNT(*) FILTER (WHERE bounce)::int AS bounces,
             COUNT(*) FILTER (WHERE enquired)::int AS "enquiringVisits",
             COALESCE(SUM(duration), 0)::float8 AS "totalSeconds"
      FROM v
      GROUP BY source, device_class, campaign`,
  },
  piece: {
    table: 'AnalyticsDailyPiece',
    columns: cols(
      '"productId", slug, views, viewers, "dwellSeconds", "dwellCount", "photoViews", "videoStarts", "detailsShows", "productOpens", ' +
        '"sizeSelects", "colourSelects", "galleryZooms", enquiries, "restockRequests", shares, "loveOn", "loveOff", exits, "photoSwipers", ' +
        // ZP-506 ranking: distinct visits that also saw the look that day.
        '"dwellVisits", "dwellVisitSeconds", "swipeVisits", "detailsVisits", "openVisits", "enquiryVisits", "restockVisits", "shareVisits"',
    ),
    select: `WITH last_end AS (
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
               -- Distinct visits that opened the piece (any OPEN_TYPES): a sheet open, "View full page"
               -- and back is one visit, not three events (ZP-510 / ZP-506 review).
               (COUNT(DISTINCT "visitId") FILTER (WHERE type IN (${OPEN_TYPES.map((t) => `'${t}'`).join(', ')})))::int AS product_opens,
               ${count('size_select')} AS size_selects,
               ${count('colour_select')} AS colour_selects,
               ${count('gallery_zoom')} AS gallery_zooms,
               ${count('whatsapp_enquire')} AS enquiries,
               ${count('restock_request')} AS restock_requests,
               ${count('share')} AS shares,
               ${count('love_on')} AS love_on,
               ${count('love_off')} AS love_off,
               (COUNT(DISTINCT "visitId") FILTER (
                 WHERE (CASE WHEN type = 'photo_view' THEN (props->>'index')::int END) >= 2))::int AS photo_swipers
        FROM "AnalyticsEvent"
        WHERE day = $1::date AND "productId" IS NOT NULL AND slug IS NOT NULL
        GROUP BY "productId"
      ),
      -- ZP-506 ranking: one row per piece and visit, so repeated (or forged)
      -- events of one visit count once, and dwell is capped per visit.
      per_visit AS (
        SELECT "productId", "visitId",
               BOOL_OR(type = 'look_view') AS viewed,
               -- (LEAST ignores NULLs, so only for visits with a dwell)
               CASE WHEN BOOL_OR(type = 'look_dwell')
                    THEN LEAST(${RANK_DWELL_CAP_SECONDS}, SUM((props->>'seconds')::float8) FILTER (WHERE type = 'look_dwell')) END AS dwell,
               BOOL_OR(type = 'photo_view' AND (CASE WHEN type = 'photo_view' THEN (props->>'index')::int END) >= 2) AS swiped,
               BOOL_OR(type = 'details_show') AS details,
               BOOL_OR(type IN (${OPEN_TYPES.map((t) => `'${t}'`).join(', ')})) AS opened,
               BOOL_OR(type = 'whatsapp_enquire') AS enquired,
               BOOL_OR(type = 'restock_request') AS restocked,
               BOOL_OR(type = 'share') AS shared
        FROM "AnalyticsEvent"
        WHERE day = $1::date AND "productId" IS NOT NULL AND slug IS NOT NULL
        GROUP BY "productId", "visitId"
      ),
      rank_visits AS (
        SELECT "productId",
               (COUNT(*) FILTER (WHERE viewed AND dwell IS NOT NULL))::int AS dwell_visits,
               COALESCE(SUM(dwell) FILTER (WHERE viewed), 0)::float8 AS dwell_visit_seconds,
               (COUNT(*) FILTER (WHERE viewed AND swiped))::int AS swipe_visits,
               (COUNT(*) FILTER (WHERE viewed AND details))::int AS details_visits,
               (COUNT(*) FILTER (WHERE viewed AND opened))::int AS open_visits,
               (COUNT(*) FILTER (WHERE viewed AND enquired))::int AS enquiry_visits,
               (COUNT(*) FILTER (WHERE viewed AND restocked))::int AS restock_visits,
               (COUNT(*) FILTER (WHERE viewed AND shared))::int AS share_visits
        FROM per_visit
        GROUP BY "productId"
      )
      SELECT a."productId", a.slug, a.views, a.viewers, a.dwell_seconds AS "dwellSeconds", a.dwell_count AS "dwellCount",
             a.photo_views AS "photoViews", a.video_starts AS "videoStarts", a.details_shows AS "detailsShows",
             a.product_opens AS "productOpens", a.size_selects AS "sizeSelects", a.colour_selects AS "colourSelects",
             a.gallery_zooms AS "galleryZooms", a.enquiries, a.restock_requests AS "restockRequests", a.shares,
             a.love_on AS "loveOn", a.love_off AS "loveOff", COALESCE(x.n, 0)::int AS exits, a.photo_swipers AS "photoSwipers",
             COALESCE(r.dwell_visits, 0) AS "dwellVisits", COALESCE(r.dwell_visit_seconds, 0) AS "dwellVisitSeconds",
             COALESCE(r.swipe_visits, 0) AS "swipeVisits", COALESCE(r.details_visits, 0) AS "detailsVisits",
             COALESCE(r.open_visits, 0) AS "openVisits", COALESCE(r.enquiry_visits, 0) AS "enquiryVisits",
             COALESCE(r.restock_visits, 0) AS "restockVisits", COALESCE(r.share_visits, 0) AS "shareVisits"
      FROM agg a LEFT JOIN exits x ON x."productId" = a."productId"
                 LEFT JOIN rank_visits r ON r."productId" = a."productId"`,
  },
  photo: {
    table: 'AnalyticsDailyPhoto',
    columns: cols('"productId", "photoIndex", image, slug, views, viewers, "dwellSeconds", "dwellCount"'),
    select: `SELECT "productId", (props->>'index')::int AS "photoIndex", COALESCE(props->>'image', '') AS image,
             (ARRAY_AGG(slug ORDER BY "occurredAt" DESC))[1] AS slug,
             ${count('photo_view')} AS views,
             (COUNT(DISTINCT "visitId") FILTER (WHERE type = 'photo_view'))::int AS viewers,
             ${sumProp('photo_dwell', 'seconds')} AS "dwellSeconds",
             ${count('photo_dwell')} AS "dwellCount"
      FROM "AnalyticsEvent"
      WHERE day = $1::date AND type IN ('photo_view', 'photo_dwell') AND "productId" IS NOT NULL AND slug IS NOT NULL
      GROUP BY "productId", (props->>'index')::int, COALESCE(props->>'image', '')`,
  },
  video: {
    table: 'AnalyticsDailyVideo',
    columns: cols('"productId", slug, starts, viewers, replays, reached25, reached50, reached75, reached100, "watchSeconds"'),
    select: `SELECT "productId", (ARRAY_AGG(slug ORDER BY "occurredAt" DESC))[1] AS slug,
             ${count('video_start')} AS starts,
             (COUNT(DISTINCT "visitId") FILTER (WHERE type = 'video_start'))::int AS viewers,
             ${count('video_replay')} AS replays,
             (COUNT(*) FILTER (WHERE type = 'video_progress' AND props->>'pct' = '25'))::int AS reached25,
             (COUNT(*) FILTER (WHERE type = 'video_progress' AND props->>'pct' = '50'))::int AS reached50,
             (COUNT(*) FILTER (WHERE type = 'video_progress' AND props->>'pct' = '75'))::int AS reached75,
             (COUNT(*) FILTER (WHERE type = 'video_progress' AND props->>'pct' = '100'))::int AS reached100,
             ${sumProp('video_seconds', 'seconds')} AS "watchSeconds"
      FROM "AnalyticsEvent"
      WHERE day = $1::date AND type IN ('video_start', 'video_progress', 'video_replay', 'video_seconds')
        AND "productId" IS NOT NULL AND slug IS NOT NULL
      GROUP BY "productId"`,
  },
  // ── ZP-505 (Insights)
  journey: {
    table: 'AnalyticsDailyJourney',
    columns: cols(
      'source, "deviceClass", campaign, visits, "reachedSecondLook", "reachedDetails", "reachedOpen", "reachedSize", "reachedWhatsapp", "feedEndVisits", "whatsappTaps"',
    ),
    select: `SELECT source, device_class AS "deviceClass", campaign,
             COUNT(*)::int AS visits,
             COUNT(*) FILTER (WHERE step >= 1)::int AS "reachedSecondLook",
             COUNT(*) FILTER (WHERE step >= 2)::int AS "reachedDetails",
             COUNT(*) FILTER (WHERE step >= 3)::int AS "reachedOpen",
             COUNT(*) FILTER (WHERE step >= 4)::int AS "reachedSize",
             COUNT(*) FILTER (WHERE step >= 5)::int AS "reachedWhatsapp",
             COUNT(*) FILTER (WHERE feed_end)::int AS "feedEndVisits",
             COALESCE(SUM(taps), 0)::int AS "whatsappTaps"
      FROM analytics_rollup_visit
      GROUP BY source, device_class, campaign`,
  },
  depth: {
    table: 'AnalyticsDailyDepth',
    columns: cols('looks, visits'),
    select: `SELECT looks, COUNT(*)::int AS visits FROM analytics_rollup_visit GROUP BY looks`,
  },
  hour: {
    table: 'AnalyticsDailyHour',
    columns: cols('hour, visits, "enquiringVisits", "whatsappTaps"'),
    select: `SELECT hour, COUNT(*)::int AS visits, COUNT(*) FILTER (WHERE taps > 0)::int AS "enquiringVisits",
             COALESCE(SUM(taps), 0)::int AS "whatsappTaps"
      FROM analytics_rollup_visit
      GROUP BY hour`,
  },
  health: {
    table: 'AnalyticsDailyHealth',
    columns: cols('kind, detail, events, visits'),
    select: `SELECT type AS kind, COALESCE(props->>'what', props->>'action', '') AS detail,
             COUNT(*)::int AS events, COUNT(DISTINCT "visitId")::int AS visits
      FROM "AnalyticsEvent"
      WHERE day = $1::date AND type IN ('slow_load', 'load_error', 'action_failed')
      GROUP BY type, COALESCE(props->>'what', props->>'action', '')`,
  },
  option: {
    table: 'AnalyticsDailyOption',
    columns: cols('"productId", kind, value, selects, enquiries, "restockRequests"'),
    select: `SELECT e."productId", o.kind, o.value,
             COUNT(*) FILTER (WHERE e.type IN ('size_select', 'colour_select'))::int AS selects,
             COUNT(*) FILTER (WHERE e.type = 'whatsapp_enquire')::int AS enquiries,
             COUNT(*) FILTER (WHERE e.type = 'restock_request')::int AS "restockRequests"
      FROM "AnalyticsEvent" e
      CROSS JOIN LATERAL (VALUES ('size', e.props->>'size'), ('colour', e.props->>'colour')) AS o(kind, value)
      WHERE e.day = $1::date AND e.type IN ('size_select', 'colour_select', 'whatsapp_enquire', 'restock_request')
        AND e."productId" IS NOT NULL AND o.value IS NOT NULL
      GROUP BY e."productId", o.kind, o.value`,
  },
} satisfies Record<string, RollupSelect>

const insert = ({ table, columns, select }: RollupSelect, extra: { column: string; value: string } | null = null) => {
  const list = columns.join(', ')
  return `INSERT INTO "${table}" (day, ${list}${extra ? `, ${extra.column}` : ''})
   SELECT $1::date, ${list}${extra ? `, ${extra.value}` : ''} FROM (${select}) AS s`
}

const S = ROLLUP_SELECTS

const STATEMENTS: string[] = [
  ...Object.values(S).map((s) => `DELETE FROM "${s.table}" WHERE day = $1::date`),

  insert(S.visits, { column: '"updatedAt"', value: 'now()' }),
  insert(S.source),
  insert(S.piece),
  insert(S.photo),
  insert(S.video),

  // ZP-505: one grouped pass over the visit's two days into a temp table
  // (dropped at the end of the transaction), then journey, depth and hour from it.
  `DROP TABLE IF EXISTS pg_temp.analytics_rollup_visit`,
  `CREATE TEMP TABLE analytics_rollup_visit (
     source text, device_class text, campaign text, hour int, looks int, step int, feed_end boolean, taps int
   ) ON COMMIT DROP`,
  `INSERT INTO analytics_rollup_visit (source, device_class, campaign, hour, looks, step, feed_end, taps) ${VISIT_ROWS_SELECT}`,
  insert(S.journey),
  insert(S.depth),
  insert(S.hour),
  insert(S.health),
  insert(S.option),
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
    await rollupDayInTransaction(tx, day)
    return { day, status: 'done' as const }
  }, ROLLUP_TRANSACTION)
}

/**
 * The rollup statements for one day, inside a transaction the caller owns
 * (no checks, no statement timeout). Used by rollupDay (and tests). The
 * Insights page never writes: it runs ROLLUP_SELECTS read-only instead.
 */
export async function rollupDayInTransaction(tx: Pick<PrismaClient, '$executeRawUnsafe'>, day: string): Promise<void> {
  if (!isDay(day)) throw new Error(`Not a date: ${day}`)
  for (const sql of STATEMENTS) {
    if (sql.includes('$1')) await tx.$executeRawUnsafe(sql, day)
    else await tx.$executeRawUnsafe(sql)
  }
}

export const ROLLUP_TABLES = [
  'AnalyticsDailyVisits',
  'AnalyticsDailySource',
  'AnalyticsDailyPiece',
  'AnalyticsDailyPhoto',
  'AnalyticsDailyVideo',
  // ZP-505
  'AnalyticsDailyJourney',
  'AnalyticsDailyDepth',
  'AnalyticsDailyHour',
  'AnalyticsDailyHealth',
  'AnalyticsDailyOption',
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
