// ZP-1200: results sync and report (src/lib/marketing/results.ts), the results APIs, against DATABASE_URL.
// Only touches rows it creates (ZP1200RES-*). Platform calls use a fake fetch: nothing leaves the machine.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import { encryptJson } from '../src/lib/marketing/secrets'
import { META_GRAPH_VERSION } from '../src/lib/marketing/connectors/meta-graph'
import { parseRange, resultsReport, syncAllResults, syncPostResults, hararedayString } from '../src/lib/marketing/results'
import { WebsiteError } from '../src/lib/website/http'
import * as resultsRoute from '../src/app/api/marketing/results/route'
import * as syncRoute from '../src/app/api/marketing/results/sync/route'

const stamp = Date.now()
const TAG1 = `mkzp1200res${stamp}a`.slice(0, 36)
const TAG2 = `mkzp1200res${stamp}b`.slice(0, 36)
const TAG3 = `mkzp1200res${stamp}c`.slice(0, 36)
const TAG_AD = `mkzp1200res${stamp}d`.slice(0, 36)
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
let ownerToken = ''
let staffToken = ''
let productId = 0
let campaignId = 0
let contentId = 0
let channelId = 0
let postFb = 0
let postIg = 0
let postShared = 0
let adId = 0

const req = (url: string, token: string | null, method = 'GET') =>
  new Request(`http://localhost${url}`, { method, headers: token ? { cookie: `auth-token=${token}` } : {} })

before(async () => {
  ownerToken = await createToken(900310, 'zp1200-res-owner', 'OWNER')
  staffToken = await createToken(900311, 'zp1200-res-staff', 'STAFF')
  productId = (await prisma.product.create({ data: { itemNumber: `ZP1200RES-${stamp}`, productName: 'ZP1200RES Rose Dress', slug: `zp1200res-rose-${stamp}`, published: true } })).id
  campaignId = (await prisma.marketingCampaign.create({ data: { name: 'ZP1200RES Spring', createdBy: 'x' } })).id
  contentId = (await prisma.marketingContent.create({ data: { title: 'ZP1200RES idea', productId, campaignId, imageKeys: [], createdBy: 'x' } })).id
  channelId = (await prisma.marketingChannel.create({
    data: { kind: 'FACEBOOK_PAGE', name: 'ZP1200RES page', status: 'CONNECTED', externalId: 'PAGE1', credentialsEnc: encryptJson({ accessToken: 'TOK' }), tokenHint: '1234' },
  })).id
  const mk = (tag: string, kind: string, status: string, extra: object = {}) =>
    prisma.marketingPost.create({ data: { contentId, channelKind: kind, format: 'POST', text: 'ZP1200RES', imageKeys: [], trackingTag: tag, status, createdBy: 'x', publishedAt: d('2026-11-20'), ...extra } })
  postFb = (await mk(TAG1, 'FACEBOOK_PAGE', 'PUBLISHED', { channelId, externalId: 'PAGE1_99' })).id
  postIg = (await mk(TAG2, 'INSTAGRAM', 'PUBLISHED', { externalId: 'IG9' })).id
  postShared = (await mk(TAG3, 'WHATSAPP_STATUS', 'SHARED')).id
  adId = (await prisma.marketingAd.create({
    data: { campaignId, contentId, headline: 'ZP1200RES ad', primaryText: 'x', trackingTag: TAG_AD, dailyBudgetCents: 500, startsAt: d('2026-11-01'), status: 'COMPLETED', createdBy: 'x' },
  })).id
  // Analytics rolled up under each tag (two sources and devices add up).
  const src = (campaign: string, day: string, source: string, visits: number, enq: number) =>
    prisma.analyticsDailySource.create({ data: { day: d(day), source, deviceClass: 'phone', campaign, visits, enquiringVisits: enq } })
  await src(TAG1, '2026-11-21', 'facebook', 10, 2)
  await src(TAG1, '2026-11-21', 'direct', 5, 1)
  await src(TAG1, '2026-11-22', 'facebook', 3, 0)
  await src(TAG2, '2026-11-21', 'instagram', 4, 1)
  await src(TAG_AD, '2026-11-22', 'facebook', 6, 3)
})

