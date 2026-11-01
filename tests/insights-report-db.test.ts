// ZP-505: Insights report queries (src/lib/insights/report.ts) against DATABASE_URL.
// Raw events are seeded for two past days (rolled up) and "today" (not rolled
// up). Every number on the report is checked against SQL on the raw events.
// - Past ranges read rollups only.
// - "Today" is read live from raw events, read-only (review M1): the numbers
//   equal what the nightly rollup stores, and nothing is written.
// - The nightly job committing a live day mid-request never double counts (M2).
// - Days rolled up before the ZP-505 rollups are flagged (F1).
// - Small numbers are flagged ("too few to rank").
// Uses analytics days in 2036 and products "ZP505I-*".
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import prisma from '../src/lib/db'
import { addDays, analyticsDay, dayToDate } from '../src/lib/analytics/events'
import { rollupDay, ROLLUP_TABLES } from '../src/lib/analytics/rollup'
import { loadInsights, readInsights, THRESHOLDS } from '../src/lib/insights/report'
import { resetLiveCache } from '../src/lib/insights/live'
import type { InsightsRange } from '../src/lib/insights/range'

const D1 = '2036-08-04' // a Monday
const D2 = '2036-08-05'
const TODAY = '2036-08-08'
const NOW = new Date(`${TODAY}T10:00:00Z`) // 12:00 in Harare
const IMG_A = `${'a'.repeat(32)}.webp`
const IMG_B = `${'b'.repeat(32)}.webp`
const range = (from: string, to: string, preset: InsightsRange['preset'] = 'custom'): InsightsRange => ({
  preset,
  from,
  to,
  days: Math.round((dayToDate(to).getTime() - dayToDate(from).getTime()) / 86_400_000) + 1,
})

let P1 = 0
let P2 = 0
let P3 = 0
const visitIds: string[] = []
let seq = 0

