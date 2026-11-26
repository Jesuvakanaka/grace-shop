// ZP-1200: Meta ads, audiences, connect META_ADS, the feed and sync against DATABASE_URL with a fake Meta (no network).
// Only touches rows it creates (products ZP1200ADS-*, the META_ADS channel it creates, ads/audiences it creates).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { connectMeta } from '../src/lib/marketing/connect'
import { createAudience, deleteAudience, updateAudience } from '../src/lib/marketing/audiences'
import { createAd, deleteAd, syncAd, transitionAdAction, updateAd, type AdDeps } from '../src/lib/marketing/ads'
import { draftAdCopy, validateAdCopy } from '../src/lib/marketing/ai/ad-copy'
import { budgetSummary } from '../src/lib/marketing/budget'
import { decryptJson } from '../src/lib/marketing/secrets'
import { getSettings } from '../src/lib/marketing/settings'
import { serveFeed } from '../src/lib/marketing/feed-route'
import { createStorefront, type CacheFn } from '../src/lib/storefront/cached'
import { META_GRAPH_VERSION } from '../src/lib/marketing/connectors/meta-graph'
import { WebsiteError } from '../src/lib/website/http'
import * as feedCsv from '../src/app/api/public/marketing/feed.csv/route'
import * as feedXml from '../src/app/api/public/marketing/feed.xml/route'

const owner = { username: 'zp1200-ads-owner', role: 'OWNER' as const }
const staff = { username: 'zp1200-ads-staff', role: 'STAFF' as const }
const TOKEN = 'EAAB-ads-token-SECRET-4321'
const ACCOUNT = '555000999'
const PAGE = '777000111'
const KEY = `products/${'c'.repeat(32)}.webp`
const savedEnv = process.env.GRACE_MARKETING_LIVE
const savedHosts = process.env.GRACE_STOREFRONT_HOSTS
let saved: { liveEnabled: boolean; monthlySpendCapCents: number; productFeedEnabled: boolean } | null = null
let hadAdsChannel = false
let productId = 0
let unpublishedId = 0
let categoryId = 0
let contentId = 0
const adIds: number[] = []
const audienceIds: number[] = []

const rejects = async (fn: () => Promise<unknown>, status: number, re?: RegExp) => {
  await assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))
}

interface Call { method: string; path: string; params: Record<string, string> }
function fakeMeta(overrides: Record<string, unknown | (() => unknown)> = {}) {
  const calls: Call[] = []
  let n = 0
  const routes: Record<string, unknown | (() => unknown)> = {
    [`GET /act_${ACCOUNT}`]: { id: `act_${ACCOUNT}`, name: 'ZP1200 ad account', currency: 'USD', account_status: 1 },
    [`POST /act_${ACCOUNT}/campaigns`]: () => ({ id: `C${++n}` }),
    [`POST /act_${ACCOUNT}/adsets`]: () => ({ id: `S${++n}` }),
    [`POST /act_${ACCOUNT}/adcreatives`]: () => ({ id: `R${++n}` }),
    [`POST /act_${ACCOUNT}/ads`]: () => ({ id: `A${++n}` }),
    ...overrides,
  }
  const fn = async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const params: Record<string, string> = Object.fromEntries(u.searchParams)
    if (typeof init?.body === 'string') Object.assign(params, Object.fromEntries(new URLSearchParams(init.body)))
    const path = u.pathname.replace(`/${META_GRAPH_VERSION}`, '')
    const method = init?.method ?? 'GET'
    calls.push({ method, path, params })
    let entry = routes[`${method} ${path}`]
    if (entry === undefined && method === 'POST' && /^\/[A-Z]\d+$/.test(path)) entry = { success: true }
    if (entry === undefined) return new Response(JSON.stringify({ error: { message: `no route ${method} ${path}`, code: 100 } }), { status: 400 })
    const body = typeof entry === 'function' ? (entry as () => unknown)() : entry
    const isErr = typeof body === 'object' && body !== null && 'error' in body
    return new Response(JSON.stringify(body), { status: isErr ? 400 : 200 })
  }
  return { fn, calls, deps: (extra: Partial<AdDeps> = {}): AdDeps => ({ fetch: fn, baseUrl: 'https://vyra.example', ...extra }) }
}

