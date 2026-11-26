// ZP-1200: Meta ads connector, Pixel (Conversions API) and the storefront pixel gate against a fake fetch. No network, no database.
import { describe, test, beforeEach, after } from 'node:test'
import assert from 'node:assert'
import {
  activateAd, buildTargeting, createPausedAd, fetchAdInsights, pauseAd, updateAdSchedule, verifyAdAccount, type AdsContext, type MetaAdSpec,
} from '../src/lib/marketing/connectors/meta-ads'
import { buildUserData, checkPixelGate, sendEvent } from '../src/lib/marketing/connectors/meta-pixel'
import { META_GRAPH_VERSION } from '../src/lib/marketing/connectors/meta-graph'
import { pixelConfigForStorefront } from '../src/lib/marketing/pixel'
import { assertWithinCap } from '../src/lib/marketing/budget'

const savedEnv = process.env.GRACE_MARKETING_LIVE
beforeEach(() => { process.env.GRACE_MARKETING_LIVE = 'true' })
after(() => { if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE; else process.env.GRACE_MARKETING_LIVE = savedEnv })

interface Call { method: string; path: string; params: Record<string, string>; auth: string }
function fakeFetch(routes: Record<string, unknown | ((c: Call) => unknown)>) {
  const calls: Call[] = []
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const params: Record<string, string> = Object.fromEntries(u.searchParams)
    if (typeof init?.body === 'string') Object.assign(params, Object.fromEntries(new URLSearchParams(init.body)))
    const path = u.pathname.replace(`/${META_GRAPH_VERSION}`, '')
    const call: Call = { method: init?.method ?? 'GET', path, params, auth: String((init?.headers as Record<string, string>)?.Authorization ?? '') }
    calls.push(call)
    const entry = routes[`${call.method} ${path}`]
    if (entry === undefined) return new Response(JSON.stringify({ error: { message: `no route ${call.method} ${path}`, code: 100 } }), { status: 400 })
    const body = typeof entry === 'function' ? (entry as (c: Call) => unknown)(call) : entry
    const isErr = typeof body === 'object' && body !== null && 'error' in body
    return new Response(JSON.stringify(body), { status: isErr ? 400 : 200 })
  }
  return { fn, calls }
}

const gate = () => ({ settings: { liveEnabled: true }, channel: { status: 'CONNECTED', credentialsEnc: 'v1:x' }, post: { approvedBy: 'o', approvedAt: new Date() } })
const ctx = (fetchFn: AdsContext['fetch'], o: Partial<AdsContext> = {}): AdsContext => ({
  credentials: { accessToken: 'TOKEN-SECRET-1234', adAccountId: '555123456', pageId: '777000111' }, fetch: fetchFn, gate: gate(), capCheck: () => {}, currency: 'USD', ...o,
})
const spec = (o: Partial<MetaAdSpec> = {}): MetaAdSpec => ({
  id: 1, trackingTag: 'mkabc123', objective: 'TRAFFIC', headline: 'New in', primaryText: 'Our pink dress is here.', description: 'Shop now',
  link: 'https://shop.example/p/pink?src=mkabc123', imageUrl: 'https://shop.example/api/images/public/aaa.webp?format=jpeg', dailyBudgetCents: 500,
  startsAt: new Date('2026-12-01T00:00:00Z'), endsAt: new Date('2026-12-08T00:00:00Z'), targeting: null, ...o,
})
const createRoutes = () => ({
  'POST /act_555123456/campaigns': { id: 'C1' },
  'POST /act_555123456/adsets': { id: 'S1' },
  'POST /act_555123456/adcreatives': { id: 'R1' },
  'POST /act_555123456/ads': { id: 'A1' },
})

