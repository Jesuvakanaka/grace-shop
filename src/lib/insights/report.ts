// ZP-505: the Insights report. Server only. Never writes.
//
// Past days: the daily ROLLUP tables only, one grouped day-indexed query per
// table plus one product query, so the cost does not grow with the number of
// pieces (no N+1).
//
// Days the rollups do not have yet (today; yesterday until the nightly job
// has stored it) come from src/lib/insights/live.ts: the rollup's own SELECTs
// run read-only over that day's raw events. The rollup reads EXCLUDE those
// days, so if the nightly job commits yesterday in the middle of a request
// nothing is counted twice; the worst case is numbers a minute old.
import type { PrismaClient } from '@prisma/client'
import { addDays, ANALYTICS_TIME_ZONE, analyticsDay, dayToDate, DEVICE_CLASSES } from '@/lib/analytics/events'
import { MAX_DEPTH } from '@/lib/analytics/rollup'
import { displayName } from '@/lib/storefront-model'
import { imageUrlForKey, isValidImageKey } from '@/lib/storage/keys'
import { loadPopularity, loadRankingStatus } from '@/lib/ranking/read'
import {
  liveDay,
  type DepthSums,
  type HealthSums,
  type JourneySums,
  type LiveDay,
  type OptionSums,
  type PhotoSums,
  type PieceSums,
  type VideoSums,
  type VisitsSums,
} from './live'
import { rangeDays, type InsightsRange } from './range'
import {
  FUNNEL_STEPS,
  THRESHOLDS,
  type Demand,
  type Depth,
  type Funnel,
  type FunnelSegment,
  type Health,
  type InsightsReport,
  type LookRow,
  type OptionCount,
  type Overview,
  type ReviewsSummary,
  type PiecePhotos,
  type PhotoRow,
  type Sources,
  type VideoRow,
} from './types'

export { THRESHOLDS } from './types'

type Db = PrismaClient

/** Health lists every day (zeros included) up to this range length; longer ranges list only days with problems. */
const HEALTH_ALL_DAYS = 31

/**
 * Days of the range the rollups do not have yet: today, and yesterday when
 * the nightly job has not rolled it up (no visits row) but raw events exist.
 */
export async function liveDaysFor(db: Db, range: Pick<InsightsRange, 'from' | 'to'>, now: Date): Promise<string[]> {
  const today = analyticsDay(now)
  const yesterday = addDays(today, -1)
  const live: string[] = []
  const inRange = (d: string) => range.from <= d && d <= range.to
  if (inRange(yesterday)) {
    const rolled = await db.analyticsDailyVisits.findUnique({ where: { day: dayToDate(yesterday) }, select: { day: true } })
    if (!rolled) {
      const raw = await db.analyticsEvent.findFirst({ where: { day: dayToDate(yesterday) }, select: { id: true } })
      if (raw) live.push(yesterday)
    }
  }
  if (inRange(today)) live.push(today)
  return live
}

export async function loadInsights(db: Db, range: InsightsRange, options: { now?: Date } = {}): Promise<InsightsReport> {
  const now = options.now ?? new Date()
  return readInsights(db, range, await liveDaysFor(db, range, now), now)
}

/**
 * The report for `range`, taking `liveDays` from raw events (read-only) and
 * every other day from the rollups. A live day whose query fails (timeout)
 * is left out and listed in range.liveUnavailable instead of failing the page.
 */
export async function readInsights(db: Db, range: InsightsRange, liveDays: string[], now: Date): Promise<InsightsReport> {
  const settled = await Promise.allSettled(liveDays.map((d) => liveDay(db, d)))
  const live: LiveDay[] = []
  const unavailable: string[] = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') live.push(s.value)
    else {
      unavailable.push(liveDays[i])
      console.error('[insights] live day failed:', liveDays[i], s.reason instanceof Error ? s.reason.message : s.reason)
    }
  })
  const rolled = await readRollups(db, range, liveDays)
  const data = mergeLive(rolled, live)
  const report = await buildReport(db, range, data, { liveDays: live.map((l) => l.day), unavailable, notRecalculated: rolled.notRecalculated }, now)
  return { ...report, reviews: await readReviews(db, range) }
}