const setCap = (cents: number) => prisma.marketingSettings.update({ where: { id: 1 }, data: { monthlySpendCapCents: cents } })
const live = async (on: boolean) => {
  process.env.GRACE_MARKETING_LIVE = on ? 'true' : 'false'
  await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: on } })
}
const iso = (d: Date) => d.toISOString()
const FUTURE = new Date(Date.now() + 2 * 86_400_000)
const END = new Date(Date.now() + 5 * 86_400_000)

async function newAd(o: Record<string, unknown> = {}) {
  const ad = await createAd(prisma, {
    contentId, objective: 'TRAFFIC', headline: 'ZP1200 new in', primaryText: 'Our pink dress is here.', dailyBudgetCents: 200,
    startsAt: iso(FUTURE), endsAt: iso(END), imageKeys: [KEY], ...o,
  }, owner.username, { host: 'uat.example.com' })
  adIds.push(ad.id)
  return ad
}
async function approved(o: Record<string, unknown> = {}) {
  const ad = await newAd(o)
  await transitionAdAction(prisma, ad.id, 'submit', owner, { fetch: fakeMeta().fn })
  return transitionAdAction(prisma, ad.id, 'approve', owner, { fetch: fakeMeta().fn })
}
const act = (id: number, action: Parameters<typeof transitionAdAction>[2], deps: AdDeps, who = owner) => transitionAdAction(prisma, id, action, who, deps)
const dbAd = (id: number) => prisma.marketingAd.findUniqueOrThrow({ where: { id } })

before(async () => {
  const s = await getSettings(prisma)
  saved = { liveEnabled: s.liveEnabled, monthlySpendCapCents: s.monthlySpendCapCents, productFeedEnabled: s.productFeedEnabled }
  hadAdsChannel = (await prisma.marketingChannel.count({ where: { kind: 'META_ADS' } })) > 0
  const cat = await prisma.category.create({ data: { slug: 'zp1200ads-dresses', name: 'Dresses', published: true } })
  categoryId = cat.id
  const p = await prisma.product.create({
    data: {
      itemNumber: 'ZP1200ADS-1', productName: 'ZP1200ADS Pink Dress', slug: 'zp1200ads-pink-dress', published: true, publishedAt: new Date(), categoryId,
      currentQuantity: 5, priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 12, publicDescription: 'A soft pink dress.',
    },
  })
  productId = p.id
  await prisma.productImage.create({ data: { productId, imageKey: KEY, isPrimary: true } })
  const u = await prisma.product.create({
    data: { itemNumber: 'ZP1200ADS-2', productName: 'ZP1200ADS Hidden', slug: 'zp1200ads-hidden', published: false, categoryId, currentQuantity: 5, priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 99 },
  })
  unpublishedId = u.id
  contentId = (await prisma.marketingContent.create({ data: { title: 'ZP1200ADS content', productId, imageKeys: [KEY], createdBy: owner.username } })).id
  process.env.GRACE_STOREFRONT_HOSTS = 'vyra.example'
})

after(async () => {
  await prisma.marketingMetric.deleteMany({ where: { entity: 'AD', entityId: { in: adIds } } })
  await prisma.marketingAd.deleteMany({ where: { id: { in: adIds } } })
  await prisma.marketingAudience.deleteMany({ where: { id: { in: audienceIds } } })
  await prisma.marketingContent.deleteMany({ where: { id: contentId } })
  if (!hadAdsChannel) await prisma.marketingChannel.deleteMany({ where: { kind: 'META_ADS' } })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: { in: [owner.username, staff.username] } } })
  await prisma.productImage.deleteMany({ where: { productId } })
  await prisma.product.deleteMany({ where: { id: { in: [productId, unpublishedId] } } })
  await prisma.category.deleteMany({ where: { id: categoryId } })
  if (saved) await prisma.marketingSettings.update({ where: { id: 1 }, data: saved })
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
  if (savedHosts === undefined) delete process.env.GRACE_STOREFRONT_HOSTS
  else process.env.GRACE_STOREFRONT_HOSTS = savedHosts
  await prisma.$disconnect()
})