after(async () => {
  await prisma.analyticsDailySource.deleteMany({ where: { campaign: { in: [TAG1, TAG2, TAG3, TAG_AD] } } })
  await prisma.marketingMetric.deleteMany({ where: { OR: [{ entity: 'POST', entityId: { in: [postFb, postIg, postShared] } }, { entity: 'AD', entityId: adId }] } })
  await prisma.marketingAd.deleteMany({ where: { id: adId } })
  await prisma.marketingContent.deleteMany({ where: { id: contentId } })
  await prisma.marketingChannel.deleteMany({ where: { id: channelId } })
  await prisma.marketingCampaign.deleteMany({ where: { id: campaignId } })
  await prisma.product.deleteMany({ where: { id: productId } })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: { in: ['zp1200-res-owner', 'system'] }, action: 'results.sync' } })
  await prisma.$disconnect()
})

function fakeGraph(routes: Record<string, unknown>) {
  const calls: string[] = []
  const fn = async (url: string) => {
    const u = new URL(url)
    const key = `${u.pathname.replace(`/${META_GRAPH_VERSION}`, '')}`
    calls.push(key)
    const body = routes[key]
    return new Response(JSON.stringify(body ?? { error: { message: 'no route', code: 100 } }), { status: body ? 200 : 400, headers: { 'content-type': 'application/json' } })
  }
  return { fn, calls }
}
const metric = (name: string, v: number) => ({ name, values: [{ value: v }] })

describe('parseRange', () => {
  const now = new Date('2026-11-26T10:00:00Z')
  test('defaults to the last 30 Harare days', () => {
    assert.deepStrictEqual(parseRange(null, null, now), { from: '2026-10-28', to: '2026-11-26' })
  })
  test('uses the Harare day (UTC+2) for "today"', () => {
    assert.strictEqual(hararedayString(new Date('2026-11-26T22:30:00Z')), '2026-11-27')
  })
  test('rejects nonsense, reversed and over-long ranges', () => {
    for (const [f, t] of [['2026-13-01', '2026-11-02'], ['2026-11-05', '2026-11-02'], ['2025-01-01', '2026-11-02'], ['x', null]] as const) {
      assert.throws(() => parseRange(f, t, now), (e: unknown) => e instanceof WebsiteError && e.status === 400)
    }
  })
})

describe('syncPostResults', () => {
  test('visits and enquiries come from the analytics rows of the tracking tag, summed per day', async () => {
    const out = await syncPostResults(prisma, postShared, { fetch: fakeGraph({}).fn, now: new Date('2026-11-25T10:00:00Z') })
    assert.strictEqual(out.insights, 'skipped')
    const fb = await syncPostResults(prisma, postFb, { fetch: fakeGraph({}).fn, now: new Date('2026-11-25T10:00:00Z'), getConnector: () => undefined })
    assert.strictEqual(fb.insights, 'skipped')
    const rows = await prisma.marketingMetric.findMany({ where: { entity: 'POST', entityId: postFb }, orderBy: { day: 'asc' } })
    assert.deepStrictEqual(rows.map((r) => [r.day.toISOString().slice(0, 10), r.visits, r.enquiries]), [['2026-11-21', 15, 3], ['2026-11-22', 3, 0]])
  })

  test('insights are lifetime totals: each day stores only what is new, and re-running a day does not double count', async () => {
    const g1 = fakeGraph({ '/PAGE1_99/insights': { data: [metric('post_impressions', 100), metric('post_impressions_unique', 80), metric('post_clicks', 10)] } })
    assert.strictEqual((await syncPostResults(prisma, postFb, { fetch: g1.fn, now: new Date('2026-11-24T10:00:00Z') })).insights, 'ok')
    assert.deepStrictEqual(g1.calls, ['/PAGE1_99/insights'])
    const g2 = fakeGraph({ '/PAGE1_99/insights': { data: [metric('post_impressions', 160), metric('post_impressions_unique', 120), metric('post_clicks', 16)] } })
    const now2 = new Date('2026-11-25T10:00:00Z')
    await syncPostResults(prisma, postFb, { fetch: g2.fn, now: now2 })
    await syncPostResults(prisma, postFb, { fetch: g2.fn, now: now2 })
    const rows = await prisma.marketingMetric.findMany({ where: { entity: 'POST', entityId: postFb, impressions: { gt: 0 } }, orderBy: { day: 'asc' } })
    assert.deepStrictEqual(rows.map((r) => [r.day.toISOString().slice(0, 10), r.impressions, r.reach, r.clicks]), [['2026-11-24', 100, 80, 10], ['2026-11-25', 60, 40, 6]])
  })

  test('a platform error is reported and leaves visits and earlier numbers alone', async () => {
    const bad = fakeGraph({})
    const out = await syncPostResults(prisma, postFb, { fetch: bad.fn, now: new Date('2026-11-26T10:00:00Z') })
    assert.strictEqual(out.insights, 'failed')
    assert.ok(out.error)
    assert.ok(!JSON.stringify(out).includes('TOK'))
    const total = await prisma.marketingMetric.aggregate({ where: { entity: 'POST', entityId: postFb }, _sum: { impressions: true, visits: true } })
    assert.deepStrictEqual([total._sum.impressions, total._sum.visits], [160, 18])
  })

  test('no saved credentials means no request at all', async () => {
    const g = fakeGraph({})
    const out = await syncPostResults(prisma, postIg, { fetch: g.fn, now: new Date('2026-11-25T10:00:00Z') })
    assert.strictEqual(out.insights, 'skipped')
    assert.deepStrictEqual(g.calls, [])
    const row = await prisma.marketingMetric.findFirst({ where: { entity: 'POST', entityId: postIg } })
    assert.deepStrictEqual([row?.visits, row?.enquiries], [4, 1])
  })

  test('unknown post answers 404', async () => {
    await assert.rejects(() => syncPostResults(prisma, 987654321, { fetch: fakeGraph({}).fn }), (e: unknown) => e instanceof WebsiteError && e.status === 404)
  })
})

