// ZP-1200: Google Ads through the same ad steps as Meta, and the X token refresh through publishPost, against DATABASE_URL
// with fake fetches (no network). Only touches rows it creates (ads/content "ZP1200G", the GOOGLE_ADS and X channels it creates).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { connectMeta } from '../src/lib/marketing/connect'
import { createAd, syncAd, transitionAdAction, updateAd, type AdDeps } from '../src/lib/marketing/ads'
import { GOOGLE_ADS_BASE } from '../src/lib/marketing/connectors/google-ads'
import { GOOGLE_TOKEN_URL } from '../src/lib/marketing/connectors/google-oauth'
import { X_API, X_TOKEN_URL } from '../src/lib/marketing/connectors/x'
import { publishPost } from '../src/lib/marketing/publish'
import { decryptJson } from '../src/lib/marketing/secrets'
import { getSettings } from '../src/lib/marketing/settings'
import { generateTrackingTag } from '../src/lib/marketing/tracking'
import { WebsiteError } from '../src/lib/website/http'

const owner = { username: 'zp1200g-owner', role: 'OWNER' as const }
const staff = { username: 'zp1200g-staff', role: 'STAFF' as const }
const savedEnv = process.env.GRACE_MARKETING_LIVE
let saved: { liveEnabled: boolean; monthlySpendCapCents: number } | null = null
const had = { GOOGLE_ADS: false, X: false, META_ADS: false }
const adIds: number[] = []
const postIds: number[] = []
let contentId = 0

const rejects = (fn: () => Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))

const CUSTOMER = '1234567890'
const GCREDS = { kind: 'GOOGLE_ADS', customerId: '123-456-7890', loginCustomerId: '', developerToken: 'DEV-SECRET-7777', clientId: 'cid', clientSecret: 'csecret', refreshToken: 'REFRESH-SECRET-4242' }

interface Call { method: string; url: string; body: string; headers: Record<string, string> }
function fakeGoogle(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = []
  let n = 100
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: String(init?.body ?? ''), headers: { ...(init?.headers as Record<string, string>) } })
    if (url === GOOGLE_TOKEN_URL) return new Response(JSON.stringify({ access_token: 'ACCESS-SECRET' }), { status: 200 })
    const path = url.replace(GOOGLE_ADS_BASE, '')
    if (path in overrides) return new Response(JSON.stringify(overrides[path]), { status: 'error' in (overrides[path] as object) ? 403 : 200 })
    if (path.endsWith('/googleAds:search')) {
      const q = (JSON.parse(String(init?.body)) as { query: string }).query
      if (q.includes('FROM customer')) return new Response(JSON.stringify({ results: [{ customer: { id: CUSTOMER, descriptiveName: 'ZP1200G account', currencyCode: 'USD', status: 'ENABLED' } }] }))
      return new Response(JSON.stringify({ results: [{ segments: { date: new Date().toISOString().slice(0, 10) }, metrics: { costMicros: '2500000', impressions: '400', clicks: '9' } }] }))
    }
    const m = /^\/customers\/(\d+)\/(\w+):mutate$/.exec(path)
    if (m) {
      const op = (JSON.parse(String(init?.body)) as { operations: { update?: { resourceName: string } }[] }).operations[0]
      n += 1
      const name = op.update?.resourceName ?? (m[2] === 'adGroupAds' ? `customers/${m[1]}/adGroupAds/${n - 1}~${n}` : `customers/${m[1]}/${m[2]}/${n}`)
      return new Response(JSON.stringify({ results: [{ resourceName: name }] }))
    }
    return new Response(JSON.stringify({ error: { message: 'no route' } }), { status: 404 })
  }
  return { fn, calls, deps: (): AdDeps => ({ fetch: fn }) }
}
const mutateCalls = (c: Call[]) => c.filter((x) => x.url.endsWith(':mutate'))