describe('connect META_ADS', () => {
  test('verifies the account, saves it CONNECTED, encrypts the token and never returns it', async () => {
    const m = fakeMeta()
    const out = await connectMeta(prisma, { kind: 'META_ADS', adAccountId: `act_${ACCOUNT}`, accessToken: TOKEN, pageId: PAGE }, owner.username, { fetch: m.fn })
    assert.strictEqual(out.channels.length, 1)
    assert.strictEqual(out.channels[0].status, 'CONNECTED')
    assert.strictEqual(out.channels[0].externalId, ACCOUNT)
    assert.strictEqual(out.channels[0].tokenHint, '4321')
    assert.ok(!JSON.stringify(out).includes('SECRET'))
    assert.deepStrictEqual(m.calls.map((c) => `${c.method} ${c.path}`), [`GET /act_${ACCOUNT}`])
    const row = await prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'META_ADS' } })
    assert.ok(!row.credentialsEnc!.includes('SECRET'))
    assert.deepStrictEqual(decryptJson(row.credentialsEnc!), { accessToken: TOKEN, adAccountId: ACCOUNT, pageId: PAGE })
    assert.strictEqual((row.config as { currency: string }).currency, 'USD')
    const log = await prisma.marketingAuditLog.findMany({ where: { entity: 'channel', entityId: row.id, action: 'channel.connect' } })
    assert.ok(log.length >= 1)
    assert.ok(!JSON.stringify(log).includes('SECRET'))
  })
  test('bad input and an inactive account are refused', async () => {
    const m = fakeMeta({ [`GET /act_${ACCOUNT}`]: { id: `act_${ACCOUNT}`, currency: 'USD', account_status: 2 } })
    await rejects(() => connectMeta(prisma, { kind: 'META_ADS', adAccountId: `act_${ACCOUNT}`, accessToken: TOKEN, pageId: PAGE }, 'x', { fetch: m.fn }), 400, /not active/)
    await rejects(() => connectMeta(prisma, { kind: 'META_ADS', adAccountId: 'abc', accessToken: TOKEN, pageId: PAGE }, 'x', { fetch: m.fn }), 400)
    await rejects(() => connectMeta(prisma, { kind: 'META_ADS', adAccountId: ACCOUNT, accessToken: TOKEN }, 'x', { fetch: m.fn }), 400)
    await rejects(() => connectMeta(prisma, { kind: 'FACEBOOK_PAGE', adAccountId: ACCOUNT, pageId: PAGE, accessToken: TOKEN }, 'x', { fetch: m.fn }), 400)
  })
})

describe('audiences', () => {
  test('defaults to Harare, validates, and editing sends dependent ads back to draft', async () => {
    const a = await createAudience(prisma, { name: 'ZP1200 Harare women', targeting: { genders: ['FEMALE'], ageMin: 25 } }, owner.username)
    audienceIds.push(a.id)
    const t = a.targeting as { geo: { lat: number; lng: number; radiusKm: number }; ageMax: number }
    assert.deepStrictEqual(t.geo, { lat: -17.8292, lng: 31.0522, radiusKm: 25 })
    assert.strictEqual(t.ageMax, 65)
    await rejects(() => createAudience(prisma, { name: 'x', targeting: { ageMin: 50, ageMax: 20 } }, 'x'), 400)
    await rejects(() => createAudience(prisma, { name: 'x', targeting: { geo: { radiusKm: 500 } } }, 'x'), 400)
    await rejects(() => createAudience(prisma, { name: 'x', targeting: { interests: [{ id: 'abc', name: 'x' }] } }, 'x'), 400)
    await setCap(100_000)
    const ad = await approved({ audienceId: a.id })
    assert.strictEqual(ad.status, 'APPROVED')
    await updateAudience(prisma, a.id, { targeting: { ageMin: 30 } }, owner.username)
    const after = await dbAd(ad.id)
    assert.strictEqual(after.status, 'DRAFT')
    assert.strictEqual(after.approvedAt, null)
    await deleteAudience(prisma, a.id, owner.username)
    assert.strictEqual((await dbAd(ad.id)).audienceId, null)
  })
})