describe('resultsReport', () => {
  before(async () => {
    // Ad rows as the existing ad sync writes them.
    await prisma.marketingMetric.createMany({ data: [
      { entity: 'AD', entityId: adId, day: d('2026-11-22'), impressions: 1000, reach: 700, clicks: 40, spendCents: 250, visits: 6, enquiries: 3 },
      { entity: 'AD', entityId: adId, day: d('2026-11-23'), impressions: 500, reach: 300, clicks: 20, spendCents: 150, visits: 0, enquiries: 0 },
    ] })
  })

  test('totals per post, channel, campaign and product, plus spend', async () => {
    const r = await resultsReport(prisma, { from: '2026-11-20', to: '2026-11-26' })
    const post = (id: number) => r.perPost.find((p) => p.postId === id)!
    assert.deepStrictEqual([post(postFb).visits, post(postFb).enquiries, post(postFb).impressions, post(postFb).reach, post(postFb).clicks], [18, 3, 160, 120, 16])
    assert.strictEqual(post(postIg).visits, 4)
    const channel = (k: string) => r.perChannel.find((c) => c.key === k)!
    assert.strictEqual(channel('FACEBOOK_PAGE').visits, 18)
    assert.strictEqual(channel('INSTAGRAM').visits, 4)
    assert.deepStrictEqual([channel('META_ADS').visits, channel('META_ADS').spendCents, channel('META_ADS').ads, channel('META_ADS').impressions], [6, 400, 1, 1500])
    const camp = r.perCampaign.find((c) => c.key === String(campaignId))!
    assert.strictEqual(camp.label, 'ZP1200RES Spring')
    assert.deepStrictEqual([camp.visits, camp.enquiries, camp.spendCents, camp.posts, camp.ads], [28, 7, 400, 2, 1])
    const prod = r.perProduct.find((p) => p.key === String(productId))!
    assert.strictEqual(prod.label, 'ZP1200RES Rose Dress')
    assert.deepStrictEqual([prod.visits, prod.spendCents], [28, 400])
    assert.ok(r.spendCents >= 400)
    assert.ok(r.totals.visits >= 28)
    assert.strictEqual(r.perAd.find((a) => a.adId === adId)?.spendCents, 400)
    // ordered best first
    const visits = r.perPost.map((p) => p.visits)
    assert.deepStrictEqual(visits, [...visits].sort((a, b) => b - a))
  })

  test('the date range limits what is counted', async () => {
    const r = await resultsReport(prisma, { from: '2026-11-22', to: '2026-11-22' })
    assert.strictEqual(r.perPost.find((p) => p.postId === postFb)?.visits, 3)
    assert.strictEqual(r.perPost.find((p) => p.postId === postIg), undefined)
    assert.strictEqual(r.perAd.find((a) => a.adId === adId)?.spendCents, 250)
    const none = await resultsReport(prisma, { from: '2025-01-01', to: '2025-01-02' })
    assert.deepStrictEqual([none.perPost.length, none.spendCents, none.totals.visits], [0, 0, 0])
  })
})

