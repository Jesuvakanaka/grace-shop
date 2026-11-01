// ZP-493: the nightly rollup (src/lib/analytics/rollup.ts) against DATABASE_URL.
// - Daily visits, per source/device/campaign, per piece, per photo, per video.
// - Visit metrics: latest (longest) visit_end per visit, even after midnight;
//   bounce = ended under 5 s having seen at most one look.
// - Idempotent (re-running a day replaces it) and backfills a date range.
// - Retention: raw events 90 days, rollups 25 months.
// - Arguments of `npm run analytics:rollup`.
// Uses analytics days in 2031 (far from real data) and products "ZP493R-*".
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import { randomUUID } from 'node:crypto'
import { addDays, analyticsDay, dayToDate } from '../src/lib/analytics/events'
import { parseRollupArgs, pruneAnalytics, rollupDay, runRollup } from '../src/lib/analytics/rollup'

const D = '2031-03-10'
const PREV = '2031-03-09'
const NEXT = '2031-03-11'
const VA = '5a5a5a5a-0000-4000-8000-00000000000a'
const VB = '5a5a5a5a-0000-4000-8000-00000000000b'
const VC = '5a5a5a5a-0000-4000-8000-00000000000c'
const VP = '5a5a5a5a-0000-4000-8000-00000000000d'
const D1 = '5d5d5d5d-0000-4000-8000-000000000001'
const D2 = '5d5d5d5d-0000-4000-8000-000000000002'
const IMG = `${'b'.repeat(32)}.webp`

let P1 = 0
let P2 = 0
const ROLLUP_TABLES = [
  'analyticsDailyVisits',
  'analyticsDailySource',
  'analyticsDailyPiece',
  'analyticsDailyPhoto',
  'analyticsDailyVideo',
] as const

// Harare is UTC+2: 08:00Z is 10:00 local.
function at(day: string, hhmm = '08:00') {
  return new Date(`${day}T${hhmm}:00Z`)
}
let seq = 0
function row(
  visitId: string,
  type: string,
  opts: { day?: string; time?: string; productId?: number; slug?: string; props?: Record<string, unknown>; device?: string | null } = {},
) {
  seq += 1
  const occurredAt = new Date(at(opts.day ?? D, opts.time).getTime() + seq * 1000)
  return {
    eventId: randomUUID(),
    visitId,
    deviceId: opts.device === undefined ? D1 : opts.device,
    type,
    occurredAt,
    day: dayToDate(analyticsDay(occurredAt)),
    page: '/',
    slug: opts.slug ?? null,
    productId: opts.productId ?? null,
    collection: null,
    props: (opts.props ?? {}) as object,
  }
}

async function cleanRollups() {
  const where = { day: { gte: dayToDate('2031-01-01'), lte: dayToDate('2034-12-31') } }
  for (const t of ROLLUP_TABLES) await (prisma[t] as unknown as { deleteMany(a: unknown): Promise<unknown> }).deleteMany({ where })
}
async function cleanup() {
  await prisma.analyticsEvent.deleteMany({ where: { visitId: { in: [VA, VB, VC, VP] } } })
  await cleanRollups()
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP493R-' } } })
}