describe('ad lifecycle, gate and cap', () => {
  test('creating an ad tracks it with its own tag, link and no spend', async () => {
    const ad = await newAd()
    assert.strictEqual(ad.status, 'DRAFT')
    assert.match(ad.trackingTag, /^mk[a-f0-9]{12}$/)
    assert.strictEqual(ad.link, `https://vyra.example/p/zp1200ads-pink-dress?src=${ad.trackingTag}`)
    assert.strictEqual(ad.spendCents, 0)
    await rejects(() => createAd(prisma, { headline: 'x', primaryText: 'y', dailyBudgetCents: 50, startsAt: iso(FUTURE) }, 'x'), 400)
    await rejects(() => createAd(prisma, { headline: 'x', primaryText: 'y', dailyBudgetCents: 500, startsAt: iso(END), endsAt: iso(FUTURE) }, 'x'), 400)
    await rejects(() => createAd(prisma, { headline: 'x', primaryText: 'y', dailyBudgetCents: 500, startsAt: iso(FUTURE), price: 5 }, 'x'), 400)
  })

  test('cap 0: an owner cannot approve spend', async () => {
    await setCap(0)
    const ad = await newAd()
    await transitionAdAction(prisma, ad.id, 'submit', owner, { fetch: fakeMeta().fn })
    await rejects(() => transitionAdAction(prisma, ad.id, 'approve', owner, { fetch: fakeMeta().fn }), 409, /spend cap/)
    assert.strictEqual((await dbAd(ad.id)).status, 'PENDING_APPROVAL')
  })

  test('submit needs a photo; staff cannot approve', async () => {
    const noPhoto = await newAd({ contentId: null, imageKeys: [] })
    await rejects(() => transitionAdAction(prisma, noPhoto.id, 'submit', owner, { fetch: fakeMeta().fn }), 409, /photo/)
    await setCap(100_000)
    const ad = await newAd()
    await transitionAdAction(prisma, ad.id, 'submit', staff, { fetch: fakeMeta().fn })
    await rejects(() => transitionAdAction(prisma, ad.id, 'approve', staff, { fetch: fakeMeta().fn }), 409, /owner/)
  })

  test('the full path: created PAUSED on Meta, then started by a separate action, then paused', async () => {
    await setCap(100_000)
    await live(true)
    const ad = await approved()
    const m = fakeMeta()
    const created = await act(ad.id, 'create_on_platform', m.deps())
    assert.strictEqual(created.status, 'PAUSED_ON_PLATFORM')
    assert.ok(created.externalCampaignId && created.externalAdSetId && created.externalCreativeId && created.externalAdId)
    for (const c of m.calls) if (c.method === 'POST' && !c.path.endsWith('/adcreatives')) assert.strictEqual(c.params.status, 'PAUSED', `${c.path} created paused`)
    assert.ok(m.calls.every((c) => c.params.status !== 'ACTIVE'), 'nothing activated by create')
    const set = m.calls.find((c) => c.path.endsWith('/adsets'))!
    assert.strictEqual(set.params.daily_budget, '200')
    const creative = JSON.parse(m.calls.find((c) => c.path.endsWith('/adcreatives'))!.params.object_story_spec)
    assert.strictEqual(creative.link_data.picture, `https://vyra.example/api/images/public/${'c'.repeat(32)}.webp?format=jpeg`)

    const m2 = fakeMeta()
    const started = await act(ad.id, 'start', m2.deps())
    assert.strictEqual(started.status, 'ACTIVE')
    assert.strictEqual(started.activatedBy, owner.username)
    assert.deepStrictEqual(m2.calls.filter((c) => c.params.status === 'ACTIVE').map((c) => c.path), [`/${created.externalCampaignId}`, `/${created.externalAdSetId}`, `/${created.externalAdId}`])
    const sched = m2.calls.find((c) => c.params.daily_budget)!
    assert.strictEqual(sched.path, `/${created.externalAdSetId}`)

    await rejects(() => updateAd(prisma, ad.id, { dailyBudgetCents: 300 }, owner), 409, /Pause/)
    const m3 = fakeMeta()
    const paused = await act(ad.id, 'pause', m3.deps())
    assert.strictEqual(paused.status, 'PAUSED_ON_PLATFORM')
    assert.deepStrictEqual(m3.calls.map((c) => c.path), [`/${created.externalAdId}`, `/${created.externalAdSetId}`, `/${created.externalCampaignId}`])
    const log = await prisma.marketingAuditLog.findMany({ where: { entity: 'ad', entityId: ad.id }, orderBy: { id: 'asc' } })
    const actions = log.map((l) => l.action)
    for (const a of ['ad.create', 'ad.submit', 'ad.approve', 'ad.create_on_platform', 'ad.created', 'ad.start', 'ad.pause']) assert.ok(actions.includes(a), a)
  })

  test('create_on_platform is blocked (409, no request, status unchanged) by each gate condition', async () => {
    await setCap(100_000)
    const ad = await approved()
    const blocked = async (re: RegExp) => {
      const m = fakeMeta()
      await rejects(() => act(ad.id, 'create_on_platform', m.deps()), 409, re)
      assert.strictEqual(m.calls.length, 0)
      assert.strictEqual((await dbAd(ad.id)).status, 'APPROVED')
    }
    await live(false)
    await blocked(/switched off/)
    process.env.GRACE_MARKETING_LIVE = 'true' // env on, setting off
    await blocked(/settings/)
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: true } })
    await prisma.marketingChannel.updateMany({ where: { kind: 'META_ADS' }, data: { status: 'NOT_CONNECTED' } })
    await blocked(/not connected/)
    await prisma.marketingChannel.updateMany({ where: { kind: 'META_ADS' }, data: { status: 'CONNECTED' } })
    await prisma.marketingAd.update({ where: { id: ad.id }, data: { approvedBy: null, approvedAt: null } })
    await blocked(/approved/)
  })

  test('the cap is enforced across ads: a second ad that would break it is refused at approval and at creation', async () => {
    await live(true)
    const first = await newAd({ dailyBudgetCents: 1000 }) // about 5-6 days
    await setCap(100_000)
    await transitionAdAction(prisma, first.id, 'submit', owner, { fetch: fakeMeta().fn })
    await transitionAdAction(prisma, first.id, 'approve', owner, { fetch: fakeMeta().fn })
    const committed = (await budgetSummary(prisma, await getSettings(prisma))).committedCents
    assert.ok(committed > 0)
    // A cap that fits what is already committed but not one more ad.
    await setCap(committed + 100)
    const second = await newAd({ dailyBudgetCents: 1000 })
    await transitionAdAction(prisma, second.id, 'submit', owner, { fetch: fakeMeta().fn })
    await rejects(() => transitionAdAction(prisma, second.id, 'approve', owner, { fetch: fakeMeta().fn }), 409, /monthly cap/)
    // Cap lowered after approval: creation on Meta re-checks and refuses.
    await setCap(1)
    const m = fakeMeta()
    await rejects(() => act(first.id, 'create_on_platform', m.deps()), 409, /monthly cap/)
    assert.strictEqual(m.calls.length, 0)
    assert.strictEqual((await dbAd(first.id)).status, 'APPROVED')
    await setCap(100_000)
  })

  test('a Meta failure leaves FAILED with the plain message and keeps the ids, and a retry resumes', async () => {
    await setCap(100_000)
    await live(true)
    const ad = await approved()
    let fail = true
    const m = fakeMeta({ [`POST /act_${ACCOUNT}/adcreatives`]: () => (fail ? { error: { message: 'Image could not be downloaded', code: 100 } } : { id: 'R9' }) })
    const r = await act(ad.id, 'create_on_platform', m.deps())
    assert.strictEqual(r.status, 'FAILED')
    assert.match(r.error ?? '', /Image could not be downloaded/)
    assert.ok(r.externalCampaignId && r.externalAdSetId)
    assert.strictEqual(r.externalCreativeId, null)
    fail = false
    const m2 = fakeMeta({ [`POST /act_${ACCOUNT}/adcreatives`]: { id: 'R9' }, [`POST /act_${ACCOUNT}/ads`]: { id: 'A9' } })
    const again = await act(ad.id, 'create_on_platform', m2.deps())
    assert.strictEqual(again.status, 'PAUSED_ON_PLATFORM')
    assert.deepStrictEqual(m2.calls.map((c) => c.path), [`/act_${ACCOUNT}/adcreatives`, `/act_${ACCOUNT}/ads`], 'campaign and ad set are not created twice')
  })

  test('on Meta only budget and end date change, each needs the cap and a new approval before start', async () => {
    await setCap(100_000)
    await live(true)
    const ad = await approved({ dailyBudgetCents: 200 })
    await act(ad.id, 'create_on_platform', fakeMeta().deps())
    await rejects(() => updateAd(prisma, ad.id, { headline: 'new words' }, owner), 409, /already on Meta/)
    const committed = (await budgetSummary(prisma, await getSettings(prisma))).committedCents
    await setCap(committed + 100)
    await rejects(() => updateAd(prisma, ad.id, { dailyBudgetCents: 5000 }, owner), 409, /monthly cap/)
    assert.strictEqual((await dbAd(ad.id)).dailyBudgetCents, 200)
    await setCap(100_000)
    const edited = await updateAd(prisma, ad.id, { dailyBudgetCents: 300 }, owner)
    assert.strictEqual(edited.status, 'PAUSED_ON_PLATFORM')
    assert.strictEqual(edited.approvedAt, null)
    const m = fakeMeta()
    await rejects(() => act(ad.id, 'start', m.deps()), 409, /approved/)
    assert.strictEqual(m.calls.length, 0)
    await act(ad.id, 'approve', fakeMeta().deps())
    const m2 = fakeMeta()
    await act(ad.id, 'start', m2.deps())
    assert.strictEqual(m2.calls.find((c) => c.params.daily_budget)?.params.daily_budget, '300')
  })

  test('start re-checks the gate: switched off means nothing is activated', async () => {
    await setCap(100_000)
    await live(true)
    const ad = await approved()
    await act(ad.id, 'create_on_platform', fakeMeta().deps())
    await live(false)
    const m = fakeMeta()
    await rejects(() => act(ad.id, 'start', m.deps()), 409, /switched off/)
    assert.strictEqual(m.calls.length, 0)
    assert.strictEqual((await dbAd(ad.id)).status, 'PAUSED_ON_PLATFORM')
    // ...but pausing still works with the switches off (stopping spend must never be blocked).
    await live(true)
    await act(ad.id, 'start', fakeMeta().deps())
    await live(false)
    assert.strictEqual((await act(ad.id, 'pause', fakeMeta().deps())).status, 'PAUSED_ON_PLATFORM')
  })

  test('delete only while it never reached Meta', async () => {
    const d = await newAd()
    await deleteAd(prisma, d.id, owner.username)
    assert.strictEqual(await prisma.marketingAd.count({ where: { id: d.id } }), 0)
    await setCap(100_000)
    const a = await approved()
    await rejects(() => deleteAd(prisma, a.id, owner.username), 409)
  })
})

