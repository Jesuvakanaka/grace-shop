// ZP-1200: product suggestions (DB, rows named ZP1200AI*) and the week planner (fake db, pure).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import { suggestProducts } from '../src/lib/marketing/ai/suggest'
import { bestHours, planWeek, hararedayStart, FALLBACK_HOURS } from '../src/lib/marketing/ai/plan'

const NOW = new Date('2026-11-26T10:00:00Z')
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const ids: Record<string, number> = {}
const contentIds: number[] = []

async function mk(key: string, data: Record<string, unknown>) {
  const p = await prisma.product.create({
    data: { itemNumber: `ZP1200AI-${key}-${Date.now()}`, productName: `ZP1200AI ${key}`, published: true, publishedAt: day(200), currentQuantity: 5, ...data } as never,
  })
  ids[key] = p.id
  return p
}

before(async () => {
  await mk('fresh', { publishedAt: day(2) })
  await mk('old', {})
  await mk('soldout', { currentQuantity: 0, publishedAt: day(1) })
  await mk('soon', { listingType: 'PRE_ORDER', currentQuantity: 0, preorderShipFrom: new Date('2026-12-05'), publishedAt: day(100) })
  await mk('later', { listingType: 'PRE_ORDER', currentQuantity: 0, preorderShipFrom: new Date('2027-03-05'), publishedAt: day(100) })
  await mk('popular', { loveCount: 8 })
  await mk('unpublished', { published: false })
  await mk('promoted', { publishedAt: day(3) })
  await prisma.productPopularity.create({ data: { productId: ids.popular, day: new Date('2026-11-25'), score: 180, parts: {} } })
  const c = await prisma.marketingContent.create({ data: { title: 'ZP1200AI promo', productId: ids.promoted, createdAt: day(4) } })
  contentIds.push(c.id)
})

after(async () => {
  await prisma.marketingContent.deleteMany({ where: { id: { in: contentIds } } })
  await prisma.product.deleteMany({ where: { id: { in: Object.values(ids) } } })
  await prisma.$disconnect()
})

describe('suggestProducts', () => {
  test('ranks by newness, availability, popularity, loves, and demotes recently promoted; no sold-out or unpublished', async () => {
    const all = await suggestProducts(prisma, { limit: 50, now: NOW })
    const mine = all.filter((s) => Object.values(ids).includes(s.productId))
    const order = mine.map((s) => s.name.replace('ZP1200AI ', ''))
    assert.ok(!order.includes('soldout') && !order.includes('unpublished'), order.join())
    assert.ok(order.indexOf('fresh') < order.indexOf('old'))
    assert.ok(order.indexOf('soon') < order.indexOf('later'))
    assert.ok(order.indexOf('popular') < order.indexOf('old'))
    // same age as "fresh" but promoted 4 days ago: lower than a similar unpromoted piece
    assert.ok(order.indexOf('fresh') < order.indexOf('promoted'))
    const by = Object.fromEntries(mine.map((s) => [s.name.replace('ZP1200AI ', ''), s]))
    assert.match(by.fresh.reason, /New arrival, 2 days/)
    assert.match(by.soon.reason, /Pre-order ships in 9 days/)
    assert.match(by.later.reason, /Open for pre-order/)
    assert.match(by.popular.reason, /Popular with visitors/)
    assert.match(by.popular.reason, /8 loves/)
    assert.match(by.promoted.reason, /Already promoted/)
    assert.ok(by.old.reason.length > 0)
  })

  test('limit is honoured', async () => {
    assert.ok((await suggestProducts(prisma, { limit: 2, now: NOW })).length <= 2)
  })
})

// ---- planner: a fake db so the test controls every row ----
interface FakePost { id: number; channelKind: string }
function fakeDb(approved: FakePost[], scheduled: { channelKind: string; scheduledFor: Date | null; publishedAt: Date | null }[] = [], hours: { hour: number; visits: number }[] = []) {
  return {
    analyticsDailyHour: { groupBy: async () => hours.map((h) => ({ hour: h.hour, _sum: { visits: h.visits } })) },
    marketingPost: {
      findMany: async (args: { where: { status: unknown } }) => (args.where.status === 'APPROVED' ? approved.map((p) => ({ ...p, scheduledFor: null })) : scheduled),
    },
  } as never
}
const START = new Date('2026-11-29T22:00:00Z') // Monday 30 Nov 00:00 Harare
const PLAN_NOW = new Date('2026-11-26T10:00:00Z')
const harareHour = (iso: string) => (new Date(iso).getUTCHours() + 2) % 24
const times = (plan: { items: { channelKind: string; scheduledFor: string | null; suggestedFor: string | null }[] }, kind: string) =>
  plan.items.filter((i) => i.channelKind === kind).map((i) => new Date((i.scheduledFor ?? i.suggestedFor)!).getTime()).sort((a, b) => a - b)

