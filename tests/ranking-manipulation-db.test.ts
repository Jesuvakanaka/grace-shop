// ZP-506 review: forged analytics events must not buy a piece the top of the
// feed or a Featured place. Simulation against DATABASE_URL (< 6,000 events):
// 20 published pieces with a week of honest traffic (6 visits per piece per
// day), rolled up and ranked; then
//  1. ONE visit sends 450 events on the 19th piece (views, 60 s dwells,
//     details, opens, WhatsApp, shares, hearts): before the review fix this
//     moved it from #19 to #1 and into Featured. Now each visit counts once
//     per piece and day, dwell is capped per visit and hearts come from the
//     deduplicated ProductLove rows, so it barely moves;
//  2. the residual risk: how many separate forged visits (each needs its own
//     visit id; the endpoint allows 300 new visit ids per IP per hour) it
//     takes to get the piece into Featured. Logged and documented in
//     docs/storefront/ranking.md.
// Uses analytics days 2036-01-0x, products "ZP506M-*".
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import prisma from '../src/lib/db'
import { analyticsDay, dayToDate } from '../src/lib/analytics/events'
import { rollupDay } from '../src/lib/analytics/rollup'
import { runRanking } from '../src/lib/ranking/job'

const DAYS = ['2036-01-02', '2036-01-03', '2036-01-04', '2036-01-05', '2036-01-06', '2036-01-07', '2036-01-08']
const ATTACK_DAY = DAYS[DAYS.length - 1]
const NOW = new Date('2036-01-09T08:00:00Z')
const N = 20
const VICTIM = 19 // 1-based position by honest quality
const ids: number[] = []
const slugs: string[] = []

let seq = 0
type Row = Prisma.AnalyticsEventCreateManyInput
function ev(day: string, visitId: string, piece: number, type: string, props: Record<string, unknown> = {}): Row {
  seq += 1
  const occurredAt = new Date(new Date(`${day}T08:00:00Z`).getTime() + seq * 100)
  return {
    eventId: randomUUID(),
    visitId,
    deviceId: null,
    type,
    occurredAt,
    day: dayToDate(analyticsDay(occurredAt)),
    page: '/',
    slug: slugs[piece - 1],
    productId: ids[piece - 1],
    collection: null,
    props: props as object,
  }
}

async function cleanup() {
  const where = { day: { gte: dayToDate('2036-01-01'), lte: dayToDate('2036-01-31') } }
  await prisma.analyticsEvent.deleteMany({ where })
  for (const t of ['analyticsDailyPiece', 'analyticsDailyPhoto', 'analyticsDailyVisits', 'analyticsDailySource', 'analyticsDailyVideo', 'analyticsDailyJourney', 'analyticsDailyDepth', 'analyticsDailyHour', 'analyticsDailyHealth', 'analyticsDailyOption'] as const) {
    await (prisma[t] as unknown as { deleteMany(a: unknown): Promise<unknown> }).deleteMany({ where })
  }
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP506M-' } } })
  await prisma.category.deleteMany({ where: { slug: 'zp506m-cat' } })
}

/** Position of the victim by score among the 20 pieces (1 = best), and whether it is Featured. */
async function victimStanding() {
  const rows = await prisma.productPopularity.findMany({ where: { productId: { in: ids } }, orderBy: [{ score: 'desc' }, { productId: 'asc' }] })
  const victim = ids[VICTIM - 1]
  const p = await prisma.product.findUniqueOrThrow({ where: { id: victim }, select: { featured: true } })
  return {
    byScore: rows.findIndex((r) => r.productId === victim) + 1,
    rank: rows.find((r) => r.productId === victim)?.rank ?? null,
    featured: p.featured,
  }
}

async function rollAndRank(days: string[]) {
  for (const d of days) assert.strictEqual((await rollupDay(prisma, d, { now: NOW })).status, 'done')
  return runRanking(prisma, { now: NOW })
}