const setCap = (cents: number) => prisma.marketingSettings.update({ where: { id: 1 }, data: { monthlySpendCapCents: cents } })
const live = async (on: boolean) => {
  process.env.GRACE_MARKETING_LIVE = on ? 'true' : 'false'
  await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: on } })
}
const FUTURE = new Date(Date.now() + 2 * 86_400_000)
const END = new Date(Date.now() + 5 * 86_400_000)
async function newAd(o: Record<string, unknown> = {}) {
  const ad = await createAd(prisma, {
    channelKind: 'GOOGLE_ADS', objective: 'TRAFFIC', headline: 'ZP1200G pink dress', primaryText: 'Our pink dress is here. Made for summer evenings.', dailyBudgetCents: 200,
    startsAt: FUTURE.toISOString(), endsAt: END.toISOString(), ...o,
  }, owner.username, { host: 'uat.example.com' })
  adIds.push(ad.id)
  return ad
}
const dbAd = (id: number) => prisma.marketingAd.findUniqueOrThrow({ where: { id } })
const step = (id: number, a: Parameters<typeof transitionAdAction>[2], deps: AdDeps, who: { username: string; role: 'OWNER' | 'STAFF' } = owner) => transitionAdAction(prisma, id, a, who, deps)
async function approved(o: Record<string, unknown> = {}) {
  const ad = await newAd(o)
  const none = fakeGoogle().deps()
  await step(ad.id, 'submit', none)
  return step(ad.id, 'approve', none)
}

before(async () => {
  const s = await getSettings(prisma)
  saved = { liveEnabled: s.liveEnabled, monthlySpendCapCents: s.monthlySpendCapCents }
  for (const k of Object.keys(had) as (keyof typeof had)[]) had[k] = (await prisma.marketingChannel.count({ where: { kind: k } })) > 0
  contentId = (await prisma.marketingContent.create({ data: { title: 'ZP1200G content', createdBy: owner.username } })).id
  process.env.GRACE_STOREFRONT_HOSTS = process.env.GRACE_STOREFRONT_HOSTS || 'vyra.example'
})

after(async () => {
  await prisma.marketingMetric.deleteMany({ where: { entity: 'AD', entityId: { in: adIds } } })
  await prisma.marketingAd.deleteMany({ where: { id: { in: adIds } } })
  await prisma.marketingPost.deleteMany({ where: { id: { in: postIds } } })
  await prisma.marketingContent.deleteMany({ where: { id: contentId } })
  for (const k of ['GOOGLE_ADS', 'X'] as const) if (!had[k]) await prisma.marketingChannel.deleteMany({ where: { kind: k } })
  await prisma.marketingAuditLog.deleteMany({ where: { OR: [{ actor: { in: [owner.username, staff.username] } }, { entity: 'ad', entityId: { in: adIds } }, { entity: 'post', entityId: { in: postIds } }] } })
  if (saved) await prisma.marketingSettings.update({ where: { id: 1 }, data: saved })
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
  await prisma.$disconnect()
})

describe('connect GOOGLE_ADS', () => {
  test('verifies with a read-only GAQL call, strips dashes, saves encrypted and never returns a secret', async () => {
    const g = fakeGoogle()
    const out = await connectMeta(prisma, GCREDS, owner.username, { fetch: g.fn })
    assert.strictEqual(out.channels[0].status, 'CONNECTED')
    assert.strictEqual(out.channels[0].externalId, CUSTOMER)
    assert.strictEqual(out.channels[0].tokenHint, '4242')
    assert.ok(!/SECRET/.test(JSON.stringify(out)))
    assert.deepStrictEqual(g.calls.map((c) => c.url), [GOOGLE_TOKEN_URL, `${GOOGLE_ADS_BASE}/customers/${CUSTOMER}/googleAds:search`])
    assert.strictEqual(g.calls[1].headers['developer-token'], 'DEV-SECRET-7777')
    const row = await prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'GOOGLE_ADS' } })
    assert.ok(!row.credentialsEnc!.includes('SECRET'))
    const c = decryptJson<Record<string, string>>(row.credentialsEnc!)
    assert.strictEqual(c.customerId, CUSTOMER)
    assert.strictEqual(c.developerToken, 'DEV-SECRET-7777')
    assert.deepStrictEqual(row.config, { customerId: CUSTOMER, loginCustomerId: '', clientId: 'cid', currency: 'USD', accountName: 'ZP1200G account' })
    assert.ok(!JSON.stringify(row.config).includes('SECRET'))
    await rejects(() => connectMeta(prisma, { ...GCREDS, developerToken: '' }, 'x', { fetch: g.fn }), 400, /Developer token/)
    await rejects(() => connectMeta(prisma, { ...GCREDS, customerId: 'abc' }, 'x', { fetch: g.fn }), 400)
    await rejects(() => connectMeta(prisma, { ...GCREDS, extra: '1' }, 'x', { fetch: g.fn }), 400)
  })
})

