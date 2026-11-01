// ZP-505: the Insights report. Server only.
//
// Reads the daily ROLLUP tables only (never raw events): one grouped,
// day-indexed query per table plus one product query, so the cost does not
// grow with the number of pieces (no N+1).
//
// "Today" (and yesterday, until the nightly job has rolled it up) is not in
// the rollups yet. For those days the SAME rollup statements
// (rollupDayInTransaction) run inside a transaction that is always rolled
// back: the page sees exactly the numbers the nightly job will store, and
// nothing is written. The work is bounded by the (day, type) index to one or
// two days of raw events and by a statement timeout.
import type { Prisma, PrismaClient } from '@prisma/client'
import { addDays, analyticsDay, dayToDate, DEVICE_CLASSES } from '@/lib/analytics/events'
import { MAX_DEPTH, rollupDayInTransaction } from '@/lib/analytics/rollup'
import { displayName } from '@/lib/storefront-model'
import { imageUrlForKey, isValidImageKey } from '@/lib/storage/keys'
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
  type PiecePhotos,
  type PhotoRow,
  type Sources,
  type VideoRow,
} from './types'

export { THRESHOLDS } from './types'

type Q = Prisma.TransactionClient

/** Live days: 30 s for the whole answer, 20 s per statement. */
export const LIVE_TRANSACTION = { timeout: 30_000, maxWait: 10_000 }
export const LIVE_STATEMENT_TIMEOUT = '20s'
/** Health lists every day (zeros included) up to this range length; longer ranges list only days with problems. */
const HEALTH_ALL_DAYS = 31

class Rollback {
  constructor(readonly report: InsightsReport) {}
}

/**
 * Days of the range the rollups do not have yet: today, and yesterday when
 * the nightly job has not rolled it up (no visits row) but raw events exist.
 */
export async function liveDaysFor(db: Q, range: Pick<InsightsRange, 'from' | 'to'>, now: Date): Promise<string[]> {
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

export async function loadInsights(db: PrismaClient, range: InsightsRange, options: { now?: Date } = {}): Promise<InsightsReport> {
  const now = options.now ?? new Date()
  const liveDays = await liveDaysFor(db, range, now)
  if (liveDays.length === 0) return readReport(db, range, liveDays, now)
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${LIVE_STATEMENT_TIMEOUT}'`)
      for (const day of liveDays) await rollupDayInTransaction(tx, day)
      // Throwing rolls the transaction back: the live rollup rows are never stored.
      throw new Rollback(await readReport(tx, range, liveDays, now))
    }, LIVE_TRANSACTION)
  } catch (error) {
    if (error instanceof Rollback) return error.report
    throw error
  }
  throw new Error('unreachable: the live transaction always rolls back')
}

// ------------------------------------------------------------------ helpers

const n = (v: number | null | undefined) => v ?? 0
const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const fileName = (key: string) => key.slice(key.lastIndexOf('/') + 1)
const urlFor = (key: string | undefined) => (key && isValidImageKey(key) ? imageUrlForKey(key) : null)

type ProductInfo = {
  id: number
  name: string
  slug: string
  soldOut: boolean
  askForPrice: boolean
  coverKey: string | undefined
  keyByFile: Map<string, string>
}

function removed(id: number): ProductInfo {
  return { id, name: `Removed piece #${id}`, slug: '', soldOut: false, askForPrice: false, coverKey: undefined, keyByFile: new Map() }
}

async function productInfo(q: Q, ids: number[]): Promise<Map<number, ProductInfo>> {
  if (ids.length === 0) return new Map()
  const products = await q.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      productName: true,
      publicName: true,
      slug: true,
      currentQuantity: true,
      priceDisplay: true,
      images: { select: { imageKey: true, isPrimary: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
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
        },
      ]
    }),
  )
}

// ------------------------------------------------------------------ the report