/**
 * ZP-508 reviews in the range: counts per Harare week (Monday start), mean
 * stars of the approved ones, and how many wait for the owner now. The Review
 * table is small (one row per verified buyer's review); counts only, never
 * text, names or photos.
 */
async function readReviews(db: Db, range: InsightsRange): Promise<ReviewsSummary> {
  const weeks = (await db.$queryRaw`
    WITH r AS (
      SELECT (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ANALYTICS_TIME_ZONE}) AS local_at, status, stars
      FROM "Review"
    )
    SELECT date_trunc('week', local_at)::date::text AS week,
           COUNT(*)::int AS received,
           COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
           COALESCE(SUM(stars) FILTER (WHERE status = 'APPROVED'), 0)::int AS stars
    FROM r
    WHERE local_at >= ${range.from}::date AND local_at < ${range.to}::date + 1
    GROUP BY 1
    ORDER BY 1`) as Array<{ week: string; received: number; approved: number; stars: number }>
  const pendingNow = await db.review.count({ where: { status: 'PENDING' } })
  const received = weeks.reduce((t, w) => t + w.received, 0)
  const approved = weeks.reduce((t, w) => t + w.approved, 0)
  const stars = weeks.reduce((t, w) => t + w.stars, 0)
  return {
    received,
    approved,
    averageStars: ratio(stars, approved),
    pendingNow,
    perWeek: weeks.map((w) => ({ week: w.week, received: w.received, approved: w.approved })),
  }
}

// ------------------------------------------------------------------ rows

type HeatCell = { weekday: number; hour: number; visits: number; whatsappTaps: number }
type HealthDay = HealthSums & { day: string }

type Data = {
  visits: VisitsSums
  journey: JourneySums[]
  piece: PieceSums[]
  photo: PhotoSums[]
  video: VideoSums[]
  depth: DepthSums[]
  heat: HeatCell[]
  health: HealthDay[]
  option: OptionSums[]
}

const n = (v: number | null | undefined) => v ?? 0
const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const fileName = (key: string) => key.slice(key.lastIndexOf('/') + 1)
const urlFor = (key: string | undefined) => (key && isValidImageKey(key) ? imageUrlForKey(key) : null)
/** ISO weekday of "YYYY-MM-DD": 1 = Monday .. 7 = Sunday. */
const isoWeekday = (day: string) => dayToDate(day).getUTCDay() || 7

/** Prisma groupBy row -> flat row with the sums (nulls as 0). */
function flat<T>(row: { _sum: Record<string, number | null> } & Record<string, unknown>): T {
  const { _sum, ...keys } = row
  const sums: Record<string, number> = {}
  for (const [k, v] of Object.entries(_sum)) sums[k] = v ?? 0
  return { ...keys, ...sums } as T
}

/** Sum rows with the same key (rollup days + live days). */
function mergeBy<T extends object>(rows: T[], key: (r: T) => string, fields: readonly (keyof T)[]): T[] {
  const out = new Map<string, T>()
  for (const r of rows) {
    const k = key(r)
    const cur = out.get(k)
    if (!cur) out.set(k, { ...r })
    else for (const f of fields) (cur[f] as unknown as number) = n(cur[f] as unknown as number) + n(r[f] as unknown as number)
  }
  return [...out.values()]
}