before(async () => {
  await cleanup()
  P1 = (await prisma.product.create({ data: { itemNumber: 'ZP493R-1', productName: 'R1', slug: 'zp493r-one' } })).id
  P2 = (await prisma.product.create({ data: { itemNumber: 'ZP493R-2', productName: 'R2', slug: 'zp493r-two' } })).id
  const p1 = { productId: P1, slug: 'zp493r-one' }
  const p2 = { productId: P2, slug: 'zp493r-two' }
  await prisma.analyticsEvent.createMany({
    data: [
      // Visit A: Instagram phone, campaign "nov", enquires.
      row(VA, 'visit_start', { props: { ref: 'instagram', device: 'phone', campaign: 'nov', vw: 390, vh: 844, landing: '/', returning: false } }),
      row(VA, 'look_view', { ...p1, props: { position: 0 } }),
      row(VA, 'look_dwell', { ...p1, props: { seconds: 4 } }),
      row(VA, 'photo_view', { ...p1, props: { index: 1, of: 3, image: IMG } }),
      row(VA, 'photo_dwell', { ...p1, props: { index: 1, of: 3, image: IMG, seconds: 1.5 } }),
      row(VA, 'photo_dwell', { ...p1, props: { index: 2, of: 3, seconds: 2.5 } }),
      row(VA, 'video_start', p1),
      row(VA, 'video_progress', { ...p1, props: { pct: 25 } }),
      row(VA, 'video_progress', { ...p1, props: { pct: 50 } }),
      row(VA, 'video_seconds', { ...p1, props: { seconds: 7 } }),
      row(VA, 'video_replay', p1),
      row(VA, 'details_show', p1),
      row(VA, 'product_open', { ...p1, props: { from: 'feed' } }),
      row(VA, 'whatsapp_enquire', { ...p1, props: { screen: 'product' } }),
      row(VA, 'love_on', p1),
      row(VA, 'look_view', { ...p1, props: { position: 0 } }),
      row(VA, 'look_dwell', { ...p1, props: { seconds: 6 } }),
      row(VA, 'visit_end', { ...p1, props: { duration: 20, looks: 2 } }), // app switch, came back
      row(VA, 'look_view', { ...p2, props: { position: 1 } }),
      row(VA, 'look_dwell', { ...p2, props: { seconds: 2 } }),
      row(VA, 'visit_end', { ...p2, props: { duration: 40, looks: 3 } }),
      // Visit B: same phone again, direct, bounce.
      row(VB, 'visit_start', { props: { ref: 'direct', device: 'phone', vw: 390, vh: 844, landing: '/', returning: true } }),
      row(VB, 'look_view', { ...p1, props: { position: 0 } }),
      row(VB, 'visit_end', { ...p1, props: { duration: 3, looks: 1 } }),
      // Visit C: Google desktop, ends after midnight (next analytics day).
      row(VC, 'visit_start', { device: D2, time: '21:00', props: { ref: 'google', device: 'desktop', vw: 1280, vh: 800, landing: '/shop', returning: false } }),
      row(VC, 'visit_end', { device: D2, day: D, time: '22:30', props: { duration: 100, looks: 0 } }),
      // The day before.
      row(VP, 'visit_start', { day: PREV, device: null, props: { ref: 'tiktok', device: 'phone', vw: 1, vh: 1, landing: '/', returning: false } }),
    ],
  })
})
after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