type Ev = ReturnType<typeof ev>
function ev(visitId: string, day: string, hourUtc: number, type: string, opts: { productId?: number; slug?: string; props?: object } = {}) {
  seq += 1
  const occurredAt = new Date(new Date(`${day}T${String(hourUtc).padStart(2, '0')}:00:00Z`).getTime() + seq * 100)
  return {
    eventId: randomUUID(),
    visitId,
    deviceId: null,
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

/** n visits on `day`; visit i behaves by i (see the comments). */
function visits(day: string, n: number, offset: number): Ev[] {
  const out: Ev[] = []
  const p1 = { productId: P1, slug: 'zp505i-one' }
  const p2 = { productId: P2, slug: 'zp505i-two' }
  for (let i = 0; i < n; i += 1) {
    const v = randomUUID()
    visitIds.push(v)
    const k = i + offset
    const ref = ['instagram', 'direct', 'whatsapp'][k % 3]
    const device = k % 3 === 1 ? 'desktop' : 'phone'
    const hour = 6 + (k % 4) // 08:00..11:00 Harare
    const e = (type: string, opts?: Parameters<typeof ev>[4]) => out.push(ev(v, day, hour, type, opts))
    e('visit_start', {
      props: { ref, device, ...(ref === 'instagram' ? { campaign: 'bio' } : {}), vw: 390, vh: 800, landing: '/', returning: k % 2 === 1 },
    })
    e('look_view', { ...p1, props: { position: 0 } })
    e('look_dwell', { ...p1, props: { seconds: 2 + (k % 5) } })
    e('photo_view', { ...p1, props: { index: 1, of: 2, image: IMG_A } })
    e('photo_dwell', { ...p1, props: { index: 1, of: 2, image: IMG_A, seconds: 1 } })
    if (k % 2 === 0) {
      e('photo_view', { ...p1, props: { index: 2, of: 2, image: IMG_B } })
      e('photo_dwell', { ...p1, props: { index: 2, of: 2, image: IMG_B, seconds: 3 } })
    }
    if (k % 3 === 0) {
      e('video_start', p1)
      e('video_progress', { ...p1, props: { pct: 25 } })
      if (k % 6 === 0) e('video_progress', { ...p1, props: { pct: 50 } })
      e('video_seconds', { ...p1, props: { seconds: 4 } })
    }
    if (k % 4 === 0) {
      e('look_view', { ...p2, props: { position: 1 } })
      e('details_show', p2)
    }
    if (k % 5 === 0) {
      e('product_open', { ...p1, props: { from: 'feed' } })
      if (k % 10 === 0) {
        e('size_select', { ...p1, props: { size: 'M' } })
        e('whatsapp_enquire', { ...p1, props: { screen: 'product', size: 'M' } })
      }
    }
    if (k % 6 === 0) e('restock_request', { ...p2, props: { size: 'S' } })
    if (k % 7 === 0) e('slow_load', { props: { lcp: 5000 } })
    if (k === 0) e('feed_end_reached', { props: { looks: 2 } })
    e('visit_end', { props: { duration: 10 + k, looks: k % 4 === 0 ? 2 : 1 } })
  }
  return out
}

async function cleanup() {
  await prisma.analyticsEvent.deleteMany({ where: { day: { gte: dayToDate('2036-01-01'), lte: dayToDate('2036-12-31') } } })
  const where = { day: { gte: dayToDate('2036-01-01'), lte: dayToDate('2036-12-31') } }
  for (const t of ROLLUP_TABLES) {
    const key = (t[0].toLowerCase() + t.slice(1)) as 'analyticsDailyVisits'
    await (prisma[key] as unknown as { deleteMany(a: unknown): Promise<unknown> }).deleteMany({ where })
  }
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP505I-' } } })
}

before(async () => {
  resetLiveCache()
  await cleanup()
  P1 = (
    await prisma.product.create({
      data: {
        itemNumber: 'ZP505I-1',
        productName: 'Private name one',
        publicName: 'Linen dress',
        slug: 'zp505i-one',
        currentQuantity: 5,
        priceDisplay: 'ASK_FOR_PRICE',
        published: true,
        images: {
          create: [
            { imageKey: `products/${IMG_A}`, isPrimary: true, sortOrder: 0 },
            { imageKey: `products/${IMG_B}`, sortOrder: 1 },
          ],
        },
      },
    })
  ).id
  P2 = (
    await prisma.product.create({
      data: { itemNumber: 'ZP505I-2', productName: 'Two', slug: 'zp505i-two', currentQuantity: 0, priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 20, published: true },
    })
  ).id
  P3 = (await prisma.product.create({ data: { itemNumber: 'ZP505I-3', productName: 'Three', slug: 'zp505i-three' } })).id
  await prisma.analyticsEvent.createMany({ data: [...visits(D1, 30, 0), ...visits(D2, 12, 30), ...visits(TODAY, 6, 0)] })
  await rollupDay(prisma, D1)
  await rollupDay(prisma, D2)
})
after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function one<T = Record<string, number>>(sql: string, ...params: unknown[]): Promise<T> {
  const rows = (await prisma.$queryRawUnsafe(sql, ...params)) as T[]
  return rows[0]
}
const close = (a: number | null | undefined, b: number, msg?: string) =>
  assert.ok(a != null && Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} != ${b}`)

describe('past range (rollups only)', () => {
  const R = range(D1, D2)
  let report: Awaited<ReturnType<typeof loadInsights>>
  before(async () => {
    report = await loadInsights(prisma, R, { now: NOW })
  })

  test('not live, no personal data', () => {
    assert.deepStrictEqual(report.range.liveDays, [])
    const json = JSON.stringify(report)
    for (const v of visitIds) assert.ok(!json.includes(v), 'no visit ids')
    assert.ok(!json.includes('ZP505I-'), 'no private item numbers')
    assert.ok(!json.includes('Private name one'), 'public name preferred')
  })

  test('overview matches raw events', async () => {
    const raw = await one(
      `WITH s AS (SELECT "visitId", (props->>'returning')::boolean AS ret FROM "AnalyticsEvent" WHERE type = 'visit_start' AND day BETWEEN $1::date AND $2::date),
            e AS (SELECT DISTINCT ON ("visitId") "visitId", (props->>'duration')::float8 AS d, (props->>'looks')::int AS l
                  FROM "AnalyticsEvent" WHERE type = 'visit_end' AND "visitId" IN (SELECT "visitId" FROM s) ORDER BY "visitId", (props->>'duration')::float8 DESC)
       SELECT (SELECT COUNT(*) FROM s)::int AS visits,
              (SELECT COUNT(*) FROM s WHERE ret)::int AS returning,
              (SELECT AVG(d) FROM e)::float8 AS avg_seconds,
              (SELECT AVG(l) FROM e)::float8 AS looks_per_visit,
              (SELECT COUNT(*) FROM "AnalyticsEvent" WHERE type = 'whatsapp_enquire' AND "visitId" IN (SELECT "visitId" FROM s))::int AS taps,
              (SELECT COUNT(*) FROM "AnalyticsEvent" WHERE type = 'restock_request' AND day BETWEEN $1::date AND $2::date)::int AS restock`,
      D1,
      D2,
    )
    const o = report.overview
    assert.strictEqual(o.visits, raw.visits)
    assert.strictEqual(o.visits, 42)
    assert.strictEqual(o.returningVisits, raw.returning)
    assert.strictEqual(o.newVisits, raw.visits - raw.returning)
    close(o.avgSeconds, raw.avg_seconds, 'avg seconds')
    close(o.looksPerVisit, raw.looks_per_visit, 'looks per visit')
    assert.strictEqual(o.whatsappTaps, raw.taps)
    assert.strictEqual(o.restockRequests, raw.restock)
    const sources = Object.fromEntries(o.topSources.map((s) => [s.source, s.visits]))
    const rawSources = (await prisma.$queryRawUnsafe(
      `SELECT props->>'ref' AS source, COUNT(*)::int AS n FROM "AnalyticsEvent" WHERE type = 'visit_start' AND day BETWEEN $1::date AND $2::date GROUP BY 1`,
      D1,
      D2,
    )) as Array<{ source: string; n: number }>
    assert.deepStrictEqual(sources, Object.fromEntries(rawSources.map((s) => [s.source, s.n])))
  })

  test('top looks match raw events; small numbers are flagged', async () => {
    const p1 = report.looks.rows.find((r) => r.productId === P1)!
    const raw = await one(
      `SELECT COUNT(*) FILTER (WHERE type = 'look_view')::int AS views,
              (SUM((props->>'seconds')::float8) FILTER (WHERE type = 'look_dwell') / COUNT(*) FILTER (WHERE type = 'look_dwell'))::float8 AS dwell,
              (COUNT(DISTINCT "visitId") FILTER (WHERE type = 'photo_view' AND (props->>'index') <> '1'))::float8
                / COUNT(DISTINCT "visitId") FILTER (WHERE type = 'look_view') AS swipe,
              COUNT(*) FILTER (WHERE type = 'product_open')::float8 / COUNT(*) FILTER (WHERE type = 'look_view') AS open_rate,
              COUNT(*) FILTER (WHERE type = 'whatsapp_enquire')::int AS whatsapp
       FROM "AnalyticsEvent" WHERE "productId" = $1 AND day BETWEEN $2::date AND $3::date`,
      P1,
      D1,
      D2,
    )
    assert.strictEqual(p1.name, 'Linen dress')
    assert.strictEqual(p1.views, raw.views)
    close(p1.meanDwell, raw.dwell, 'mean dwell')
    close(p1.photoSwipeRate, raw.swipe, 'swipe rate')
    close(p1.openRate, raw.open_rate, 'open rate')
    assert.strictEqual(p1.whatsapp, raw.whatsapp)
    assert.strictEqual(p1.enough, true)
    assert.strictEqual(p1.popularity, null, 'filled by ZP-506')
    assert.strictEqual(p1.thumbnail, `/api/images/${IMG_A}`)
    const p2 = report.looks.rows.find((r) => r.productId === P2)!
    assert.ok(p2.views < THRESHOLDS.lookViews)
    assert.strictEqual(p2.enough, false)
    assert.ok(!report.looks.rows.some((r) => r.productId === P3), 'never seen: not listed')
    assert.strictEqual(report.looks.hasHearts, false)
  })

  test('photos: mean seconds, reach and the best cover suggestion', async () => {
    const piece = report.photos.find((p) => p.productId === P1)!
    const b = piece.photos.find((p) => p.image === IMG_B)!
    const raw = await one(
      `SELECT AVG((props->>'seconds')::float8) FILTER (WHERE type = 'photo_dwell' AND props->>'image' = $4)::float8 AS mean_b,
              (COUNT(DISTINCT "visitId") FILTER (WHERE type = 'photo_view' AND props->>'image' = $4))::float8
                / COUNT(DISTINCT "visitId") FILTER (WHERE type = 'look_view') AS reach_b
       FROM "AnalyticsEvent" WHERE "productId" = $1 AND day BETWEEN $2::date AND $3::date`,
      P1,
      D1,
      D2,
      IMG_B,
    )
    close(b.meanSeconds, raw.mean_b, 'photo mean')
    close(b.reach, raw.reach_b, 'photo reach')
    assert.strictEqual(b.url, `/api/images/${IMG_B}`)
    assert.strictEqual(piece.photos.find((p) => p.image === IMG_A)!.isCover, true)
    // B holds people 3 s against A's 1 s, with enough dwells: suggest it as the cover.
    assert.deepStrictEqual(piece.bestCover && { image: piece.bestCover.image, index: piece.bestCover.index }, { image: IMG_B, index: 2 })
  })

  test('videos match raw events', async () => {
    const v = report.videos.find((r) => r.productId === P1)!
    const raw = await one(
      `SELECT COUNT(*) FILTER (WHERE type = 'video_start')::int AS starts,
              (COUNT(*) FILTER (WHERE type = 'video_progress' AND props->>'pct' = '50'))::float8 / COUNT(*) FILTER (WHERE type = 'video_start') AS p50,
              (SUM((props->>'seconds')::float8) FILTER (WHERE type = 'video_seconds'))::float8 / COUNT(*) FILTER (WHERE type = 'video_start') AS avg_s
       FROM "AnalyticsEvent" WHERE "productId" = $1 AND day BETWEEN $2::date AND $3::date`,
      P1,
      D1,
      D2,
    )
    assert.strictEqual(v.starts, raw.starts)
    close(v.completion[1], raw.p50, 'p50')
    close(v.avgSeconds, raw.avg_s, 'avg s')
    assert.strictEqual(v.completion.length, 4)
  })

  test('funnel: furthest step per visit, overall and by device / source, matches raw events', async () => {
    const rawVisits = (await prisma.$queryRawUnsafe(
      `SELECT s.props->>'device' AS device, s.props->>'ref' AS source,
              CASE WHEN EXISTS (SELECT 1 FROM "AnalyticsEvent" x WHERE x."visitId" = s."visitId" AND x.type = 'whatsapp_enquire') THEN 5
                   WHEN EXISTS (SELECT 1 FROM "AnalyticsEvent" x WHERE x."visitId" = s."visitId" AND x.type = 'size_select') THEN 4
                   WHEN EXISTS (SELECT 1 FROM "AnalyticsEvent" x WHERE x."visitId" = s."visitId" AND x.type = 'product_open') THEN 3
                   WHEN EXISTS (SELECT 1 FROM "AnalyticsEvent" x WHERE x."visitId" = s."visitId" AND x.type = 'details_show') THEN 2
                   WHEN (SELECT MAX((props->>'looks')::int) FROM "AnalyticsEvent" x WHERE x."visitId" = s."visitId" AND x.type = 'visit_end') >= 2 THEN 1
                   ELSE 0 END AS step
       FROM "AnalyticsEvent" s WHERE s.type = 'visit_start' AND s.day BETWEEN $1::date AND $2::date`,
      D1,
      D2,
    )) as Array<{ device: string; source: string; step: number }>
    const counts = (rows: typeof rawVisits) => [0, 1, 2, 3, 4, 5].map((k) => rows.filter((r) => r.step >= k).length)
    assert.deepStrictEqual(report.funnel.all.counts, counts(rawVisits))
    const phone = report.funnel.byDevice.find((s) => s.key === 'phone')!
    assert.deepStrictEqual(phone.counts, counts(rawVisits.filter((r) => r.device === 'phone')))
    const ig = report.funnel.bySource.find((s) => s.key === 'instagram')!
    assert.deepStrictEqual(ig.counts, counts(rawVisits.filter((r) => r.source === 'instagram')))
    // % lost per step: 1 - this step / the step before.
    const c = report.funnel.all.counts
    close(report.funnel.all.lost[1], 1 - c[1] / c[0], 'lost step 1')
    assert.strictEqual(report.funnel.all.lost[0], null)
    assert.strictEqual(report.funnel.steps.length, 6)
    assert.strictEqual(report.funnel.all.enough, true)
    assert.strictEqual(report.funnel.byDevice.find((s) => s.key === 'desktop')!.enough, false, '14 desktop visits')
  })

  test('feed depth and end of feed', async () => {
    const two = report.depth.reach.find((r) => r.look === 2)!
    const raw = await one(
      `WITH s AS (SELECT "visitId" FROM "AnalyticsEvent" WHERE type = 'visit_start' AND day BETWEEN $1::date AND $2::date)
       SELECT (SELECT COUNT(DISTINCT "visitId") FROM "AnalyticsEvent" WHERE type = 'visit_end' AND (props->>'looks')::int >= 2 AND "visitId" IN (SELECT "visitId" FROM s))::int AS two,
              (SELECT COUNT(DISTINCT "visitId") FROM "AnalyticsEvent" WHERE type = 'feed_end_reached' AND "visitId" IN (SELECT "visitId" FROM s))::int AS ends`,
      D1,
      D2,
    )
    assert.strictEqual(two.visits, raw.two)
    close(two.share, raw.two / 42, 'share look 2')
    assert.strictEqual(report.depth.reach[0].look, 1)
    assert.strictEqual(report.depth.reach[0].share, 1)
    assert.strictEqual(report.depth.endOfFeedVisits, raw.ends)
  })

  test('demand: restock per sold-out piece by size, picked sizes, Ask-for-price enquiries', async () => {
    const restock = await one(
      `SELECT COUNT(*)::int AS n FROM "AnalyticsEvent" WHERE type = 'restock_request' AND "productId" = $1 AND props->>'size' = 'S' AND day BETWEEN $2::date AND $3::date`,
      P2,
      D1,
      D2,
    )
    const soldOut = report.demand.soldOut.find((r) => r.productId === P2)!
    assert.strictEqual(soldOut.restockRequests, restock.n)
    assert.deepStrictEqual(soldOut.sizes, [{ value: 'S', count: restock.n }])
    const p1Options = report.demand.options.find((r) => r.productId === P1)!
    const picks = await one(
      `SELECT COUNT(*)::int AS n FROM "AnalyticsEvent" WHERE type = 'size_select' AND "productId" = $1 AND day BETWEEN $2::date AND $3::date`,
      P1,
      D1,
      D2,
    )
    assert.strictEqual(p1Options.sizes[0].value, 'M')
    assert.strictEqual(p1Options.sizes[0].selects, picks.n)
    const ask = report.demand.askForPrice.find((r) => r.productId === P1)!
    assert.strictEqual(ask.enquiries, report.looks.rows.find((r) => r.productId === P1)!.whatsapp)
    assert.ok(!report.demand.askForPrice.some((r) => r.productId === P2), 'P2 shows its price')
  })

  test('sources, campaigns and the hour x weekday heatmap', async () => {
    const ig = report.sources.bySource.find((s) => s.source === 'instagram')!
    const raw = await one(
      `WITH s AS (SELECT "visitId" FROM "AnalyticsEvent" WHERE type = 'visit_start' AND props->>'ref' = 'instagram' AND day BETWEEN $1::date AND $2::date)
       SELECT (SELECT COUNT(*) FROM s)::int AS visits,
              (SELECT COUNT(*) FROM "AnalyticsEvent" WHERE type = 'whatsapp_enquire' AND "visitId" IN (SELECT "visitId" FROM s))::int AS taps`,
      D1,
      D2,
    )
    assert.strictEqual(ig.visits, raw.visits)
    assert.strictEqual(ig.whatsappTaps, raw.taps)
    assert.deepStrictEqual(
      report.sources.byCampaign.map((c) => [c.source, c.campaign, c.visits]),
      [['instagram', 'bio', raw.visits]],
    )
    // 2036-08-04 is a Monday (ISO weekday 1). Hours are Harare.
    const cells = (await prisma.$queryRawUnsafe(
      `SELECT EXTRACT(ISODOW FROM day)::int AS weekday,
              EXTRACT(HOUR FROM ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Harare')::int AS hour, COUNT(*)::int AS n
       FROM "AnalyticsEvent" WHERE type = 'visit_start' AND day BETWEEN $1::date AND $2::date GROUP BY 1, 2 ORDER BY 1, 2`,
      D1,
      D2,
    )) as Array<{ weekday: number; hour: number; n: number }>
    assert.deepStrictEqual(
      report.sources.heatmap.map((c) => [c.weekday, c.hour, c.visits]),
      cells.map((c) => [c.weekday, c.hour, c.n]),
    )
  })

  test('health per day matches raw events', async () => {
    const raw = await one(
      `SELECT COUNT(*)::int AS n FROM "AnalyticsEvent" WHERE type = 'slow_load' AND day = $1::date`,
      D1,
    )
    assert.strictEqual(report.health.days.find((d) => d.day === D1)!.slowLoads, raw.n)
    assert.deepStrictEqual(
      report.health.days.map((d) => d.day),
      [D1, D2],
      'every day of a short range is listed',
    )
  })
})

describe('today (live, read-only)', () => {
  before(() => resetLiveCache())

  test('today is computed from raw events and nothing is written', async () => {
    const report = await loadInsights(prisma, range(TODAY, TODAY, 'today'), { now: NOW })
    assert.deepStrictEqual(report.range.liveDays, [TODAY])
    assert.deepStrictEqual(report.range.liveUnavailable, [])
    const raw = await one(
      `SELECT COUNT(*) FILTER (WHERE type = 'visit_start')::int AS visits,
              COUNT(*) FILTER (WHERE type = 'look_view' AND "productId" = $2)::int AS views
       FROM "AnalyticsEvent" WHERE day = $1::date`,
      TODAY,
      P1,
    )
    assert.strictEqual(report.overview.visits, raw.visits)
    assert.strictEqual(report.overview.visits, 6)
    assert.strictEqual(report.looks.rows.find((r) => r.productId === P1)!.views, raw.views)
    assert.strictEqual(report.looks.rows.find((r) => r.productId === P1)!.enough, false, '6 views')
    for (const t of ROLLUP_TABLES) {
      const n = (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "${t}" WHERE day = $1::date`, TODAY)).n
      assert.strictEqual(n, 0, `${t}: nothing stored`)
    }
  })

  test('a range ending today adds the live day to the rollups', async () => {
    const report = await loadInsights(prisma, range(D1, TODAY, '7d'), { now: NOW })
    assert.deepStrictEqual(report.range.liveDays, [TODAY])
    assert.strictEqual(report.overview.visits, 48)
    assert.strictEqual(report.funnel.all.counts[0], 48)
  })

  test('yesterday is read live while the nightly job has not stored it, then from the rollups', async () => {
    resetLiveCache()
    const tomorrow = new Date(`${addDays(TODAY, 1)}T10:00:00Z`)
    const report = await loadInsights(prisma, range(TODAY, TODAY), { now: tomorrow })
    assert.deepStrictEqual(report.range.liveDays, [TODAY])
    assert.strictEqual(report.overview.visits, 6)
    await rollupDay(prisma, TODAY)
    const after = await loadInsights(prisma, range(TODAY, TODAY), { now: tomorrow })
    assert.deepStrictEqual(after.range.liveDays, [], 'rolled up: read from the rollups')
    assert.strictEqual(after.overview.visits, 6)
  })

  test('live numbers equal what the nightly job stored, for every report', async () => {
    // TODAY is rolled up now (previous test). Read it once live from raw events and once from the rollups.
    resetLiveCache()
    const R = range(TODAY, TODAY)
    const live = await readInsights(prisma, R, [TODAY], NOW)
    const stored = await readInsights(prisma, R, [], NOW)
    assert.deepStrictEqual(live.range.liveDays, [TODAY])
    const body = (r: typeof live) => ({ ...r, range: null })
    assert.deepStrictEqual(body(live), body(stored))
    assert.ok(live.funnel.all.counts[0] > 0 && live.sources.heatmap.length > 0 && live.health.byDetail.length > 0)
  })

  test('the nightly job committing a live day mid-request does not count it twice (review M2)', async () => {
    // liveDaysFor said "yesterday is live", then the job stored it before the reads:
    // the rollup reads exclude live days, so the day is counted once (from raw events).
    resetLiveCache()
    const report = await readInsights(prisma, range(D2, TODAY), [TODAY], NOW)
    assert.strictEqual(report.overview.visits, 12 + 6)
  })
})

describe('days rolled up before the Insights rollups (review F1)', () => {
  const OLD = '2036-08-03'
  test('a day with visits but no journey rows is listed as not recalculated', async () => {
    await prisma.analyticsDailyVisits.create({ data: { day: dayToDate(OLD), visits: 5, endedVisits: 5 } })
    const report = await readInsights(prisma, range(OLD, D2), [], NOW)
    assert.deepStrictEqual(report.range.notRecalculated, [OLD])
    const fresh = await readInsights(prisma, range(D1, D2), [], NOW)
    assert.deepStrictEqual(fresh.range.notRecalculated, [])
  })
})