const VISIT_FIELDS = ['visits', 'devices', 'returningVisits', 'endedVisits', 'bounces', 'totalSeconds', 'looksSeen', 'enquiringVisits'] as const
const JOURNEY_FIELDS = ['visits', 'reachedSecondLook', 'reachedDetails', 'reachedOpen', 'reachedSize', 'reachedWhatsapp', 'feedEndVisits', 'whatsappTaps'] as const
const PIECE_FIELDS = ['views', 'viewers', 'dwellSeconds', 'dwellCount', 'detailsShows', 'productOpens', 'enquiries', 'restockRequests', 'shares', 'loveOn', 'loveOff', 'photoSwipers'] as const
const PHOTO_FIELDS = ['views', 'viewers', 'dwellSeconds', 'dwellCount'] as const
const VIDEO_FIELDS = ['starts', 'viewers', 'replays', 'reached25', 'reached50', 'reached75', 'reached100', 'watchSeconds'] as const
const OPTION_FIELDS = ['selects', 'enquiries', 'restockRequests'] as const

type Rolled = Data & { notRecalculated: string[] }

const NO_DAY = '1900-01-01'

async function readRollups(db: Db, range: InsightsRange, liveDays: string[]): Promise<Rolled> {
  const where = { day: { gte: dayToDate(range.from), lte: dayToDate(range.to), notIn: liveDays.map(dayToDate) } }
  const sum = <K extends string>(fields: readonly K[]) => Object.fromEntries(fields.map((f) => [f, true])) as Record<K, true>

  const visits = await db.analyticsDailyVisits.aggregate({ where, _sum: sum(VISIT_FIELDS) })
  const journey = await db.analyticsDailyJourney.groupBy({ by: ['source', 'deviceClass', 'campaign'], where, _sum: sum(JOURNEY_FIELDS) })
  const piece = await db.analyticsDailyPiece.groupBy({ by: ['productId'], where, _sum: sum(PIECE_FIELDS) })
  const photo = await db.analyticsDailyPhoto.groupBy({ by: ['productId', 'photoIndex', 'image'], where, _sum: sum(PHOTO_FIELDS) })
  const video = await db.analyticsDailyVideo.groupBy({ by: ['productId'], where, _sum: sum(VIDEO_FIELDS) })
  const depth = await db.analyticsDailyDepth.groupBy({ by: ['looks'], where, _sum: { visits: true } })
  // At most two live days (yesterday, today); unused slots get a date no rollup has.
  const [skipA = NO_DAY, skipB = NO_DAY] = liveDays
  if (liveDays.length > 2) throw new Error('at most two live days')
  const heat = (await db.$queryRaw`
    SELECT EXTRACT(ISODOW FROM day)::int AS weekday, hour, SUM(visits)::int AS visits, SUM("whatsappTaps")::int AS "whatsappTaps"
    FROM "AnalyticsDailyHour"
    WHERE day BETWEEN ${range.from}::date AND ${range.to}::date AND day NOT IN (${skipA}::date, ${skipB}::date)
    GROUP BY 1, 2`) as HeatCell[]
  const health = await db.analyticsDailyHealth.groupBy({ by: ['day', 'kind', 'detail'], where, _sum: { events: true, visits: true } })
  const option = await db.analyticsDailyOption.groupBy({ by: ['productId', 'kind', 'value'], where, _sum: sum(OPTION_FIELDS) })

  // Review F1: days rolled up before the ZP-505 rollups existed have visits but no journey rows.
  const withVisits = await db.analyticsDailyVisits.findMany({ where: { ...where, visits: { gt: 0 } }, select: { day: true } })
  const withJourney = new Set((await db.analyticsDailyJourney.groupBy({ by: ['day'], where })).map((r) => dayKey(r.day)))
  const notRecalculated = withVisits.map((r) => dayKey(r.day)).filter((d) => !withJourney.has(d)).sort()

  return {
    visits: Object.fromEntries(VISIT_FIELDS.map((f) => [f, n(visits._sum[f])])) as VisitsSums,
    journey: journey.map((r) => flat<JourneySums>(r)),
    piece: piece.map((r) => flat<PieceSums>(r)),
    photo: photo.map((r) => flat<PhotoSums>(r)),
    video: video.map((r) => flat<VideoSums>(r)),
    depth: depth.map((r) => flat<DepthSums>(r)),
    heat,
    health: health.map((r) => {
      const row = flat<HealthSums & { day: Date }>(r)
      return { ...row, day: dayKey(row.day) }
    }),
    option: option.map((r) => flat<OptionSums>(r)),
    notRecalculated,
  }
}