describe('createPausedAd request shapes', () => {
  test('campaign, ad set, creative, ad: all PAUSED, in order, token only in the header', async () => {
    const f = fakeFetch(createRoutes())
    const r = await createPausedAd(ctx(f.fn), spec())
    assert.deepStrictEqual(r, { ok: true, ids: { campaignId: 'C1', adSetId: 'S1', creativeId: 'R1', adId: 'A1' } })
    assert.deepStrictEqual(f.calls.map((c) => c.path), ['/act_555123456/campaigns', '/act_555123456/adsets', '/act_555123456/adcreatives', '/act_555123456/ads'])
    const [camp, set, cre, ad] = f.calls
    assert.strictEqual(camp.params.objective, 'OUTCOME_TRAFFIC')
    assert.strictEqual(camp.params.status, 'PAUSED')
    assert.strictEqual(camp.params.special_ad_categories, '[]')
    assert.strictEqual(set.params.campaign_id, 'C1')
    assert.strictEqual(set.params.daily_budget, '500')
    assert.strictEqual(set.params.billing_event, 'IMPRESSIONS')
    assert.strictEqual(set.params.optimization_goal, 'LINK_CLICKS')
    assert.strictEqual(set.params.bid_strategy, 'LOWEST_COST_WITHOUT_CAP')
    assert.strictEqual(set.params.status, 'PAUSED')
    assert.strictEqual(set.params.start_time, '2026-12-01T00:00:00.000Z')
    assert.strictEqual(set.params.end_time, '2026-12-08T00:00:00.000Z')
    const t = JSON.parse(set.params.targeting)
    assert.deepStrictEqual(t.geo_locations.custom_locations, [{ latitude: -17.8292, longitude: 31.0522, radius: 25, distance_unit: 'kilometer' }])
    assert.strictEqual(t.age_min, 18)
    assert.strictEqual(t.age_max, 65)
    const oss = JSON.parse(cre.params.object_story_spec)
    assert.strictEqual(oss.page_id, '777000111')
    assert.strictEqual(oss.link_data.link, spec().link)
    assert.strictEqual(oss.link_data.message, 'Our pink dress is here.')
    assert.strictEqual(oss.link_data.name, 'New in')
    assert.strictEqual(oss.link_data.picture, spec().imageUrl)
    assert.strictEqual(oss.link_data.call_to_action.type, 'SHOP_NOW')
    assert.deepStrictEqual(JSON.parse(ad.params.creative), { creative_id: 'R1' })
    assert.strictEqual(ad.params.adset_id, 'S1')
    assert.strictEqual(ad.params.status, 'PAUSED')
    for (const c of f.calls) {
      assert.strictEqual(c.auth, 'Bearer TOKEN-SECRET-1234')
      assert.ok(!JSON.stringify(c.params).includes('TOKEN-SECRET'))
    }
  })
  test('click to WhatsApp uses CONVERSATIONS, destination WHATSAPP and the WHATSAPP_MESSAGE button', async () => {
    const f = fakeFetch(createRoutes())
    await createPausedAd(ctx(f.fn), spec({ objective: 'CLICK_TO_WHATSAPP', link: null }))
    assert.strictEqual(f.calls[0].params.objective, 'OUTCOME_ENGAGEMENT')
    assert.strictEqual(f.calls[1].params.optimization_goal, 'CONVERSATIONS')
    assert.strictEqual(f.calls[1].params.destination_type, 'WHATSAPP')
    assert.strictEqual(JSON.parse(f.calls[2].params.object_story_spec).link_data.call_to_action.type, 'WHATSAPP_MESSAGE')
  })
  test('engagement objective', async () => {
    const f = fakeFetch(createRoutes())
    await createPausedAd(ctx(f.fn), spec({ objective: 'ENGAGEMENT' }))
    assert.strictEqual(f.calls[0].params.objective, 'OUTCOME_ENGAGEMENT')
    assert.strictEqual(JSON.parse(f.calls[2].params.object_story_spec).link_data.call_to_action.type, 'LEARN_MORE')
  })
  test('targeting: one gender, interests, custom radius', () => {
    const t = buildTargeting({ geo: { lat: 1, lng: 2, radiusKm: 10 }, ageMin: 25, ageMax: 40, genders: ['FEMALE'], interests: [{ id: '6003', name: 'Fashion' }] }) as Record<string, unknown>
    assert.deepStrictEqual(t.genders, [2])
    assert.deepStrictEqual(t.flexible_spec, [{ interests: [{ id: '6003', name: 'Fashion' }] }])
    assert.strictEqual(t.age_min, 25)
    assert.strictEqual((buildTargeting({ geo: { lat: 1, lng: 2, radiusKm: 10 }, ageMin: 18, ageMax: 65, genders: ['MALE', 'FEMALE'], interests: [] }) as Record<string, unknown>).genders, undefined)
  })
  test('resumes: ids from an earlier attempt are not created twice', async () => {
    const f = fakeFetch({ 'POST /act_555123456/adcreatives': { id: 'R2' }, 'POST /act_555123456/ads': { id: 'A2' } })
    const r = await createPausedAd(ctx(f.fn), spec({ existing: { campaignId: 'C1', adSetId: 'S1' } }))
    assert.deepStrictEqual(f.calls.map((c) => c.path), ['/act_555123456/adcreatives', '/act_555123456/ads'])
    assert.ok(r.ok)
  })
  test("a Meta error is shown plainly and the ids made so far are returned", async () => {
    const f = fakeFetch({ ...createRoutes(), 'POST /act_555123456/adcreatives': { error: { message: 'Invalid image', code: 100 } } })
    const r = await createPausedAd(ctx(f.fn), spec())
    assert.ok(!r.ok)
    if (!r.ok) {
      assert.match(r.error, /Invalid image/)
      assert.deepStrictEqual(r.ids, { campaignId: 'C1', adSetId: 'S1', creativeId: null, adId: null })
    }
  })
  test('daily budget under $1 is refused before any request', async () => {
    const f = fakeFetch(createRoutes())
    const r = await createPausedAd(ctx(f.fn), spec({ dailyBudgetCents: 50 }))
    assert.ok(!r.ok)
    assert.strictEqual(f.calls.length, 0)
  })
})