describe('rollupDay', () => {
  test('visit C ended on the next analytics day (Harare midnight)', async () => {
    const end = await prisma.analyticsEvent.findFirst({ where: { visitId: VC, type: 'visit_end' } })
    assert.strictEqual(end!.day.toISOString().slice(0, 10), NEXT)
  })

  test('aggregates one day', async () => {
    await rollupDay(prisma, D)

    const visits = await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(D) } })
    assert.ok(visits)
    assert.deepStrictEqual(
      {
        visits: visits.visits,
        devices: visits.devices,
        returningVisits: visits.returningVisits,
        endedVisits: visits.endedVisits,
        bounces: visits.bounces,
        totalSeconds: visits.totalSeconds,
        looksSeen: visits.looksSeen,
        enquiringVisits: visits.enquiringVisits,
      },
      { visits: 3, devices: 2, returningVisits: 1, endedVisits: 3, bounces: 1, totalSeconds: 143, looksSeen: 4, enquiringVisits: 1 },
    )

    const sources = await prisma.analyticsDailySource.findMany({ where: { day: dayToDate(D) }, orderBy: { source: 'asc' } })
    assert.deepStrictEqual(
      sources.map((s) => [s.source, s.deviceClass, s.campaign, s.visits, s.bounces, s.enquiringVisits, s.totalSeconds]),
      [
        ['direct', 'phone', '', 1, 1, 0, 3],
        ['google', 'desktop', '', 1, 0, 0, 100],
        ['instagram', 'phone', 'nov', 1, 0, 1, 40],
      ],
    )

    const pieces = await prisma.analyticsDailyPiece.findMany({ where: { day: dayToDate(D) }, orderBy: { productId: 'asc' } })
    assert.strictEqual(pieces.length, 2)
    const [one, two] = pieces
    assert.strictEqual(one.productId, P1)
    assert.strictEqual(one.slug, 'zp493r-one')
    assert.deepStrictEqual(
      {
        views: one.views,
        viewers: one.viewers,
        dwellSeconds: one.dwellSeconds,
        dwellCount: one.dwellCount,
        photoViews: one.photoViews,
        videoStarts: one.videoStarts,
        detailsShows: one.detailsShows,
        productOpens: one.productOpens,
        enquiries: one.enquiries,
        restockRequests: one.restockRequests,
        shares: one.shares,
        loveOn: one.loveOn,
        loveOff: one.loveOff,
        exits: one.exits,
      },
      {
        views: 3, viewers: 2, dwellSeconds: 10, dwellCount: 2, photoViews: 1, videoStarts: 1, detailsShows: 1,
        productOpens: 1, enquiries: 1, restockRequests: 0, shares: 0, loveOn: 1, loveOff: 0, exits: 1,
      },
    )
    assert.deepStrictEqual([two.productId, two.views, two.viewers, two.dwellSeconds, two.exits], [P2, 1, 1, 2, 1])

    const photos = await prisma.analyticsDailyPhoto.findMany({ where: { day: dayToDate(D) }, orderBy: { photoIndex: 'asc' } })
    assert.deepStrictEqual(
      photos.map((p) => [p.productId, p.photoIndex, p.image, p.views, p.dwellSeconds, p.dwellCount]),
      [
        [P1, 1, IMG, 1, 1.5, 1],
        [P1, 2, '', 0, 2.5, 1],
      ],
    )

    const videos = await prisma.analyticsDailyVideo.findMany({ where: { day: dayToDate(D) } })
    assert.deepStrictEqual(
      videos.map((v) => [v.productId, v.starts, v.viewers, v.replays, v.reached25, v.reached50, v.reached75, v.reached100, v.watchSeconds]),
      [[P1, 1, 1, 1, 1, 1, 0, 0, 7]],
    )
  })

  test('is idempotent: running the day again gives the same rows', async () => {
    await rollupDay(prisma, D)
    await rollupDay(prisma, D)
    assert.strictEqual(await prisma.analyticsDailyPiece.count({ where: { day: dayToDate(D) } }), 2)
    assert.strictEqual(await prisma.analyticsDailySource.count({ where: { day: dayToDate(D) } }), 3)
    const visits = await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(D) } })
    assert.strictEqual(visits!.visits, 3)
  })

  test('a day without data gets a zero visits row and nothing else', async () => {
    await rollupDay(prisma, '2031-02-01')
    const v = await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate('2031-02-01') } })
    assert.strictEqual(v!.visits, 0)
    assert.strictEqual(await prisma.analyticsDailyPiece.count({ where: { day: dayToDate('2031-02-01') } }), 0)
  })
})

describe('runRollup', () => {
  test('backfills a date range', async () => {
    const result = await runRollup(prisma, { from: PREV, to: D, prune: false, now: at(NEXT) })
    assert.deepStrictEqual(result.days, [PREV, D])
    const prev = await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(PREV) } })
    assert.strictEqual(prev!.visits, 1)
    const src = await prisma.analyticsDailySource.findMany({ where: { day: dayToDate(PREV) } })
    assert.deepStrictEqual(src.map((s) => [s.source, s.deviceClass, s.campaign]), [['tiktok', 'phone', '']])
  })
})

describe('retention', () => {
  test('raw events are kept 90 days, rollups 25 months', async () => {
    // 90 days after D: raw events of D and earlier go, the visit_end of NEXT stays.
    const r1 = await pruneAnalytics(prisma, at('2031-06-09'))
    assert.ok(r1.rawDeleted >= 26)
    assert.deepStrictEqual(
      (await prisma.analyticsEvent.findMany({ where: { visitId: { in: [VA, VB, VC, VP] } } })).map((e) => e.type),
      ['visit_end'],
    )
    assert.ok(await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(D) } }), 'rollups kept')

    // 25 months after D: the rollups of D go, those of a later day stay.
    await rollupDay(prisma, '2031-04-11')
    await pruneAnalytics(prisma, at('2033-04-10')) // D is exactly 25 months old: still kept (PREV goes)
    assert.strictEqual(await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(PREV) } }), null)
    assert.ok(await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(D) } }))
    const r2 = await pruneAnalytics(prisma, at('2033-04-11'))
    assert.ok(r2.rollupsDeleted >= 1)
    assert.strictEqual(await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(D) } }), null)
    assert.strictEqual(await prisma.analyticsDailyPiece.count({ where: { day: dayToDate(D) } }), 0)
    assert.ok(await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate('2031-04-11') } }))
  })
})