function mergeLive(rolled: Rolled, live: LiveDay[]): Data {
  const visits = { ...rolled.visits }
  for (const l of live) for (const f of VISIT_FIELDS) visits[f] += n(l.visits?.[f])
  const all = <T>(pick: (l: LiveDay) => T[]) => live.flatMap(pick)
  return {
    visits,
    journey: mergeBy([...rolled.journey, ...all((l) => l.journey)], (r) => `${r.source}\u0000${r.deviceClass}\u0000${r.campaign}`, JOURNEY_FIELDS),
    piece: mergeBy([...rolled.piece, ...all((l) => l.piece)], (r) => String(r.productId), PIECE_FIELDS),
    photo: mergeBy([...rolled.photo, ...all((l) => l.photo)], (r) => `${r.productId}\u0000${r.photoIndex}\u0000${r.image}`, PHOTO_FIELDS),
    video: mergeBy([...rolled.video, ...all((l) => l.video)], (r) => String(r.productId), VIDEO_FIELDS),
    depth: mergeBy([...rolled.depth, ...all((l) => l.depth)], (r) => String(r.looks), ['visits']),
    heat: mergeBy(
      [...rolled.heat, ...live.flatMap((l) => l.hour.map((h) => ({ weekday: isoWeekday(l.day), hour: h.hour, visits: h.visits, whatsappTaps: h.whatsappTaps })))],
      (r) => `${r.weekday}-${r.hour}`,
      ['visits', 'whatsappTaps'],
    ),
    health: mergeBy([...rolled.health, ...live.flatMap((l) => l.health.map((h) => ({ ...h, day: l.day })))], (r) => `${r.day}\u0000${r.kind}\u0000${r.detail}`, ['events', 'visits']),
    option: mergeBy([...rolled.option, ...all((l) => l.option)], (r) => `${r.productId}\u0000${r.kind}\u0000${r.value}`, OPTION_FIELDS),
  }
}

// ------------------------------------------------------------------ products

type ProductInfo = {
  id: number
  name: string
  slug: string
  soldOut: boolean
  askForPrice: boolean
  coverKey: string | undefined
  keyByFile: Map<string, string>
  /** ZP-506: gallery image id per stored file name ("Use as first photo"). */
  idByFile: Map<string, number>
}

function removed(id: number): ProductInfo {
  return {
    id,
    name: `Removed piece #${id}`,
    slug: '',
    soldOut: false,
    askForPrice: false,
    coverKey: undefined,
    keyByFile: new Map(),
    idByFile: new Map(),
  }
}

async function productInfo(db: Db, ids: number[]): Promise<Map<number, ProductInfo>> {
  if (ids.length === 0) return new Map()
  const products = await db.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      productName: true,
      publicName: true,
      slug: true,
      currentQuantity: true,
      priceDisplay: true,
      images: { select: { id: true, imageKey: true, isPrimary: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
    },
  })
  return new Map(
    products.map((p) => {
      const cover = p.images.find((i) => i.isPrimary) ?? p.images[0]
      return [
        p.id,
        {
          id: p.id,
          name: displayName(p),
          slug: p.slug ?? '',
          soldOut: p.currentQuantity <= 0,
          askForPrice: p.priceDisplay === 'ASK_FOR_PRICE',
          coverKey: cover?.imageKey,
          keyByFile: new Map(p.images.map((i) => [fileName(i.imageKey), i.imageKey])),
          idByFile: new Map(p.images.map((i) => [fileName(i.imageKey), i.id])),
        },
      ]
    }),
  )
}

// ------------------------------------------------------------------ the report