async function readReport(q: Q, range: InsightsRange, liveDays: string[], now: Date): Promise<InsightsReport> {
  const where = { day: { gte: dayToDate(range.from), lte: dayToDate(range.to) } }
  const visits = await q.analyticsDailyVisits.aggregate({
    where,
    _sum: { visits: true, returningVisits: true, endedVisits: true, bounces: true, totalSeconds: true, looksSeen: true, enquiringVisits: true },
  })
  const journey = await q.analyticsDailyJourney.groupBy({
    by: ['source', 'deviceClass', 'campaign'],
    where,
    _sum: {
      visits: true,
      reachedSecondLook: true,
      reachedDetails: true,
      reachedOpen: true,
      reachedSize: true,
      reachedWhatsapp: true,
      feedEndVisits: true,
      whatsappTaps: true,
    },
  })
  const pieces = await q.analyticsDailyPiece.groupBy({
    by: ['productId'],
    where,
    _sum: {
      views: true,
      viewers: true,
      dwellSeconds: true,
      dwellCount: true,
      detailsShows: true,
      productOpens: true,
      enquiries: true,
      restockRequests: true,
      shares: true,
      loveOn: true,
      loveOff: true,
      photoSwipers: true,
    },
  })
  const photos = await q.analyticsDailyPhoto.groupBy({
    by: ['productId', 'photoIndex', 'image'],
    where,
    _sum: { views: true, viewers: true, dwellSeconds: true, dwellCount: true },
  })
  const videos = await q.analyticsDailyVideo.groupBy({
    by: ['productId'],
    where,
    _sum: { starts: true, viewers: true, replays: true, reached25: true, reached50: true, reached75: true, reached100: true, watchSeconds: true },
  })
  const depth = await q.analyticsDailyDepth.groupBy({ by: ['looks'], where, _sum: { visits: true } })
  const heat = (await q.$queryRaw`
    SELECT EXTRACT(ISODOW FROM day)::int AS weekday, hour, SUM(visits)::int AS visits, SUM("whatsappTaps")::int AS taps
    FROM "AnalyticsDailyHour"
    WHERE day BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY 1, 2
    ORDER BY 1, 2`) as Array<{ weekday: number; hour: number; visits: number; taps: number }>
  const health = await q.analyticsDailyHealth.groupBy({ by: ['day', 'kind', 'detail'], where, _sum: { events: true, visits: true } })
  const options = await q.analyticsDailyOption.groupBy({
    by: ['productId', 'kind', 'value'],
    where,
    _sum: { selects: true, enquiries: true, restockRequests: true },
  })

  const ids = new Set<number>()
  for (const r of pieces) ids.add(r.productId)
  for (const r of photos) ids.add(r.productId)
  for (const r of videos) ids.add(r.productId)
  for (const r of options) ids.add(r.productId)
  const info = await productInfo(q, [...ids])
  const product = (id: number) => info.get(id) ?? removed(id)

  // ---- overview
  const totalVisits = n(visits._sum.visits)
  const returning = n(visits._sum.returningVisits)
  const ended = n(visits._sum.endedVisits)
  const bySource = new Map<string, { visits: number; enquiring: number; taps: number }>()
  const byCampaign = new Map<string, { source: string; campaign: string; visits: number; enquiring: number; taps: number }>()
  let journeyVisits = 0
  let whatsappTaps = 0
  let feedEnd = 0
  for (const r of journey) {
    const s = r._sum
    journeyVisits += n(s.visits)
    whatsappTaps += n(s.whatsappTaps)
    feedEnd += n(s.feedEndVisits)
    const src = bySource.get(r.source) ?? { visits: 0, enquiring: 0, taps: 0 }
    src.visits += n(s.visits)
    src.enquiring += n(s.reachedWhatsapp)
    src.taps += n(s.whatsappTaps)
    bySource.set(r.source, src)
    if (r.campaign) {
      const key = `${r.source}\u0000${r.campaign}`
      const c = byCampaign.get(key) ?? { source: r.source, campaign: r.campaign, visits: 0, enquiring: 0, taps: 0 }
      c.visits += n(s.visits)
      c.enquiring += n(s.reachedWhatsapp)
      c.taps += n(s.whatsappTaps)
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
    looksPerVisit: ratio(n(visits._sum.looksSeen), ended),
    avgSeconds: ratio(n(visits._sum.totalSeconds), ended),
    bounceRate: ratio(n(visits._sum.bounces), ended),
    whatsappTaps,
    enquiringVisits: n(visits._sum.enquiringVisits),
    restockRequests: pieces.reduce((t, r) => t + n(r._sum.restockRequests), 0),
    topSources: sourceRows.map((s) => ({ source: s.source, visits: s.visits, share: s.share })),
    enough: totalVisits >= THRESHOLDS.visits,
  }

  // ---- top looks
  const pieceViewers = new Map<number, number>()
  const lookRows: LookRow[] = pieces.map((r) => {
    const s = r._sum
    const p = product(r.productId)
    const views = n(s.views)
    const viewers = n(s.viewers)
    pieceViewers.set(r.productId, viewers)
    return {
      productId: r.productId,
      name: p.name,
      slug: p.slug,
      thumbnail: urlFor(p.coverKey),
      views,
      viewers,
      meanDwell: ratio(n(s.dwellSeconds), n(s.dwellCount)),
      photoSwipeRate: ratio(n(s.photoSwipers), viewers),
      detailsRate: ratio(n(s.detailsShows), views),
      openRate: ratio(n(s.productOpens), views),
      whatsapp: n(s.enquiries),
      shares: n(s.shares),
      restockRequests: n(s.restockRequests),
      hearts: n(s.loveOn) - n(s.loveOff),
      popularity: null,
      enough: views >= THRESHOLDS.lookViews,
    }
  })
  const hasHearts = pieces.some((r) => n(r._sum.loveOn) > 0 || n(r._sum.loveOff) > 0)
  lookRows.sort((a, b) => Number(b.enough) - Number(a.enough) || b.views - a.views || a.name.localeCompare(b.name))
  const lookRowsWithData = lookRows.filter((r) => r.views > 0 || r.whatsapp > 0 || r.restockRequests > 0 || r.shares > 0)

  // ---- photos per piece
  const photosByPiece = new Map<number, Map<string, { index: number; indexViews: number; image: string; views: number; viewers: number; secs: number; dwells: number }>>()
  for (const r of photos) {
    const key = r.image || `#${r.photoIndex}`
    const perPiece = photosByPiece.get(r.productId) ?? new Map()
    const cur = perPiece.get(key) ?? { index: r.photoIndex, indexViews: -1, image: r.image, views: 0, viewers: 0, secs: 0, dwells: 0 }
    const views = n(r._sum.views)
    // The same image seen at another position (photos reordered): keep the position it was seen at most.
    if (views > cur.indexViews) {
      cur.index = r.photoIndex
      cur.indexViews = views
    }
    cur.views += views
    cur.viewers += n(r._sum.viewers)
    cur.secs += n(r._sum.dwellSeconds)
    cur.dwells += n(r._sum.dwellCount)
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
      bestCover: suggest && best ? { image: best.image, index: best.index, url: best.url, meanSeconds: best.meanSeconds ?? 0 } : null,
    }
  })
  photoReport.sort((a, b) => b.viewers - a.viewers || a.name.localeCompare(b.name))

  // ---- videos
  const videoRows: VideoRow[] = videos
    .map((r) => {
      const s = r._sum
      const p = product(r.productId)
      const starts = n(s.starts)
      return {
        productId: r.productId,
        name: p.name,
        slug: p.slug,
        thumbnail: urlFor(p.coverKey),
        starts,
        viewers: n(s.viewers),
        completion: [ratio(n(s.reached25), starts), ratio(n(s.reached50), starts), ratio(n(s.reached75), starts), ratio(n(s.reached100), starts)] as VideoRow['completion'],
        avgSeconds: ratio(n(s.watchSeconds), starts),
        replays: n(s.replays),
        enough: starts >= THRESHOLDS.videoStarts,
      }
    })
    .filter((v) => v.starts > 0)
    .sort((a, b) => Number(b.enough) - Number(a.enough) || b.starts - a.starts || a.name.localeCompare(b.name))

  // ---- funnel
  const segment = (key: string, rows: typeof journey): FunnelSegment => {
    const counts = [0, 0, 0, 0, 0, 0]
    for (const r of rows) {
      const s = r._sum
      counts[0] += n(s.visits)
      counts[1] += n(s.reachedSecondLook)
      counts[2] += n(s.reachedDetails)
      counts[3] += n(s.reachedOpen)
      counts[4] += n(s.reachedSize)
      counts[5] += n(s.reachedWhatsapp)
    }
    const lost = counts.map((c, i) => (i === 0 || counts[i - 1] === 0 ? null : 1 - c / counts[i - 1]))
    return { key, counts, lost, enough: counts[0] >= THRESHOLDS.visits }
  }
  const groupBy = (key: (r: (typeof journey)[number]) => string) => {
    const m = new Map<string, typeof journey>()
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
    byDevice: groupBy((r) => r.deviceClass).sort((a, b) => deviceOrder(a.key) - deviceOrder(b.key)),
    bySource: groupBy((r) => r.source).sort((a, b) => b.counts[0] - a.counts[0] || a.key.localeCompare(b.key)),
  }

  // ---- feed depth
  const depthVisits = depth.reduce((t, r) => t + n(r._sum.visits), 0)
  const deepest = depth.reduce((m, r) => (n(r._sum.visits) > 0 ? Math.max(m, r.looks) : m), 0)
  const reach: Depth['reach'] = []
  for (let look = 1; look <= deepest; look += 1) {
    const v = depth.reduce((t, r) => (r.looks >= look ? t + n(r._sum.visits) : t), 0)
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
    const row = { value: r.value, selects: n(r._sum.selects), enquiries: n(r._sum.enquiries), restockRequests: n(r._sum.restockRequests) }
    ;(r.kind === 'colour' ? entry.colours : entry.sizes).push(row)
    optionsByPiece.set(r.productId, entry)
  }
  const weight = (o: OptionCount) => o.selects + o.enquiries + o.restockRequests
  const byWeight = (a: OptionCount, b: OptionCount) => weight(b) - weight(a) || a.value.localeCompare(b.value)
  const demand: Demand = {
    soldOut: pieces
      .filter((r) => n(r._sum.restockRequests) > 0)
      .map((r) => {
        const p = product(r.productId)
        const sizes = (optionsByPiece.get(r.productId)?.sizes ?? [])
          .filter((s) => s.restockRequests > 0)
          .map((s) => ({ value: s.value, count: s.restockRequests }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        return { productId: r.productId, name: p.name, slug: p.slug, thumbnail: urlFor(p.coverKey), soldOutNow: p.soldOut, restockRequests: n(r._sum.restockRequests), sizes }
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
      .filter((r) => product(r.productId).askForPrice && (n(r._sum.views) > 0 || n(r._sum.enquiries) > 0))
      .map((r) => {
        const p = product(r.productId)
        return { productId: r.productId, name: p.name, slug: p.slug, views: n(r._sum.views), enquiries: n(r._sum.enquiries), rate: ratio(n(r._sum.enquiries), n(r._sum.views)) }
      })
      .sort((a, b) => b.enquiries - a.enquiries || b.views - a.views || a.name.localeCompare(b.name)),
  }

  // ---- sources & timing
  const sources: Sources = {
    bySource: sourceRows,
    byCampaign: [...byCampaign.values()]
      .map((c) => ({ source: c.source, campaign: c.campaign, visits: c.visits, enquiringVisits: c.enquiring, whatsappTaps: c.taps, enough: c.visits >= THRESHOLDS.visits }))
      .sort((a, b) => b.visits - a.visits || a.campaign.localeCompare(b.campaign)),
    heatmap: heat.filter((c) => c.visits > 0).map((c) => ({ weekday: c.weekday, hour: c.hour, visits: c.visits, whatsappTaps: c.taps })),
  }

  // ---- health
  const perDay = new Map<string, { slowLoads: number; loadErrors: number; failedActions: number }>()
  const perDetail = new Map<string, { kind: string; detail: string; events: number; visits: number }>()
  for (const r of health) {
    const day = dayKey(r.day)
    const d = perDay.get(day) ?? { slowLoads: 0, loadErrors: 0, failedActions: 0 }
    const events = n(r._sum.events)
    if (r.kind === 'slow_load') d.slowLoads += events
    else if (r.kind === 'load_error') d.loadErrors += events
    else if (r.kind === 'action_failed') d.failedActions += events
    perDay.set(day, d)
    const key = `${r.kind}\u0000${r.detail}`
    const x = perDetail.get(key) ?? { kind: r.kind, detail: r.detail, events: 0, visits: 0 }
    x.events += events
    x.visits += n(r._sum.visits)
    perDetail.set(key, x)
  }
  const healthDays = range.days <= HEALTH_ALL_DAYS ? rangeDays(range) : [...perDay.keys()].sort()
  const healthReport: Health = {
    days: healthDays.map((day) => ({ day, ...(perDay.get(day) ?? { slowLoads: 0, loadErrors: 0, failedActions: 0 }) })),
    byDetail: [...perDetail.values()].sort((a, b) => b.events - a.events || a.kind.localeCompare(b.kind)),
  }

  return {
    range: { ...range, liveDays, generatedAt: now.toISOString() },
    thresholds: THRESHOLDS,
    overview,
    looks: { rows: lookRowsWithData, hasHearts },
    photos: photoReport,
    videos: videoRows,
    funnel,
    depth: depthReport,
    demand,
    sources,
    health: healthReport,
  }
}
