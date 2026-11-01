// ZP-506: the nightly ranking step and the admin rules, against DATABASE_URL.
// - runRanking: one ProductPopularity row per public piece, ranks, parts,
//   cold start, automatic Featured (top by score; unpublished turned off),
//   idempotent (same day = same rows, nothing changed the second time).
// - Too little data: newest first (no ranks), Featured = the newest pieces.
// - "Newest first": Featured is left alone (manual again).
// - The storefront's cached ranking entry and the feed order from it.
// - Admin API: Featured read-only while ranking is automatic; settings switch.
// Only touches rows it creates (item numbers "ZP506-*", category "zp506-*",
// analytics days in 2035) and restores the feed-order setting.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp506-ranking-tests-secret-0123456789abcdef'

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import { dayToDate } from '../src/lib/analytics/events'
import { runRanking, splitRankArg, isAutoRanking } from '../src/lib/ranking/job'
import { loadFeedRanking, loadPopularity } from '../src/lib/ranking/read'
import { orderFeedByRanking } from '../src/lib/ranking/feed-order'
import { AUTO_FEATURED_COUNT } from '../src/lib/ranking/score'
import { createStorefront, type CacheFn } from '../src/lib/storefront/cached'
import { parseBulkBody } from '../src/lib/website/validation'
import * as websiteProduct from '../src/app/api/website/products/[id]/route'
import * as settingsRoute from '../src/app/api/website/settings/route'

const NOW = new Date('2035-06-15T08:00:00Z') // analytics day 2035-06-15; window 2035-05-19..2035-06-14
const DAY_MS = 86_400_000
const KEY = (n: number) => `products/${String(n).padStart(32, 'e').slice(-32)}.webp`

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
let ownerToken = ''
async function call(fn: unknown, method: string, params: Record<string, string>, body?: unknown) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', cookie: `auth-token=${ownerToken}` } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await (fn as Handler)(new Request('http://localhost/api/test', init), { params: Promise.resolve(params) })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

const ids: Record<string, number> = {}
let originalMode: 'AUTO' | 'NEWEST' = 'AUTO'

async function setMode(mode: 'AUTO' | 'NEWEST') {
  await prisma.siteSettings.upsert({ where: { id: 1 }, create: { id: 1, feedRanking: mode }, update: { feedRanking: mode } })
}

async function cleanup() {
  await prisma.analyticsDailyPiece.deleteMany({ where: { day: { gte: dayToDate('2035-01-01'), lte: dayToDate('2035-12-31') } } })
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP506-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp506-' } } })
}

/** Daily rows over the window: `views` per day for 10 days, mean dwell `dwell`. */
async function seedViews(productId: number, views: number, dwell: number) {
  const data = Array.from({ length: 10 }, (_, i) => ({
    day: dayToDate(new Date(NOW.getTime() - (i + 1) * DAY_MS).toISOString().slice(0, 10)),
    productId,
    slug: 'x',
    views,
    viewers: views,
    dwellSeconds: views * dwell,
    dwellCount: views,
    photoSwipers: Math.round(views * 0.3),
    detailsShows: Math.round(views * 0.2),
    productOpens: Math.round(views * 0.1),
  }))
  await prisma.analyticsDailyPiece.createMany({ data })
}

