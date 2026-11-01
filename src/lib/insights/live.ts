// ZP-505 (review M1): live numbers for days the nightly rollup has not
// stored yet (today; yesterday until the 02:30 job). Server only.
//
// READ-ONLY. One SELECT per day runs the rollup's own per-table SELECTs
// (ROLLUP_SELECTS / VISIT_ROWS_SELECT in src/lib/analytics/rollup.ts) over
// that day's raw events and returns the rows as JSON, so live numbers are
// exactly what the nightly job will store. Nothing is written: no rollup
// rows, no temp tables (the per-visit rows are a CTE), no row locks (a plain
// SELECT only takes the ACCESS SHARE lock that every reader takes). It runs
// in a READ ONLY transaction whose only purpose is a short statement timeout.
//
// Cached per DAY for 60 s on this instance, with single-flight: concurrent
// requests for the same day share one query.
import type { PrismaClient } from '@prisma/client'
import { ROLLUP_SELECTS as S, VISIT_ROWS_SELECT } from '@/lib/analytics/rollup'

export type VisitsSums = {
  visits: number
  devices: number
  returningVisits: number
  endedVisits: number
  bounces: number
  totalSeconds: number
  looksSeen: number
  enquiringVisits: number
}
export type JourneySums = {
  source: string
  deviceClass: string
  campaign: string
  visits: number
  reachedSecondLook: number
  reachedDetails: number
  reachedOpen: number
  reachedSize: number
  reachedWhatsapp: number
  feedEndVisits: number
  whatsappTaps: number
}
export type PieceSums = {
  productId: number
  views: number
  viewers: number
  dwellSeconds: number
  dwellCount: number
  detailsShows: number
  productOpens: number
  enquiries: number
  restockRequests: number
  shares: number
  loveOn: number
  loveOff: number
  photoSwipers: number
}
export type PhotoSums = { productId: number; photoIndex: number; image: string; views: number; viewers: number; dwellSeconds: number; dwellCount: number }
export type VideoSums = {
  productId: number
  starts: number
  viewers: number
  replays: number
  reached25: number
  reached50: number
  reached75: number
  reached100: number
  watchSeconds: number
}
export type DepthSums = { looks: number; visits: number }
export type HourSums = { hour: number; visits: number; enquiringVisits: number; whatsappTaps: number }
export type HealthSums = { kind: string; detail: string; events: number; visits: number }
export type OptionSums = { productId: number; kind: string; value: string; selects: number; enquiries: number; restockRequests: number }

export type LiveDay = {
  day: string
  visits: VisitsSums
  journey: JourneySums[]
  depth: DepthSums[]
  hour: HourSums[]
  piece: PieceSums[]
  photo: PhotoSums[]
  video: VideoSums[]
  health: HealthSums[]
  option: OptionSums[]
}

const rows = (select: string) => `(SELECT COALESCE(json_agg(s), '[]'::json) FROM (${select}) AS s)`

/** One read-only statement for one day ($1). */
export const LIVE_DAY_SQL = `
WITH analytics_rollup_visit AS MATERIALIZED (${VISIT_ROWS_SELECT})
SELECT json_build_object(
  'visits', (SELECT row_to_json(s) FROM (${S.visits.select}) AS s),
  'journey', ${rows(S.journey.select)},
  'depth', ${rows(S.depth.select)},
  'hour', ${rows(S.hour.select)},
  'piece', ${rows(S.piece.select)},
  'photo', ${rows(S.photo.select)},
  'video', ${rows(S.video.select)},
  'health', ${rows(S.health.select)},
  'option', ${rows(S.option.select)}
) AS data`

/** Short: a live day is one or two days of raw events, a few seconds at 500k events/day. */
export const LIVE_STATEMENT_TIMEOUT = '8s'
export const LIVE_CACHE_MS = 60_000
const LIVE_CACHE_MAX = 4

type Db = Pick<PrismaClient, '$transaction' | '$executeRawUnsafe' | '$queryRawUnsafe'>

async function queryLiveDay(db: Db, day: string): Promise<LiveDay> {
  const [, , result] = await db.$transaction([
    db.$executeRawUnsafe(`SET TRANSACTION READ ONLY`),
    db.$executeRawUnsafe(`SET LOCAL statement_timeout = '${LIVE_STATEMENT_TIMEOUT}'`),
    db.$queryRawUnsafe(LIVE_DAY_SQL, day),
  ])
  const data = (result as Array<{ data: Omit<LiveDay, 'day'> }>)[0].data
  return { day, ...data }
}

const cache = new Map<string, { at: number; promise: Promise<LiveDay> }>()

/** The live rows of one day: cached 60 s per day, one query in flight per day. */
export function liveDay(db: Db, day: string, nowMs: number = Date.now()): Promise<LiveDay> {
  const hit = cache.get(day)
  if (hit && nowMs - hit.at < LIVE_CACHE_MS) return hit.promise
  const promise = queryLiveDay(db, day)
  cache.set(day, { at: nowMs, promise })
  // A failure is not cached: the next request tries again.
  promise.catch(() => {
    if (cache.get(day)?.promise === promise) cache.delete(day)
  })
  while (cache.size > LIVE_CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return promise
}

/** Tests: forget cached live days. */
export function resetLiveCache(): void {
  cache.clear()
}