describe('gate and cap block BEFORE any fetch', () => {
  const noCall = (name: string, build: (c: AdsContext) => Promise<{ ok: boolean; error?: string }>, expect: RegExp, over: (cur: AdsContext) => Partial<AdsContext>) =>
    test(name, async () => {
      const f = fakeFetch(createRoutes())
      const r = await build(ctx(f.fn, over(ctx(f.fn))))
      assert.strictEqual(r.ok, false)
      assert.match(String((r as { error?: string }).error), expect)
      assert.strictEqual(f.calls.length, 0, 'no request may be made')
    })
  const ops: [string, (c: AdsContext) => Promise<{ ok: boolean }>][] = [
    ['create', (c) => createPausedAd(c, spec())],
    ['activate', (c) => activateAd(c, { campaignId: 'C', adSetId: 'S', adId: 'A' })],
    ['change budget', (c) => updateAdSchedule(c, 'S', { dailyBudgetCents: 500, endsAt: null })],
  ]
  for (const [op, run] of ops) {
    noCall(`${op}: live setting off`, run as never, /marketing settings/, () => ({ gate: { ...gate(), settings: { liveEnabled: false } } }))
    noCall(`${op}: channel not connected`, run as never, /not connected/, () => ({ gate: { ...gate(), channel: { status: 'NOT_CONNECTED', credentialsEnc: null } } }))
    noCall(`${op}: not approved by the owner`, run as never, /not approved/, () => ({ gate: { ...gate(), post: { approvedBy: null, approvedAt: null } } }))
    noCall(`${op}: no gate supplied (fail closed)`, run as never, /no go-live check/, () => ({ gate: undefined }))
    noCall(`${op}: no cap check supplied (fail closed)`, run as never, /no spend cap check/, () => ({ capCheck: undefined }))
    noCall(`${op}: cap exceeded`, run as never, /spend cap/, () => ({
      capCheck: () => assertWithinCap({ monthlySpendCapCents: 0 }, { dailyBudgetCents: 500, startsAt: new Date(), endsAt: null }, 0) as never,
    }))
    noCall(`${op}: non-USD account`, run as never, /currency/, () => ({ currency: 'ZAR' }))
  }
  // The "env not live" case needs the env switched off: do it explicitly.
  test('env GRACE_MARKETING_LIVE not "true" blocks every spending call', async () => {
    delete process.env.GRACE_MARKETING_LIVE
    for (const [, run] of ops) {
      const f = fakeFetch(createRoutes())
      assert.strictEqual((await run(ctx(f.fn))).ok, false)
      assert.strictEqual(f.calls.length, 0)
    }
  })
})