describe('ranking nightly step and admin rules (ZP-506)', () => {
  before(async () => {
    ownerToken = await createToken(900506, 'zp506-owner', 'OWNER')
    await cleanup()
    originalMode = ((await prisma.siteSettings.findUnique({ where: { id: 1 } }))?.feedRanking ?? 'AUTO') as 'AUTO' | 'NEWEST'
    await setMode('AUTO')
    const cat = await prisma.category.create({ data: { slug: 'zp506-cat', name: 'ZP506', published: true } })
    const old = new Date(NOW.getTime() - 40 * DAY_MS)
    // name -> [dwell seconds, views/day, quantity, photo, published, publishedAt]
    const specs: [string, number, number, number, boolean, boolean, Date][] = [
      ['best', 12, 40, 5, true, true, new Date(old.getTime() + 1000)],
      ['good', 9, 40, 5, true, true, new Date(old.getTime() + 2000)],
      ['fine', 7, 40, 5, true, true, new Date(old.getTime() + 3000)],
      ['avg', 5, 40, 5, true, true, new Date(old.getTime() + 4000)],
      ['meh', 3, 40, 5, true, true, new Date(old.getTime() + 5000)],
      ['poor', 2, 40, 5, true, true, new Date(old.getTime() + 6000)],
      ['soldout', 15, 40, 0, true, true, new Date(old.getTime() + 7000)],
      ['nophoto', 14, 40, 5, false, true, new Date(old.getTime() + 8000)],
      ['new', 0, 0, 5, true, true, new Date(NOW.getTime() - DAY_MS)],
      ['hidden', 20, 40, 5, true, false, new Date(old.getTime() + 9000)],
    ]
    let n = 0
    for (const [name, dwell, views, qty, photo, published, publishedAt] of specs) {
      n += 1
      const p = await prisma.product.create({
        data: {
          itemNumber: `ZP506-${name}`,
          productName: `ZP506 ${name}`,
          slug: `zp506-${name}`,
          categoryId: cat.id,
          published,
          publishedAt,
          currentQuantity: qty,
          sellingPriceUsd: 20,
          featured: name === 'hidden' || name === 'poor', // both must be turned off
        },
      })
      ids[name] = p.id
      if (photo) await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY(n), isPrimary: true } })
      if (views > 0) await seedViews(p.id, views, dwell)
    }
  })

  after(async () => {
    await cleanup()
    await setMode(originalMode)
    await prisma.$disconnect()
  })

  test('scores every public piece, ranks today, Featured = top by score, idempotent', async () => {
    const first = await runRanking(prisma, { now: NOW })
    assert.strictEqual(first.day, '2035-06-15')
    assert.strictEqual(first.ranked, true)
    assert.ok(first.totalViews >= 3200, String(first.totalViews)) // 8 public pieces x 400 views (the hidden one is not counted)

    const pop = await loadPopularity(prisma, Object.values(ids))
    assert.ok(!pop.has(ids.hidden), 'unpublished pieces are not scored')
    for (const name of ['best', 'good', 'fine', 'avg', 'meh', 'poor', 'soldout', 'nophoto', 'new']) assert.ok(pop.has(ids[name]), name)
    const best = pop.get(ids.best)!
    assert.ok(best.score > pop.get(ids.good)!.score && pop.get(ids.good)!.score > pop.get(ids.poor)!.score)
    assert.ok(best.parts && best.parts.attention > 1 && best.parts.signals.dwell.raw === 12)
    assert.strictEqual(best.views, 400)
    assert.strictEqual(best.day, '2035-06-15')
    assert.strictEqual(pop.get(ids.new)!.coldStart, true)
    assert.ok(pop.get(ids.soldout)!.rank! > pop.get(ids.poor)!.rank!, 'sold-out ranks after every available piece')

    // Featured: the top pieces by score; never sold-out or photo-less ones; the rest off.
    const rows = await prisma.product.findMany({ where: { id: { in: Object.values(ids) } }, select: { id: true, featured: true } })
    const featured = new Map(rows.map((r) => [r.id, r.featured]))
    assert.strictEqual(first.featured.length, Math.min(AUTO_FEATURED_COUNT, first.featured.length))
    // best and good beat the average; "new" has no views yet, so it scores exactly the average (100)
    // and comes before the below-average "fine" (no early stars, no early penalty).
    assert.deepStrictEqual(first.featured.slice(0, 3), [ids.best, ids.good, ids.new])
    for (const name of ['best', 'good', 'new']) assert.strictEqual(featured.get(ids[name]), true, name)
    for (const name of ['soldout', 'nophoto', 'hidden']) assert.strictEqual(featured.get(ids[name]), false, name)
    for (const [id, on] of featured) assert.strictEqual(on, first.featured.includes(id), `product ${id}`)
    assert.ok(first.featuredChanged.some((c) => c.id === ids.hidden && !c.featured))

    // Same day again: the same rows, nothing changes.
    const before = await prisma.productPopularity.findMany({ orderBy: { productId: 'asc' } })
    const second = await runRanking(prisma, { now: NOW })
    const again = await prisma.productPopularity.findMany({ orderBy: { productId: 'asc' } })
    assert.deepStrictEqual(again, before)
    assert.deepStrictEqual(second.featured, first.featured)
    assert.deepStrictEqual(second.featuredChanged, [])
  })

  test('the storefront reads the ranks (cached entry) and orders the feed by them', async () => {
    await runRanking(prisma, { now: NOW })
    const ranking = await loadFeedRanking(prisma)
    assert.strictEqual(ranking.mode, 'AUTO')
    assert.ok(!('zp506-hidden' in ranking.ranks))
    const mine = Object.keys(ranking.ranks).filter((s) => s.startsWith('zp506-'))
    assert.strictEqual(mine.length, 9)

    const newest = ['new', 'nophoto', 'soldout', 'poor', 'meh', 'avg', 'fine', 'good', 'best'].map((n) => ({
      slug: `zp506-${n}`,
      availability: n === 'soldout' ? 'SOLD_OUT' : 'IN_STOCK',
    }))
    const order = orderFeedByRanking(newest, ranking).map((p) => p.slug)
    assert.strictEqual(order[order.length - 1], 'zp506-soldout')
    assert.ok(order.indexOf('zp506-best') < order.indexOf('zp506-poor'))

    // One argument-free cache entry with the ranking and settings tags.
    const entries = new Map<string, string[]>()
    const cache: CacheFn = (fn, keyParts, options) =>
      (async (...args: unknown[]) => {
        entries.set(JSON.stringify([keyParts, args]), options.tags)
        return fn(...(args as []))
      }) as unknown as typeof fn
    const sf = createStorefront({ db: prisma, cache })
    await sf.getFeedRanking()
    await sf.getFeedRanking()
    assert.strictEqual(entries.size, 1)
    const tags = [...entries.values()][0]
    for (const t of ['storefront', 'storefront:ranking', 'storefront:settings', 'storefront:products']) assert.ok(tags.includes(t), t)
  })

  test('too little data: newest first (no ranks), Featured = the newest available pieces with a photo', async () => {
    const later = new Date('2035-09-01T08:00:00Z') // nothing in that window
    const r = await runRanking(prisma, { now: later })
    assert.strictEqual(r.ranked, false)
    assert.strictEqual(await prisma.productPopularity.count({ where: { rank: { not: null } } }), 0)
    assert.deepStrictEqual((await loadFeedRanking(prisma)).ranks, {})
    // The newest of mine: "new" first; never the sold-out or photo-less ones.
    assert.strictEqual(r.featured.includes(ids.new), true)
    assert.ok(!r.featured.includes(ids.soldout) && !r.featured.includes(ids.nophoto))
    await runRanking(prisma, { now: NOW }) // back to the ranked state
  })

  test('"Newest first": scores are still written, Featured is left alone', async () => {
    await setMode('NEWEST')
    try {
      await prisma.product.update({ where: { id: ids.poor }, data: { featured: true } })
      const r = await runRanking(prisma, { now: NOW })
      assert.strictEqual(r.mode, 'NEWEST')
      assert.deepStrictEqual(r.featuredChanged, [])
      assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: ids.poor } })).featured, true)
      assert.strictEqual((await loadFeedRanking(prisma)).mode, 'NEWEST')
      assert.strictEqual(await isAutoRanking(prisma), false)
    } finally {
      await setMode('AUTO')
      await runRanking(prisma, { now: NOW })
    }
    assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: ids.poor } })).featured, false)
  })

  test('admin API: Featured is read-only while ranking is automatic', async () => {
    const id = String(ids.avg)
    const get = await call(websiteProduct.GET, 'GET', { id })
    assert.strictEqual(get.status, 200)
    assert.strictEqual(get.json.featuredAuto, true)
    assert.ok(typeof get.json.popularity.score === 'number')
    const current = get.json.featured as boolean

    const refused = await call(websiteProduct.PATCH, 'PATCH', { id }, { featured: !current, sizes: 'S-M' })
    assert.strictEqual(refused.status, 400)
    assert.strictEqual(refused.json.field, 'featured')
    assert.match(refused.json.error, /automatically by popularity/)
    const row = await prisma.product.findUniqueOrThrow({ where: { id: ids.avg } })
    assert.strictEqual(row.featured, current)
    assert.strictEqual(row.sizes, null, 'nothing of a refused patch is saved')

    const same = await call(websiteProduct.PATCH, 'PATCH', { id }, { featured: current, sizes: 'S-M' })
    assert.strictEqual(same.status, 200, JSON.stringify(same.json))
    assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: ids.avg } })).sizes, 'S-M')

    // The bulk API has no way to set Featured at all.
    assert.strictEqual(parseBulkBody({ action: 'feature', ids: [ids.avg] }).ok, false)
    assert.strictEqual(parseBulkBody({ action: 'publish', ids: [ids.avg], featured: true }).ok, false)

    await setMode('NEWEST')
    try {
      const manual = await call(websiteProduct.PATCH, 'PATCH', { id }, { featured: !current })
      assert.strictEqual(manual.status, 200)
      assert.strictEqual(manual.json.featuredAuto, false)
      assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: ids.avg } })).featured, !current)
    } finally {
      await setMode('AUTO')
      await prisma.product.update({ where: { id: ids.avg }, data: { featured: current } })
    }
  })

  test('settings: the feed order switch is validated, and switching back to automatic ranks at once', async () => {
    const bad = await call(settingsRoute.PUT, 'PUT', {}, { feedRanking: 'POPULAR' })
    assert.strictEqual(bad.status, 400)
    assert.ok(bad.json.fieldErrors.feedRanking)

    const toNewest = await call(settingsRoute.PUT, 'PUT', {}, { feedRanking: 'NEWEST' })
    assert.strictEqual(toNewest.status, 200)
    assert.strictEqual(toNewest.json.settings.feedRanking, 'NEWEST')
    await prisma.productPopularity.updateMany({ data: { computedAt: new Date('2000-01-01T00:00:00Z') } })

    const toAuto = await call(settingsRoute.PUT, 'PUT', {}, { feedRanking: 'AUTO' })
    assert.strictEqual(toAuto.status, 200)
    const latest = await prisma.productPopularity.findFirst({ orderBy: { computedAt: 'desc' } })
    assert.ok(latest && latest.computedAt.getTime() > Date.now() - 60_000, 'ranked right after the switch')
    await runRanking(prisma, { now: NOW })
  })

  test('job arguments: --no-rank skips the ranking step, the rest goes to the rollup', () => {
    assert.deepStrictEqual(splitRankArg([]), { rank: true, rest: [] })
    assert.deepStrictEqual(splitRankArg(['--date', '2035-01-01', '--no-rank']), { rank: false, rest: ['--date', '2035-01-01'] })
  })
})