describe('planWeek', () => {
  test('Harare day start', () => {
    assert.strictEqual(hararedayStart(new Date('2026-11-30T05:00:00Z')).toISOString(), '2026-11-29T22:00:00.000Z')
    assert.strictEqual(hararedayStart(new Date('2026-11-29T21:59:00Z')).toISOString(), '2026-11-28T22:00:00.000Z')
  })

  test('best hours come from AnalyticsDailyHour; fall back to 12:00 and 19:00', async () => {
    assert.deepStrictEqual(await bestHours(fakeDb([], [], []), PLAN_NOW), FALLBACK_HOURS)
    assert.deepStrictEqual(await bestHours(fakeDb([], [], [{ hour: 20, visits: 9 }, { hour: 9, visits: 5 }, { hour: 15, visits: 2 }, { hour: 3, visits: 99 }]), PLAN_NOW), [9, 15, 20])
    const plan = await planWeek(fakeDb([{ id: 1, channelKind: 'INSTAGRAM' }]), { start: START, settings: { weeklyPostTarget: 7 }, now: PLAN_NOW })
    assert.deepStrictEqual(plan.bestHours, [12, 19])
    assert.ok([12, 19].includes(harareHour(plan.items[0].scheduledFor!)))
  })

  test('spreads posts over different days and never puts two posts on one channel within 3 hours', async () => {
    const posts = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, channelKind: 'INSTAGRAM' }))
    const plan = await planWeek(fakeDb(posts), { start: START, settings: { weeklyPostTarget: 10 }, now: PLAN_NOW })
    assert.strictEqual(plan.items.length, 10)
    const t = times(plan, 'INSTAGRAM')
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 3 * 3_600_000, 'gap')
    // ten posts fill all seven days before any day gets a second one
    assert.strictEqual(new Set(plan.items.map((i) => i.day)).size, 7)
    for (const i of plan.items) assert.ok(i.day! >= '2026-11-30' && i.day! <= '2026-12-06')
  })

  test('the weekly target limits how many are placed; posts already scheduled count', async () => {
    const posts = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, channelKind: 'FACEBOOK_PAGE' }))
    const plan = await planWeek(fakeDb(posts), { start: START, settings: { weeklyPostTarget: 3 }, now: PLAN_NOW })
    assert.strictEqual(plan.items.length, 3)
    assert.deepStrictEqual(plan.unplaced, [4, 5])
    const taken = [{ channelKind: 'FACEBOOK_PAGE', scheduledFor: new Date('2026-12-01T10:00:00Z'), publishedAt: null }]
    const plan2 = await planWeek(fakeDb(posts, taken), { start: START, settings: { weeklyPostTarget: 3 }, now: PLAN_NOW })
    assert.strictEqual(plan2.items.length, 2)
    assert.ok(plan2.items.every((i) => i.scheduledFor !== '2026-12-01T10:00:00.000Z'))
  })

  test('slots in the past are skipped; different channels may share a time; manual channels get a suggestion only', async () => {
    const lateNow = new Date('2026-12-02T09:00:00Z') // Wed 11:00 Harare
    const posts = [{ id: 1, channelKind: 'INSTAGRAM' }, { id: 2, channelKind: 'FACEBOOK_PAGE' }, { id: 3, channelKind: 'WHATSAPP_STATUS' }]
    const plan = await planWeek(fakeDb(posts), { start: START, settings: { weeklyPostTarget: 7 }, now: lateNow })
    for (const i of plan.items) assert.ok(new Date((i.scheduledFor ?? i.suggestedFor)!) > lateNow)
    const manual = plan.items.find((i) => i.channelKind === 'WHATSAPP_STATUS')!
    assert.strictEqual(manual.mode, 'manual')
    assert.strictEqual(manual.scheduledFor, null)
    assert.ok(manual.suggestedFor && manual.day)
    const api = plan.items.find((i) => i.channelKind === 'INSTAGRAM')!
    assert.strictEqual(api.mode, 'api')
    assert.ok(api.scheduledFor && api.suggestedFor === null)
    assert.strictEqual(plan.unplaced.length, 0)
  })

  test('with three close busy hours the same channel still keeps 3 hours apart', async () => {
    const hours = [{ hour: 12, visits: 9 }, { hour: 13, visits: 8 }, { hour: 14, visits: 7 }]
    const posts = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, channelKind: 'TELEGRAM' }))
    const plan = await planWeek(fakeDb(posts, [], hours), { start: START, settings: { weeklyPostTarget: 7 }, now: PLAN_NOW })
    const t = times(plan, 'TELEGRAM')
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 3 * 3_600_000)
  })
})