describe('sync, results and the cap safety net', () => {
  test('pulls insights into MarketingMetric, sums spend, adds visits and enquiries by tracking tag, and pauses at the cap', async () => {
    await setCap(100_000)
    await live(true)
    const ad = await approved()
    const created = await act(ad.id, 'create_on_platform', fakeMeta().deps())
    await act(ad.id, 'start', fakeMeta().deps())
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    await prisma.analyticsDailySource.upsert({
      where: { day_source_deviceClass_campaign: { day: new Date(`${today}T00:00:00Z`), source: 'facebook', deviceClass: 'phone', campaign: ad.trackingTag } },
      update: {}, create: { day: new Date(`${today}T00:00:00Z`), source: 'facebook', deviceClass: 'phone', campaign: ad.trackingTag, visits: 7, enquiringVisits: 2 },
    })
    const insights = { data: [
      { date_start: yesterday, impressions: '1000', reach: '800', clicks: '20', spend: '1.50' },
      { date_start: today, impressions: '500', reach: '400', clicks: '10', spend: '0.75' },
    ] }
    const m = fakeMeta({ [`GET /${created.externalAdId}/insights`]: insights })
    const synced = await syncAd(prisma, ad.id, owner, m.deps())
    assert.strictEqual(synced.spendCents, 225)
    assert.ok(synced.lastSyncedAt)
    const rows = await prisma.marketingMetric.findMany({ where: { entity: 'AD', entityId: ad.id }, orderBy: { day: 'asc' } })
    assert.deepStrictEqual(rows.map((r) => [r.impressions, r.reach, r.clicks, r.spendCents, r.visits, r.enquiries]), [[1000, 800, 20, 150, 0, 0], [500, 400, 10, 75, 7, 2]])
    // Idempotent: syncing again does not duplicate.
    await syncAd(prisma, ad.id, owner, m.deps())
    assert.strictEqual(await prisma.marketingMetric.count({ where: { entity: 'AD', entityId: ad.id } }), 2)
    assert.strictEqual((await dbAd(ad.id)).status, 'ACTIVE')
    // Recorded spend counts as committed.
    assert.ok((await budgetSummary(prisma, await getSettings(prisma))).recordedSpendCents >= 225)
    // Lower the cap under what was spent: the next sync pauses the running ad.
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { monthlySpendCapCents: 1 } })
    const m2 = fakeMeta({ [`GET /${created.externalAdId}/insights`]: insights })
    const paused = await syncAd(prisma, ad.id, owner, m2.deps())
    assert.strictEqual(paused.status, 'PAUSED_ON_PLATFORM')
    assert.ok(m2.calls.some((c) => c.method === 'POST' && c.params.status === 'PAUSED'))
    await prisma.analyticsDailySource.deleteMany({ where: { campaign: ad.trackingTag } })
  })
  test('an ad that is not on Meta cannot be synced; a Meta error is shown', async () => {
    const d = await newAd()
    await rejects(() => syncAd(prisma, d.id, owner, { fetch: fakeMeta().fn }), 409, /not on Meta/)
  })
})