describe('activate, pause, schedule, insights, verify', () => {
  test('activate: campaign, ad set, then ad (ad last)', async () => {
    const f = fakeFetch({ 'POST /C': { success: true }, 'POST /S': { success: true }, 'POST /A': { success: true } })
    assert.deepStrictEqual(await activateAd(ctx(f.fn), { campaignId: 'C', adSetId: 'S', adId: 'A' }), { ok: true })
    assert.deepStrictEqual(f.calls.map((c) => [c.path, c.params.status]), [['/C', 'ACTIVE'], ['/S', 'ACTIVE'], ['/A', 'ACTIVE']])
  })
  test('activate stops at the first Meta error (the ad stays paused)', async () => {
    const f = fakeFetch({ 'POST /C': { success: true }, 'POST /S': { error: { message: 'Payment method missing', code: 100 } }, 'POST /A': { success: true } })
    const r = await activateAd(ctx(f.fn), { campaignId: 'C', adSetId: 'S', adId: 'A' })
    assert.ok(!r.ok && /Payment method missing/.test(r.error))
    assert.deepStrictEqual(f.calls.map((c) => c.path), ['/C', '/S'])
  })
  test('pause: ad first, needs only credentials (works with every switch off)', async () => {
    delete process.env.GRACE_MARKETING_LIVE
    const f = fakeFetch({ 'POST /C': {}, 'POST /S': {}, 'POST /A': {} })
    assert.deepStrictEqual(await pauseAd({ credentials: ctx(f.fn).credentials, fetch: f.fn }, { campaignId: 'C', adSetId: 'S', adId: 'A' }), { ok: true })
    assert.deepStrictEqual(f.calls.map((c) => [c.path, c.params.status]), [['/A', 'PAUSED'], ['/S', 'PAUSED'], ['/C', 'PAUSED']])
  })
  test('schedule change pushes budget and end_time to the ad set', async () => {
    const f = fakeFetch({ 'POST /S': { success: true } })
    await updateAdSchedule(ctx(f.fn), 'S', { dailyBudgetCents: 700, endsAt: new Date('2026-12-20T00:00:00Z') })
    assert.deepStrictEqual(f.calls[0].params, { daily_budget: '700', end_time: '2026-12-20T00:00:00.000Z' })
  })
  test('insights request and parsing (spend dollars to cents)', async () => {
    const f = fakeFetch({ 'GET /A1/insights': { data: [{ date_start: '2026-12-02', date_stop: '2026-12-02', impressions: '1200', reach: '900', clicks: '31', spend: '2.35' }] } })
    const r = await fetchAdInsights({ credentials: ctx(f.fn).credentials, fetch: f.fn }, 'A1')
    assert.deepStrictEqual(f.calls[0].params, { fields: 'impressions,reach,clicks,spend', time_increment: '1', date_preset: 'last_7d' })
    assert.ok(r.ok)
    if (r.ok) assert.deepStrictEqual({ ...r.days[0], raw: undefined }, { day: '2026-12-02', impressions: 1200, reach: 900, clicks: 31, spendCents: 235, raw: undefined })
  })
  test('verify reads the account and rejects an inactive one', async () => {
    const ok = fakeFetch({ 'GET /act_555123456': { id: 'act_555123456', name: 'VYRA', currency: 'USD', account_status: 1 } })
    const r = await verifyAdAccount({ accessToken: 'T', adAccountId: 'act_555123456' }, ok.fn)
    assert.deepStrictEqual(r, { ok: true, id: '555123456', name: 'VYRA', currency: 'USD' })
    assert.deepStrictEqual(ok.calls[0].params, { fields: 'id,name,currency,account_status' })
    const bad = fakeFetch({ 'GET /act_555123456': { id: 'act_555123456', account_status: 3 } })
    const r2 = await verifyAdAccount({ accessToken: 'T', adAccountId: '555123456' }, bad.fn)
    assert.ok(!r2.ok && /not active/.test(r2.error))
  })
})