describe('parseRollupArgs', () => {
  const now = new Date('2026-11-02T03:00:00Z') // 05:00 in Harare on 2 Nov
  test('default: yesterday AND the day before (late events, clock skew), with pruning', () => {
    assert.deepStrictEqual(parseRollupArgs([], now), { from: '2026-10-31', to: '2026-11-01', prune: true })
  })
  test('--date, --from/--to, --no-prune', () => {
    assert.deepStrictEqual(parseRollupArgs(['--date', '2026-10-15'], now), { from: '2026-10-15', to: '2026-10-15', prune: true })
    assert.deepStrictEqual(parseRollupArgs(['--from', '2026-10-01', '--to', '2026-10-31', '--no-prune'], now), {
      from: '2026-10-01',
      to: '2026-10-31',
      prune: false,
    })
  })
  test('refuses bad input', () => {
    for (const argv of [
      ['--date', '2026-13-01'],
      ['--date'],
      ['--from', '2026-10-31', '--to', '2026-10-01'],
      ['--from', '2026-10-01'],
      ['--what'],
      ['--from', '2024-01-01', '--to', '2026-10-01'],
      ['--date', '2026-08-01'], // older than the 90 days of raw events: would rebuild zeros
      ['--from', '2026-08-03', '--to', '2026-08-10'],
    ]) {
      assert.throws(() => parseRollupArgs(argv, now), Error, argv.join(' '))
    }
  })
})

describe('never rebuilds a day whose raw events are gone (review M2)', () => {
  const today = analyticsDay(new Date())
  const OLD = addDays(today, -(90 + 30)) // raw events already pruned
  const EMPTY = addDays(today, -40) // inside the window, but no raw events
  const cleanDays = async () => {
    for (const day of [OLD, EMPTY]) {
      await prisma.analyticsDailyVisits.deleteMany({ where: { day: dayToDate(day) } })
      await prisma.analyticsDailyPiece.deleteMany({ where: { day: dayToDate(day) } })
    }
  }
  before(cleanDays)
  after(cleanDays)

  test('a day older than the raw retention is skipped, its rollups untouched', async () => {
    await prisma.analyticsDailyVisits.create({ data: { day: dayToDate(OLD), visits: 42 } })
    await prisma.analyticsDailyPiece.create({ data: { day: dayToDate(OLD), productId: P1, slug: 'zp493r-one', views: 9 } })
    const result = await rollupDay(prisma, OLD)
    assert.strictEqual(result.status, 'skipped')
    assert.match(result.reason ?? '', /90 days/)
    assert.strictEqual((await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(OLD) } }))!.visits, 42)
    assert.strictEqual(await prisma.analyticsDailyPiece.count({ where: { day: dayToDate(OLD) } }), 1)
  })

  test('a day with no raw events but existing rollups is skipped, its rollups untouched', async () => {
    await prisma.analyticsDailyVisits.create({ data: { day: dayToDate(EMPTY), visits: 7 } })
    const result = await rollupDay(prisma, EMPTY)
    assert.strictEqual(result.status, 'skipped')
    assert.strictEqual((await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(EMPTY) } }))!.visits, 7)
  })

  test('runRollup reports skipped days and does not delete them', async () => {
    const result = await runRollup(prisma, { from: EMPTY, to: EMPTY, prune: false })
    assert.deepStrictEqual(result.skipped, [EMPTY])
    assert.strictEqual((await prisma.analyticsDailyVisits.findUnique({ where: { day: dayToDate(EMPTY) } }))!.visits, 7)
  })
})