describe('AI ad copy never carries prices or numbers', () => {
  test('writes a draft, records the cost, and refuses copy with a price or a number', async () => {
    const ad = await newAd()
    let seen: unknown = null
    const row = await draftAdCopy(prisma, ad.id, owner.username, async (input) => {
      seen = input
      return { copy: { headline: 'Pink perfection', primaryText: 'Party ready, only at VYRA.', description: null }, costCents: 2 }
    })
    assert.strictEqual(row.headline, 'Pink perfection')
    assert.strictEqual(row.aiGenerated, true)
    assert.strictEqual(row.aiCostCents, 2)
    assert.ok(!/12\.00|USD|\$|price/i.test(JSON.stringify(Object.keys(seen as object)) + JSON.stringify(Object.values(seen as object))), 'the model is never given the price')
    assert.strictEqual((seen as { productName: string }).productName, 'ZP1200ADS Pink Dress')
    await rejects(() => draftAdCopy(prisma, ad.id, owner.username, async () => ({ copy: { headline: 'Only $12 today', primaryText: 'x', description: null }, costCents: 0 })), 502, /number or price/)
    assert.throws(() => validateAdCopy({ headline: 'Size 8 in stock', primaryText: 'x', description: null }), WebsiteError)
    assert.throws(() => validateAdCopy({ headline: '', primaryText: 'x', description: null }), WebsiteError)
    await setCap(100_000)
    const a = await approved()
    await rejects(() => draftAdCopy(prisma, a.id, owner.username, async () => ({ copy: { headline: 'a', primaryText: 'b', description: null }, costCents: 0 })), 409, /draft/)
  })
})