describe('forged events cannot buy the top of the feed (ZP-506 review)', () => {
  before(async () => {
    await cleanup()
    await prisma.siteSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })
    const cat = await prisma.category.create({ data: { slug: 'zp506m-cat', name: 'ZP506M', published: true } })
    for (let i = 1; i <= N; i++) {
      const p = await prisma.product.create({
        data: {
          itemNumber: `ZP506M-${i}`,
          productName: `ZP506M ${i}`,
          slug: `zp506m-${i}`,
          categoryId: cat.id,
          published: true,
          publishedAt: new Date('2035-11-01T00:00:00Z'),
          currentQuantity: 5,
        },
      })
      await prisma.productImage.create({ data: { productId: p.id, imageKey: `products/${String(i).padStart(32, 'd')}.webp`, isPrimary: true } })
      ids.push(p.id)
      slugs.push(p.slug!)
    }
    // Honest traffic: quality falls with i (dwell, details, opens, a few enquiries for the best).
    const data: Row[] = []
    DAYS.forEach((day, d) => {
      for (let i = 1; i <= N; i++) {
        for (let v = 0; v < 6; v++) {
          const visit = randomUUID()
          data.push(ev(day, visit, i, 'look_view', { position: i - 1 }))
          data.push(ev(day, visit, i, 'look_dwell', { seconds: Math.max(1, 12 - i * 0.5) }))
          if (v < Math.round(5 - i / 5)) data.push(ev(day, visit, i, 'details_show'))
          if (v < Math.round(3 - i / 10)) data.push(ev(day, visit, i, 'product_open', { from: 'feed' }))
          if (d % 2 === 0 && v === 0 && i <= 5) data.push(ev(day, visit, i, 'whatsapp_enquire', { screen: 'feed' }))
        }
      }
    })
    await prisma.analyticsEvent.createMany({ data })
  })

  after(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('honest ranking: the victim is near the bottom', async () => {
    const run = await rollAndRank(DAYS)
    assert.strictEqual(run.ranked, true)
    const s = await victimStanding()
    assert.ok(s.byScore >= 17, `by score #${s.byScore}`)
    assert.strictEqual(s.featured, false)
  })

  test('one visit with 450 forged events: no jump to the top, no Featured place', async () => {
    const visit = randomUUID()
    const data: Row[] = []
    const add = (n: number, type: string, props: Record<string, unknown> = {}) => {
      for (let k = 0; k < n; k++) data.push(ev(ATTACK_DAY, visit, VICTIM, type, props))
    }
    add(50, 'look_view', { position: 0 })
    add(100, 'look_dwell', { seconds: 60 })
    add(60, 'details_show')
    add(60, 'product_open', { from: 'feed' })
    add(60, 'whatsapp_enquire', { screen: 'feed' })
    add(60, 'share', { method: 'copy' })
    add(60, 'love_on')
    assert.strictEqual(data.length, 450)
    await prisma.analyticsEvent.createMany({ data })
    await rollAndRank([ATTACK_DAY])
    const s = await victimStanding()
    assert.ok(s.byScore >= 10, `one forged visit moved it to #${s.byScore} by score`)
    assert.notStrictEqual(s.rank, 1)
    assert.strictEqual(s.featured, false)
  })

  test('residual risk: many separate forged visits are needed (measured, see ranking.md)', async () => {
    let forged = 1 // the visit of the previous test
    let s = await victimStanding()
    while (!s.featured && forged < 200) {
      const data: Row[] = []
      for (let k = 0; k < 10; k++) {
        const visit = randomUUID()
        data.push(ev(ATTACK_DAY, visit, VICTIM, 'look_view', { position: 0 }))
        data.push(ev(ATTACK_DAY, visit, VICTIM, 'look_dwell', { seconds: 60 }))
        data.push(ev(ATTACK_DAY, visit, VICTIM, 'photo_view', { index: 2, of: 3 }))
        data.push(ev(ATTACK_DAY, visit, VICTIM, 'details_show'))
        data.push(ev(ATTACK_DAY, visit, VICTIM, 'product_open', { from: 'feed' }))
        data.push(ev(ATTACK_DAY, visit, VICTIM, 'whatsapp_enquire', { screen: 'feed' }))
        data.push(ev(ATTACK_DAY, visit, VICTIM, 'share', { method: 'copy' }))
      }
      await prisma.analyticsEvent.createMany({ data })
      forged += 10
      await rollAndRank([ATTACK_DAY])
      s = await victimStanding()
    }
    console.log(`[ZP-506 simulation] forged visits until Featured: ${s.featured ? forged : `>${forged}`} (victim honest visits: ${6 * DAYS.length})`)
    // Each forged visit needs its own visit id and a full set of events; well above one visit's worth.
    assert.ok(forged >= 11, `only ${forged} forged visits were needed`)
  })
})