describe('Meta Pixel (Conversions API) and the storefront pixel config', () => {
  const settings = { liveEnabled: true, metaPixelId: '123456789012345' }
  const channel = { status: 'CONNECTED', credentialsEnc: 'v1:x' }
  const event = { name: 'ViewContent' as const, sourceUrl: 'https://shop.example/p/pink', user: { ip: '1.2.3.4', userAgent: 'UA', email: ' A@B.com ' }, contentIds: ['V-0001'] }

  test('request shape: POST /{pixel}/events with a data array', async () => {
    const f = fakeFetch({ 'POST /123456789012345/events': { events_received: 1 } })
    const r = await sendEvent({ fetch: f.fn, gate: { settings, channel }, accessToken: 'T' }, event, new Date('2026-12-01T10:00:00Z'))
    assert.deepStrictEqual(r, { ok: true, eventsReceived: 1 })
    const data = JSON.parse(f.calls[0].params.data)
    assert.strictEqual(data.length, 1)
    assert.strictEqual(data[0].event_name, 'ViewContent')
    assert.strictEqual(data[0].event_time, Math.floor(new Date('2026-12-01T10:00:00Z').getTime() / 1000))
    assert.strictEqual(data[0].action_source, 'website')
    assert.strictEqual(data[0].event_source_url, 'https://shop.example/p/pink')
    assert.deepStrictEqual(data[0].custom_data, { content_ids: ['V-0001'], content_type: 'product' })
    assert.strictEqual(data[0].user_data.client_ip_address, '1.2.3.4')
    assert.strictEqual(data[0].user_data.client_user_agent, 'UA')
    assert.match(data[0].user_data.em[0], /^[0-9a-f]{64}$/)
    assert.ok(!f.calls[0].params.data.includes('a@b.com'))
  })
  test('hashed fields only when present', () => {
    assert.deepStrictEqual(buildUserData({ ip: '1.1.1.1' }), { client_ip_address: '1.1.1.1' })
    assert.strictEqual(buildUserData({ phone: '+263 77 123' }).ph !== undefined, true)
  })
  test('each condition blocks the pixel and nothing is sent', async () => {
    const cases: [string, Parameters<typeof checkPixelGate>[0], () => void][] = [
      ['no live setting', { settings: { liveEnabled: false, metaPixelId: '12345' }, channel }, () => {}],
      ['no pixel id', { settings: { liveEnabled: true, metaPixelId: null }, channel }, () => {}],
      ['no channel', { settings, channel: null }, () => {}],
      ['channel not connected', { settings, channel: { status: 'ERROR', credentialsEnc: 'v1:x' } }, () => {}],
      ['no credentials', { settings, channel: { status: 'CONNECTED', credentialsEnc: null } }, () => {}],
      ['env off', { settings, channel }, () => { delete process.env.GRACE_MARKETING_LIVE }],
    ]
    for (const [name, gateIn, prep] of cases) {
      process.env.GRACE_MARKETING_LIVE = 'true'
      prep()
      const f = fakeFetch({})
      await assert.rejects(() => sendEvent({ fetch: f.fn, gate: gateIn, accessToken: 'T' }, event), (e: { status?: number }) => e.status === 409, name)
      assert.strictEqual(f.calls.length, 0, name)
      assert.strictEqual(pixelConfigForStorefront(gateIn), null, name)
    }
  })
  test('pixelConfigForStorefront returns the id only when everything passes', () => {
    assert.deepStrictEqual(pixelConfigForStorefront({ settings, channel }), { pixelId: '123456789012345' })
  })
})