describe('syncAllResults', () => {
  test('syncs published and shared posts, counts failures, writes an audit row', async () => {
    const g = fakeGraph({}) // Meta says no: the Facebook post reports a failure, the others carry on
    const s = await syncAllResults(prisma, { username: 'zp1200-res-owner', role: 'OWNER' }, { fetch: g.fn, now: new Date('2026-11-26T10:00:00Z') })
    assert.ok(s.posts >= 3)
    assert.ok(s.postInsightsFailed.some((f) => f.postId === postFb))
    assert.ok(!s.adsFailed.some((f) => f.adId === adId), 'a completed ad is not pulled from Meta')
    const audit = await prisma.marketingAuditLog.findFirst({ where: { action: 'results.sync', actor: 'zp1200-res-owner' } })
    assert.ok(audit)
  })
})

describe('results APIs', () => {
  test('GET /api/marketing/results: owner 200 with the report, staff 403, anonymous 401, bad dates 400', async () => {
    const ok = await resultsRoute.GET(req('/api/marketing/results?from=2026-11-20&to=2026-11-26', ownerToken))
    assert.strictEqual(ok.status, 200)
    const body = (await ok.json()) as { report: { from: string; perChannel: unknown[]; perPost: unknown[]; perCampaign: unknown[]; perProduct: unknown[]; spendCents: number } }
    assert.strictEqual(body.report.from, '2026-11-20')
    for (const k of ['perChannel', 'perPost', 'perCampaign', 'perProduct'] as const) assert.ok(Array.isArray(body.report[k]))
    assert.ok(body.report.spendCents >= 400)
    assert.strictEqual((await resultsRoute.GET(req('/api/marketing/results', staffToken))).status, 403)
    assert.strictEqual((await resultsRoute.GET(req('/api/marketing/results', null))).status, 401)
    assert.strictEqual((await resultsRoute.GET(req('/api/marketing/results?from=2026-11-30&to=2026-11-01', ownerToken))).status, 400)
  })

  test('the saved channel token never appears in a result', async () => {
    const res = await resultsRoute.GET(req('/api/marketing/results?from=2026-11-20&to=2026-11-26', ownerToken))
    assert.ok(!(await res.text()).includes('TOK'))
  })

  test('POST /api/marketing/results/sync is owner only', async () => {
    // Remove the connected channel so this call cannot reach any platform.
    await prisma.marketingChannel.update({ where: { id: channelId }, data: { status: 'NOT_CONNECTED', credentialsEnc: null } })
    assert.strictEqual((await syncRoute.POST(req('/api/marketing/results/sync', staffToken, 'POST'))).status, 403)
    assert.strictEqual((await syncRoute.POST(req('/api/marketing/results/sync', null, 'POST'))).status, 401)
    const ok = await syncRoute.POST(req('/api/marketing/results/sync', ownerToken, 'POST'))
    assert.strictEqual(ok.status, 200)
    const body = (await ok.json()) as { summary: { posts: number; ads: number } }
    assert.ok(body.summary.posts >= 3)
  })

  test('the hub kill switch answers 404', async () => {
    const saved = process.env.GRACE_MARKETING_HUB
    process.env.GRACE_MARKETING_HUB = 'false'
    try {
      assert.strictEqual((await resultsRoute.GET(req('/api/marketing/results', ownerToken))).status, 404)
      assert.strictEqual((await syncRoute.POST(req('/api/marketing/results/sync', ownerToken, 'POST'))).status, 404)
    } finally {
      if (saved === undefined) delete process.env.GRACE_MARKETING_HUB
      else process.env.GRACE_MARKETING_HUB = saved
    }
  })
})