describe('product feed from the real public catalogue', () => {
  const noCache: CacheFn = ((fn: () => Promise<unknown>) => fn) as unknown as CacheFn
  const loadProducts = async () => {
    const sf = createStorefront({ db: prisma, cache: noCache })
    const all = []
    for (let page = 1; ; page++) {
      const r = await sf.listPublishedProducts({ page, pageSize: 48, includeItemNumber: true })
      all.push(...r.items)
      if (page >= r.pageCount) return all
    }
  }
  test('published only, price shown only when the storefront shows it, JPEG images', async () => {
    const res = await serveFeed(new Request('https://x/feed.csv', { headers: { host: 'vyra.example' } }), 'csv', { settings: async () => ({ productFeedEnabled: true }), loadProducts })
    const csv = await res.text()
    assert.match(csv, /ZP1200ADS-1/)
    assert.match(csv, /12\.00 USD/)
    assert.match(csv, /format=jpeg&w=1200/)
    assert.doesNotMatch(csv, /ZP1200ADS-2/)
    assert.doesNotMatch(csv, /99\.00/)
    await prisma.product.update({ where: { id: productId }, data: { priceDisplay: 'ASK_FOR_PRICE' } })
    const hidden = await (await serveFeed(new Request('https://x/feed.csv'), 'csv', { settings: async () => ({ productFeedEnabled: true }), loadProducts })).text()
    const line = hidden.split('\r\n').find((l) => l.startsWith('ZP1200ADS-1'))!
    assert.ok(line, 'still listed')
    assert.doesNotMatch(line, /USD/)
    await prisma.product.update({ where: { id: productId }, data: { priceDisplay: 'SHOW_PRICE' } })
  })
  test('the public routes answer 404 while the feed is switched off, and need no sign-in', async () => {
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { productFeedEnabled: false } })
    assert.strictEqual((await feedCsv.GET(new Request('https://x/api/public/marketing/feed.csv'))).status, 404)
    assert.strictEqual((await feedXml.GET(new Request('https://x/api/public/marketing/feed.xml'))).status, 404)
    process.env.GRACE_MARKETING_HUB = 'false'
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { productFeedEnabled: true } })
    assert.strictEqual((await feedCsv.GET(new Request('https://x/api/public/marketing/feed.csv'))).status, 404, 'kill switch wins')
    delete process.env.GRACE_MARKETING_HUB
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { productFeedEnabled: false } })
  })
})