describe('Google ad: same steps as Meta', () => {
  test('Google needs the "visits" objective and no photo; the Meta default is unchanged', async () => {
    await rejects(() => createAd(prisma, { channelKind: 'GOOGLE_ADS', objective: 'ENGAGEMENT', headline: 'x', primaryText: 'y', dailyBudgetCents: 200, startsAt: FUTURE.toISOString() }, 'x'), 400, /visits/)
    await rejects(() => createAd(prisma, { channelKind: 'TIKTOK', headline: 'x', primaryText: 'y', dailyBudgetCents: 200, startsAt: FUTURE.toISOString() }, 'x'), 400)
    const meta = await createAd(prisma, { objective: 'TRAFFIC', headline: 'ZP1200G meta', primaryText: 'y', dailyBudgetCents: 200, startsAt: FUTURE.toISOString() }, owner.username, { host: 'uat.example.com' })
    adIds.push(meta.id)
    assert.strictEqual(meta.channelKind, 'META_ADS')
    const g = await newAd()
    assert.strictEqual(g.channelKind, 'GOOGLE_ADS')
    assert.ok(g.link && g.link.includes(`src=${g.trackingTag}`))
    const none = fakeGoogle().deps()
    assert.strictEqual((await step(g.id, 'submit', none)).status, 'PENDING_APPROVAL') // no photo needed
    await rejects(() => step(meta.id, 'submit', none), 409, /photo/) // Meta still needs one
  })

  test('approve (cap), create paused, start (separate action), pause, sync: every money step is gated and capped, zero requests when blocked', async () => {
    await live(false)
    await setCap(0)
    const blocked = await newAd()
    const none = fakeGoogle()
    await step(blocked.id, 'submit', none.deps())
    await rejects(() => step(blocked.id, 'approve', none.deps()), 409, /monthly spend cap/) // cap 0
    await setCap(100_000)
    await assert.rejects(() => step(blocked.id, 'approve', none.deps(), staff), /Only the owner/)
    await step(blocked.id, 'approve', none.deps())
    // create: env off, then settings off, then channel not connected, then ok
    await rejects(() => step(blocked.id, 'create_on_platform', none.deps()), 409, /switched off on this server/)
    process.env.GRACE_MARKETING_LIVE = 'true'
    await rejects(() => step(blocked.id, 'create_on_platform', none.deps()), 409, /marketing settings/)
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: true } })
    const ch = await prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'GOOGLE_ADS' } })
    await prisma.marketingChannel.update({ where: { id: ch.id }, data: { status: 'NOT_CONNECTED' } })
    await rejects(() => step(blocked.id, 'create_on_platform', none.deps()), 409, /not connected/)
    await prisma.marketingChannel.update({ where: { id: ch.id }, data: { status: 'CONNECTED' } })
    await setCap(100) // $1 a month: this ad would commit far more
    await rejects(() => step(blocked.id, 'create_on_platform', none.deps()), 409, /monthly cap/)
    assert.strictEqual(none.calls.length, 0, 'no request at all while blocked')
    assert.strictEqual((await dbAd(blocked.id)).status, 'APPROVED')

    await setCap(100_000)
    const g = fakeGoogle()
    const made = await step(blocked.id, 'create_on_platform', g.deps())
    assert.strictEqual(made.status, 'PAUSED_ON_PLATFORM')
    assert.ok(made.externalCampaignId && made.externalAdSetId && made.externalCreativeId && made.externalAdId)
    const creates = mutateCalls(g.calls).map((c) => ({ svc: c.url.split('/').pop(), op: JSON.parse(c.body).operations[0] }))
    assert.deepStrictEqual(creates.map((c) => c.svc), ['campaignBudgets:mutate', 'campaigns:mutate', 'adGroups:mutate', 'adGroupAds:mutate'])
    assert.ok(creates.every((c) => !c.op.updateMask && (c.op.create.status === 'PAUSED' || c.svc === 'campaignBudgets:mutate')))
    assert.strictEqual(creates[0].op.create.amountMicros, '2000000')
    assert.ok(g.calls.every((c) => c.url === GOOGLE_TOKEN_URL || c.url.startsWith(GOOGLE_ADS_BASE)), 'only Google was called')

    // start: gate off -> nothing activated
    await live(false)
    const s0 = fakeGoogle()
    await rejects(() => step(blocked.id, 'start', s0.deps()), 409, /switched off/)
    assert.strictEqual(s0.calls.length, 0)
    await live(true)
    const s1 = fakeGoogle()
    const running = await step(blocked.id, 'start', s1.deps())
    assert.strictEqual(running.status, 'ACTIVE')
    const sc = mutateCalls(s1.calls).map((c) => `${c.url.split('/').pop()} ${JSON.parse(c.body).operations[0].updateMask}`)
    assert.deepStrictEqual(sc, ['campaignBudgets:mutate amount_micros', 'campaigns:mutate end_date_time', 'campaigns:mutate status', 'adGroups:mutate status', 'adGroupAds:mutate status'])

    // sync: insights from GAQL, spend recorded
    const s2 = fakeGoogle()
    const synced = await syncAd(prisma, blocked.id, owner, s2.deps())
    assert.strictEqual(synced.spendCents, 250)
    const metric = await prisma.marketingMetric.findFirstOrThrow({ where: { entity: 'AD', entityId: blocked.id } })
    assert.deepStrictEqual([metric.impressions, metric.clicks, metric.spendCents], [400, 9, 250])

    // pause works with every switch off (stopping spend is never blocked)
    await live(false)
    const p = fakeGoogle()
    const paused = await step(blocked.id, 'pause', p.deps())
    assert.strictEqual(paused.status, 'PAUSED_ON_PLATFORM')
    assert.deepStrictEqual(mutateCalls(p.calls).map((c) => c.url.split('/').pop()), ['adGroupAds:mutate', 'adGroups:mutate', 'campaigns:mutate'])
    await live(true)
  })

  test('a Google refusal fails the ad with the plain message, keeps the ids, and a budget change on a live ad needs the cap again', async () => {
    await live(true)
    await setCap(100_000)
    const ad = await approved()
    const bad = fakeGoogle({ [`/customers/${CUSTOMER}/adGroups:mutate`]: { error: { message: 'Developer token is not approved' } } })
    const failed = await step(ad.id, 'create_on_platform', bad.deps())
    assert.strictEqual(failed.status, 'FAILED')
    assert.match(failed.error ?? '', /Basic access/)
    assert.ok(failed.externalCampaignId && failed.externalCreativeId && !failed.externalAdSetId)
    assert.ok(!JSON.stringify(failed).includes('SECRET'))
    // retry resumes: only the ad group and the ad are made, the budget and campaign are not duplicated
    const good = fakeGoogle()
    const again = await step(ad.id, 'create_on_platform', good.deps())
    assert.strictEqual(again.status, 'PAUSED_ON_PLATFORM')
    assert.deepStrictEqual(mutateCalls(good.calls).map((c) => c.url.split('/').pop()), ['adGroups:mutate', 'adGroupAds:mutate'])
    assert.strictEqual(again.externalCampaignId, failed.externalCampaignId)
    // changing the budget of a live ad: the cap is checked and approval is asked again
    await setCap(1)
    await assert.rejects(() => updateAd(prisma, ad.id, { dailyBudgetCents: 900 }, owner), /monthly cap|spend cap/)
    await setCap(100_000)
    const edited = await updateAd(prisma, ad.id, { dailyBudgetCents: 300 }, owner)
    assert.strictEqual(edited.approvedAt, null)
  })
})