async function buildReport(
  db: Db,
  range: InsightsRange,
  data: Data,
  meta: { liveDays: string[]; unavailable: string[]; notRecalculated: string[] },
  now: Date,
): Promise<Omit<InsightsReport, 'reviews'>> {
  const { visits, journey, piece: pieces, photo: photos, video: videos, depth, heat, health, option: options } = data

  const ids = new Set<number>()
  for (const r of pieces) ids.add(r.productId)
  for (const r of photos) ids.add(r.productId)
  for (const r of videos) ids.add(r.productId)
  for (const r of options) ids.add(r.productId)
  // ZP-506: the stored popularity (latest nightly run) of the same pieces; one query.
  const [info, popularity, rankingStatus] = await Promise.all([
    productInfo(db, [...ids]),
    loadPopularity(db, [...ids]),
    loadRankingStatus(db),
  ])
  const product = (id: number) => info.get(id) ?? removed(id)

  // ---- overview
  const totalVisits = visits.visits
  const returning = visits.returningVisits
  const ended = visits.endedVisits
  const bySource = new Map<string, { visits: number; enquiring: number; taps: number }>()
  const byCampaign = new Map<string, { source: string; campaign: string; visits: number; enquiring: number; taps: number }>()
  let journeyVisits = 0
  let whatsappTaps = 0
  let feedEnd = 0
  for (const r of journey) {
    journeyVisits += r.visits
    whatsappTaps += r.whatsappTaps
    feedEnd += r.feedEndVisits
    const src = bySource.get(r.source) ?? { visits: 0, enquiring: 0, taps: 0 }
    src.visits += r.visits
    src.enquiring += r.reachedWhatsapp
    src.taps += r.whatsappTaps
    bySource.set(r.source, src)
    if (r.campaign) {
      const key = `${r.source}\u0000${r.campaign}`
      const c = byCampaign.get(key) ?? { source: r.source, campaign: r.campaign, visits: 0, enquiring: 0, taps: 0 }
      c.visits += r.visits
      c.enquiring += r.reachedWhatsapp
      c.taps += r.whatsappTaps
      byCampaign.set(key, c)
    }
  }
  const sourceRows = [...bySource.entries()]
    .map(([source, s]) => ({
      source,
      visits: s.visits,
      enquiringVisits: s.enquiring,
      whatsappTaps: s.taps,
      share: ratio(s.visits, journeyVisits),
      enough: s.visits >= THRESHOLDS.visits,
    }))
    .sort((a, b) => b.visits - a.visits || a.source.localeCompare(b.source))

  const overview: Overview = {
    visits: totalVisits,
    newVisits: totalVisits - returning,
    returningVisits: returning,
    endedVisits: ended,
    looksPerVisit: ratio(visits.looksSeen, ended),
    avgSeconds: ratio(visits.totalSeconds, ended),
    bounceRate: ratio(visits.bounces, ended),
    whatsappTaps,
    enquiringVisits: visits.enquiringVisits,
    restockRequests: pieces.reduce((t, r) => t + r.restockRequests, 0),
    topSources: sourceRows.map((s) => ({ source: s.source, visits: s.visits, share: s.share })),
    enough: totalVisits >= THRESHOLDS.visits,
  }

  // ---- top looks
  const pieceViewers = new Map<number, number>()
  const lookRows: LookRow[] = pieces.map((s) => {
    const p = product(s.productId)
    pieceViewers.set(s.productId, s.viewers)
    return {
      productId: s.productId,
      name: p.name,
      slug: p.slug,
      thumbnail: urlFor(p.coverKey),
      views: s.views,
      viewers: s.viewers,
      meanDwell: ratio(s.dwellSeconds, s.dwellCount),
      photoSwipeRate: ratio(s.photoSwipers, s.viewers),
      detailsRate: ratio(s.detailsShows, s.views),
      // productOpens = distinct visits that opened it (OPEN_TYPES), per visit that saw it.
      openRate: ratio(s.productOpens, s.viewers),
      whatsapp: s.enquiries,
      shares: s.shares,
      restockRequests: s.restockRequests,
      hearts: s.loveOn - s.loveOff,
      popularity: popularity.get(s.productId)?.score ?? null,
      rank: popularity.get(s.productId)?.rank ?? null,
      scoreParts: popularity.get(s.productId)?.parts ?? null,
      coldStart: popularity.get(s.productId)?.coldStart ?? false,
      autoFeatured: popularity.get(s.productId)?.featured ?? false,
      enough: s.views >= THRESHOLDS.lookViews,
    }
  })
  const hasHearts = pieces.some((r) => r.loveOn > 0 || r.loveOff > 0)
  lookRows.sort((a, b) => Number(b.enough) - Number(a.enough) || b.views - a.views || a.name.localeCompare(b.name))
  const lookRowsWithData = lookRows.filter((r) => r.views > 0 || r.whatsapp > 0 || r.restockRequests > 0 || r.shares > 0)

  // ---- photos per piece
  const photosByPiece = new Map<number, Map<string, { index: number; indexViews: number; image: string; views: number; viewers: number; secs: number; dwells: number }>>()
  for (const r of photos) {
    const key = r.image || `#${r.photoIndex}`
    const perPiece = photosByPiece.get(r.productId) ?? new Map()
    const cur = perPiece.get(key) ?? { index: r.photoIndex, indexViews: -1, image: r.image, views: 0, viewers: 0, secs: 0, dwells: 0 }
    // The same image seen at another position (photos reordered): keep the position it was seen at most.
    if (r.views > cur.indexViews) {
      cur.index = r.photoIndex
      cur.indexViews = r.views
    }
    cur.views += r.views
    cur.viewers += r.viewers
    cur.secs += r.dwellSeconds
    cur.dwells += r.dwellCount
    perPiece.set(key, cur)
    photosByPiece.set(r.productId, perPiece)
  }
  const photoReport: PiecePhotos[] = [...photosByPiece.entries()].map(([productId, perPiece]) => {
    const p = product(productId)
    const list = [...perPiece.values()]
    const viewers = Math.max(pieceViewers.get(productId) ?? 0, ...list.map((x) => x.viewers))
    const coverFile = p.coverKey ? fileName(p.coverKey) : null
    const rows: PhotoRow[] = list
      .map((x) => {
        const key = x.image ? p.keyByFile.get(x.image) : undefined
        return {
          index: x.index,
          image: x.image,
          url: urlFor(key),
          views: x.views,
          viewers: x.viewers,
          dwellCount: x.dwells,
          meanSeconds: ratio(x.secs, x.dwells),
          reach: ratio(x.viewers, viewers),
          isCover: x.image ? x.image === coverFile : x.index === 1,
          enough: x.dwells >= THRESHOLDS.photoDwells,
        }
      })
      .sort((a, b) => a.index - b.index || a.image.localeCompare(b.image))
    const ranked = rows.filter((r) => r.enough && r.meanSeconds !== null)
    const best = ranked.reduce<PhotoRow | null>((top, r) => (!top || (r.meanSeconds ?? 0) > (top.meanSeconds ?? 0) ? r : top), null)
    const cover = rows.find((r) => r.isCover)
    const suggest =
      best && ranked.length >= 2 && !best.isCover && (!cover || cover.meanSeconds === null || (best.meanSeconds ?? 0) > cover.meanSeconds)
    return {
      productId,
      name: p.name,
      slug: p.slug,
      viewers,
      photos: rows,
      bestCover:
        suggest && best
          ? {
              image: best.image,
              index: best.index,
              url: best.url,
              meanSeconds: best.meanSeconds ?? 0,
              imageId: (best.image && p.idByFile.get(best.image)) || null,
            }
          : null,
    }
  })
  photoReport.sort((a, b) => b.viewers - a.viewers || a.name.localeCompare(b.name))

  // ---- videos
  const videoRows: VideoRow[] = videos
    .map((s) => {
      const p = product(s.productId)
      return {
        productId: s.productId,
        name: p.name,
        slug: p.slug,
        thumbnail: urlFor(p.coverKey),
        starts: s.starts,
        viewers: s.viewers,
        completion: [ratio(s.reached25, s.starts), ratio(s.reached50, s.starts), ratio(s.reached75, s.starts), ratio(s.reached100, s.starts)] as VideoRow['completion'],
        avgSeconds: ratio(s.watchSeconds, s.starts),
        replays: s.replays,
        enough: s.starts >= THRESHOLDS.videoStarts,
      }
    })
    .filter((v) => v.starts > 0)
    .sort((a, b) => Number(b.enough) - Number(a.enough) || b.starts - a.starts || a.name.localeCompare(b.name))

  // ---- funnel
  const segment = (key: string, rows: JourneySums[]): FunnelSegment => {
    const counts = [0, 0, 0, 0, 0, 0]
    for (const r of rows) {
      counts[0] += r.visits
      counts[1] += r.reachedSecondLook
      counts[2] += r.reachedDetails
      counts[3] += r.reachedOpen
      counts[4] += r.reachedSize
      counts[5] += r.reachedWhatsapp
    }
    const lost = counts.map((c, i) => (i === 0 || counts[i - 1] === 0 ? null : 1 - c / counts[i - 1]))
    return { key, counts, lost, enough: counts[0] >= THRESHOLDS.visits }
  }
  const segments = (key: (r: JourneySums) => string) => {
    const m = new Map<string, JourneySums[]>()
    for (const r of journey) m.set(key(r), [...(m.get(key(r)) ?? []), r])
    return [...m.entries()].map(([k, rows]) => segment(k, rows))
  }
  const deviceOrder = (k: string) => {
    const i = (DEVICE_CLASSES as readonly string[]).indexOf(k)
    return i === -1 ? 99 : i
  }
  const funnel: Funnel = {
    steps: FUNNEL_STEPS,
    all: segment('all', journey),
    byDevice: segments((r) => r.deviceClass).sort((a, b) => deviceOrder(a.key) - deviceOrder(b.key)),
    bySource: segments((r) => r.source).sort((a, b) => b.counts[0] - a.counts[0] || a.key.localeCompare(b.key)),
  }

  // ---- feed depth
  const depthVisits = depth.reduce((t, r) => t + r.visits, 0)
  const deepest = depth.reduce((m, r) => (r.visits > 0 ? Math.max(m, r.looks) : m), 0)
  const reach: Depth['reach'] = []
  for (let look = 1; look <= deepest; look += 1) {
    const v = depth.reduce((t, r) => (r.looks >= look ? t + r.visits : t), 0)
    reach.push({ look, visits: v, share: ratio(v, depthVisits) })
  }
  const depthReport: Depth = {
    visits: depthVisits,
    reach,
    capped: deepest >= MAX_DEPTH,
    endOfFeedVisits: feedEnd,
    endOfFeedRate: ratio(feedEnd, journeyVisits),
  }

  // ---- demand
  const optionsByPiece = new Map<number, { sizes: OptionCount[]; colours: OptionCount[] }>()
  for (const r of options) {
    const entry = optionsByPiece.get(r.productId) ?? { sizes: [], colours: [] }
    const row = { value: r.value, selects: r.selects, enquiries: r.enquiries, restockRequests: r.restockRequests }
    ;(r.kind === 'colour' ? entry.colours : entry.sizes).push(row)
    optionsByPiece.set(r.productId, entry)
  }
  const weight = (o: OptionCount) => o.selects + o.enquiries + o.restockRequests
  const byWeight = (a: OptionCount, b: OptionCount) => weight(b) - weight(a) || a.value.localeCompare(b.value)
  const demand: Demand = {
    soldOut: pieces
      .filter((r) => r.restockRequests > 0)
      .map((r) => {
        const p = product(r.productId)
        const sizes = (optionsByPiece.get(r.productId)?.sizes ?? [])
          .filter((s) => s.restockRequests > 0)
          .map((s) => ({ value: s.value, count: s.restockRequests }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        return { productId: r.productId, name: p.name, slug: p.slug, thumbnail: urlFor(p.coverKey), soldOutNow: p.soldOut, restockRequests: r.restockRequests, sizes }
      })
      .sort((a, b) => b.restockRequests - a.restockRequests || a.name.localeCompare(b.name)),
    options: [...optionsByPiece.entries()]
      .map(([productId, o]) => {
        const p = product(productId)
        return { productId, name: p.name, slug: p.slug, sizes: [...o.sizes].sort(byWeight), colours: [...o.colours].sort(byWeight) }
      })
      .filter((o) => o.sizes.some((s) => s.selects + s.enquiries > 0) || o.colours.some((s) => s.selects + s.enquiries > 0))
      .sort((a, b) => {
        const total = (x: typeof a) => [...x.sizes, ...x.colours].reduce((t, o) => t + weight(o), 0)
        return total(b) - total(a) || a.name.localeCompare(b.name)
      }),
    askForPrice: pieces
      .filter((r) => product(r.productId).askForPrice && (r.views > 0 || r.enquiries > 0))
      .map((r) => {
        const p = product(r.productId)
        return { productId: r.productId, name: p.name, slug: p.slug, views: r.views, enquiries: r.enquiries, rate: ratio(r.enquiries, r.views) }
      })
      .sort((a, b) => b.enquiries - a.enquiries || b.views - a.views || a.name.localeCompare(b.name)),
  }

  // ---- sources & timing
  const sources: Sources = {
    bySource: sourceRows,
    byCampaign: [...byCampaign.values()]
      .map((c) => ({ source: c.source, campaign: c.campaign, visits: c.visits, enquiringVisits: c.enquiring, whatsappTaps: c.taps, enough: c.visits >= THRESHOLDS.visits }))
      .sort((a, b) => b.visits - a.visits || a.campaign.localeCompare(b.campaign) || a.source.localeCompare(b.source)),
    heatmap: heat
      .filter((c) => c.visits > 0)
      .map((c) => ({ weekday: c.weekday, hour: c.hour, visits: c.visits, whatsappTaps: c.whatsappTaps }))
      .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour),
  }

  // ---- health
  const perDay = new Map<string, { slowLoads: number; loadErrors: number; failedActions: number }>()
  const perDetail = new Map<string, { kind: string; detail: string; events: number; visits: number }>()
  for (const r of health) {
    const d = perDay.get(r.day) ?? { slowLoads: 0, loadErrors: 0, failedActions: 0 }
    if (r.kind === 'slow_load') d.slowLoads += r.events
    else if (r.kind === 'load_error') d.loadErrors += r.events
    else if (r.kind === 'action_failed') d.failedActions += r.events
    perDay.set(r.day, d)
    const key = `${r.kind}\u0000${r.detail}`
    const x = perDetail.get(key) ?? { kind: r.kind, detail: r.detail, events: 0, visits: 0 }
    x.events += r.events
    x.visits += r.visits
    perDetail.set(key, x)
  }
  const healthDays = range.days <= HEALTH_ALL_DAYS ? rangeDays(range) : [...perDay.keys()].sort()
  const healthReport: Health = {
    days: healthDays.map((day) => ({ day, ...(perDay.get(day) ?? { slowLoads: 0, loadErrors: 0, failedActions: 0 }) })),
    byDetail: [...perDetail.values()].sort((a, b) => b.events - a.events || a.kind.localeCompare(b.kind) || a.detail.localeCompare(b.detail)),
  }

  return {
    range: {
      ...range,
      liveDays: meta.liveDays,
      liveUnavailable: meta.unavailable,
      notRecalculated: meta.notRecalculated,
      generatedAt: now.toISOString(),
    },
    thresholds: THRESHOLDS,
    overview,
    looks: { rows: lookRowsWithData, hasHearts, ranking: rankingStatus },
    photos: photoReport,
    videos: videoRows,
    funnel,
    depth: depthReport,
    demand,
    sources,
    health: healthReport,
  }
}