describe('X token refresh through publishPost', () => {
  const XCREDS = { kind: 'X', clientId: 'xcid', clientSecret: '', refreshToken: 'XREFRESH-SECRET-1111', accessToken: 'XACCESS-SECRET-2222' }
  function fakeX(tokens: { access: string; refresh: string } | 'reject') {
    const calls: { url: string; auth: string | undefined; body: string }[] = []
    const fn = async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
      calls.push({ url, auth, body: String(init?.body ?? '') })
      if (url === `${X_API}/users/me`) return new Response(JSON.stringify({ data: { id: '42', username: 'vyra' } }))
      if (url === X_TOKEN_URL) {
        return tokens === 'reject'
          ? new Response(JSON.stringify({ error: 'invalid_request', error_description: 'Value passed for the token was invalid.' }), { status: 400 })
          : new Response(JSON.stringify({ access_token: tokens.access, refresh_token: tokens.refresh, expires_in: 7200 }))
      }
      if (url === `${X_API}/tweets`) return new Response(JSON.stringify({ data: { id: '9001' } }), { status: 201 })
      return new Response('{}', { status: 404 })
    }
    return { fn, calls }
  }
  async function xPost() {
    const ch = await prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'X' } })
    const p = await prisma.marketingPost.create({
      data: { contentId, channelKind: 'X', channelId: ch.id, format: 'POST', text: 'ZP1200G hello', imageKeys: [], trackingTag: generateTrackingTag(), status: 'APPROVED', approvedBy: owner.username, approvedAt: new Date(), createdBy: owner.username },
    })
    postIds.push(p.id)
    return { post: p, channelId: ch.id }
  }

  test('refreshes before the post, saves both new tokens encrypted, and uses the new access token', async () => {
    await live(true)
    await connectMeta(prisma, XCREDS, owner.username, { fetch: fakeX({ access: 'x', refresh: 'x' }).fn })
    const { post, channelId } = await xPost()
    const f = fakeX({ access: 'XNEWACCESS-SECRET-3333', refresh: 'XNEWREFRESH-SECRET-4444' })
    const r = await publishPost(prisma, post.id, owner, { fetch: f.fn })
    assert.strictEqual(r.status, 'PUBLISHED')
    assert.deepStrictEqual(f.calls.map((c) => c.url), [X_TOKEN_URL, `${X_API}/tweets`])
    assert.strictEqual(f.calls[1].auth, 'Bearer XNEWACCESS-SECRET-3333')
    const row = await prisma.marketingChannel.findUniqueOrThrow({ where: { id: channelId } })
    assert.ok(!row.credentialsEnc!.includes('SECRET'))
    const saved = decryptJson<Record<string, string>>(row.credentialsEnc!)
    assert.strictEqual(saved.accessToken, 'XNEWACCESS-SECRET-3333')
    assert.strictEqual(saved.refreshToken, 'XNEWREFRESH-SECRET-4444')
    assert.strictEqual(saved.clientId, 'xcid')
    assert.strictEqual(row.tokenHint, '3333')
    const log = await prisma.marketingAuditLog.findMany({ where: { entity: 'channel', entityId: channelId, action: 'channel.credentials_refreshed' } })
    assert.strictEqual(log.length, 1)
    assert.ok(!JSON.stringify(log).includes('SECRET'))
  })

  test('a rejected refresh token fails the post, marks the channel ERROR, and posts nothing', async () => {
    const { post, channelId } = await xPost()
    const before = (await prisma.marketingChannel.findUniqueOrThrow({ where: { id: channelId } })).credentialsEnc
    const f = fakeX('reject')
    const r = await publishPost(prisma, post.id, owner, { fetch: f.fn })
    assert.strictEqual(r.status, 'FAILED')
    assert.match(r.error ?? '', /connect the channel again/)
    assert.ok(!JSON.stringify(r).includes('SECRET'))
    assert.deepStrictEqual(f.calls.map((c) => c.url), [X_TOKEN_URL])
    const row = await prisma.marketingChannel.findUniqueOrThrow({ where: { id: channelId } })
    assert.strictEqual(row.status, 'ERROR')
    assert.strictEqual(row.credentialsEnc, before)
  })

  test('the gate still runs first: with live off there is no refresh request', async () => {
    await connectMeta(prisma, XCREDS, owner.username, { fetch: fakeX({ access: 'x', refresh: 'x' }).fn })
    const { post } = await xPost()
    await live(false)
    const f = fakeX({ access: 'a', refresh: 'b' })
    await rejects(() => publishPost(prisma, post.id, owner, { fetch: f.fn }), 409)
    assert.strictEqual(f.calls.length, 0)
    await live(true)
  })
})
