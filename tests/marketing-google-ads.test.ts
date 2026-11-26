// ZP-1200: Google Ads connector (exact request shapes, every gate blocks with zero requests, the cap blocks), the X token
// refresh and the browser Pixel's gate. Fake fetch only: no network, no database.
import { describe, test, beforeEach, after } from 'node:test'
import assert from 'node:assert'
import {
  activateGoogleAd, buildAdGroupAdCreate, buildCampaignCreate, centsToMicros, createPausedGoogleAd, fetchGoogleInsights, googleAdsConnector,
  GOOGLE_ADS_BASE, pauseGoogleAd, splitAdCopy, updateGoogleSchedule, verifyGoogleAdsAccount, type GoogleAdsContext,
} from '../src/lib/marketing/connectors/google-ads'
import { GOOGLE_TOKEN_URL } from '../src/lib/marketing/connectors/google-oauth'
import type { MetaAdSpec } from '../src/lib/marketing/connectors/meta-ads'
import { refreshXCredentials, X_TOKEN_URL } from '../src/lib/marketing/connectors/x'
import { assertWithinCap } from '../src/lib/marketing/budget'
import { getChannel, connectFieldsError } from '../src/lib/marketing/channels'
import { loadPixelConfigForStorefront, pixelBaseSnippet, pixelConfigForStorefront } from '../src/lib/marketing/pixel'
import { WebsiteError } from '../src/lib/website/http'

const savedEnv = process.env.GRACE_MARKETING_LIVE
beforeEach(() => { process.env.GRACE_MARKETING_LIVE = 'true' })
after(() => { if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE; else process.env.GRACE_MARKETING_LIVE = savedEnv })

interface Call { method: string; url: string; headers: Record<string, string>; body: string; json: unknown }
function fakeFetch(routes: Record<string, unknown | ((c: Call) => unknown)> = {}) {
  const calls: Call[] = []
  let n = 100
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? init.body : ''
    let json: unknown = null
    try { json = JSON.parse(body) } catch { json = null }
    const call: Call = { method: init?.method ?? 'GET', url, headers: { ...(init?.headers as Record<string, string>) }, body, json }
    calls.push(call)
    if (url === GOOGLE_TOKEN_URL) return new Response(JSON.stringify({ access_token: 'ACCESS-SECRET', expires_in: 3600 }), { status: 200 })
    const path = url.replace(GOOGLE_ADS_BASE, '')
    const entry = routes[`${call.method} ${path}`]
    if (entry !== undefined) {
      const out = typeof entry === 'function' ? (entry as (c: Call) => unknown)(call) : entry
      const isErr = typeof out === 'object' && out !== null && 'error' in out
      return new Response(JSON.stringify(out), { status: isErr ? 403 : 200 })
    }
    const m = /^\/customers\/(\d+)\/(\w+):mutate$/.exec(path)
    if (m) {
      const op = (json as { operations: { create?: unknown; update?: { resourceName: string } }[] }).operations[0]
      const name = op.update?.resourceName ?? `customers/${m[1]}/${m[2]}/${++n}`
      return new Response(JSON.stringify({ results: [{ resourceName: m[2] === 'adGroupAds' ? `customers/${m[1]}/adGroupAds/${n - 1}~${n}` : name }] }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: { message: `no route ${call.method} ${path}` } }), { status: 404 })
  }
  return { fn, calls }
}

const CREDS = { customerId: '1234567890', loginCustomerId: '9998887776', developerToken: 'DEVTOKEN-SECRET', clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken' }
const gate = () => ({ settings: { liveEnabled: true }, channel: { status: 'CONNECTED', credentialsEnc: 'v1:x' }, post: { approvedBy: 'o', approvedAt: new Date() } })
const ctx = (fetchFn: GoogleAdsContext['fetch'], o: Partial<GoogleAdsContext> = {}): GoogleAdsContext => ({ credentials: { ...CREDS }, fetch: fetchFn, gate: gate(), capCheck: () => {}, currency: 'USD', ...o })
const spec = (o: Partial<MetaAdSpec> = {}): MetaAdSpec => ({
  id: 1, trackingTag: 'mkabc123', objective: 'TRAFFIC', headline: 'Pink party dress, new in', primaryText: 'Our pink dress is here. Soft, light and made for summer evenings.', description: 'Shop the look',
  link: 'https://shop.example/p/pink?src=mkabc123', imageUrl: null, dailyBudgetCents: 500,
  startsAt: new Date('2026-12-10T00:00:00Z'), endsAt: new Date('2026-12-16T22:00:00Z'), targeting: null, ...o,
})
const NOW = new Date('2026-12-01T08:00:00Z')

describe('createPausedGoogleAd request shapes', () => {
  test('budget, campaign, ad group, ad in order, all PAUSED, with the developer-token and login-customer-id headers', async () => {
    const f = fakeFetch()
    const r = await createPausedGoogleAd(ctx(f.fn), spec(), NOW)
    assert.ok(r.ok)
    const gads = f.calls.filter((c) => c.url !== GOOGLE_TOKEN_URL)
    assert.deepStrictEqual(gads.map((c) => c.url.replace(GOOGLE_ADS_BASE, '')), [
      '/customers/1234567890/campaignBudgets:mutate', '/customers/1234567890/campaigns:mutate',
      '/customers/1234567890/adGroups:mutate', '/customers/1234567890/adGroupAds:mutate',
    ])
    assert.ok(GOOGLE_ADS_BASE.startsWith('https://googleads.googleapis.com/v'))
    // One token exchange only, form-encoded refresh_token grant.
    const tokens = f.calls.filter((c) => c.url === GOOGLE_TOKEN_URL)
    assert.strictEqual(tokens.length, 1)
    assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(tokens[0].body)), { client_id: 'cid', client_secret: 'csecret', refresh_token: 'rtoken', grant_type: 'refresh_token' })
    for (const c of gads) {
      assert.strictEqual(c.method, 'POST')
      assert.strictEqual(c.headers.Authorization, 'Bearer ACCESS-SECRET')
      assert.strictEqual(c.headers['developer-token'], 'DEVTOKEN-SECRET')
      assert.strictEqual(c.headers['login-customer-id'], '9998887776')
      assert.ok(!c.body.includes('SECRET'), 'no secret in a request body')
    }
    const [budget, camp, group, ad] = gads.map((c) => (c.json as { operations: { create: Record<string, unknown> }[] }).operations[0].create)
    assert.deepStrictEqual(budget, { name: 'VYRA mkabc123 budget', amountMicros: '5000000', deliveryMethod: 'STANDARD', explicitlyShared: false })
    assert.strictEqual(camp.status, 'PAUSED')
    assert.strictEqual(camp.advertisingChannelType, 'SEARCH')
    assert.match(String(camp.campaignBudget), /^customers\/1234567890\/campaignBudgets\/\d+$/)
    assert.deepStrictEqual(camp.networkSettings, { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false })
    assert.strictEqual(camp.startDateTime, '2026-12-10 00:00:00')
    assert.strictEqual(camp.endDateTime, '2026-12-16 23:59:59') // an end at midnight does not include that day
    assert.strictEqual(camp.containsEuPoliticalAdvertising, 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING')
    assert.strictEqual(group.status, 'PAUSED')
    assert.match(String(group.campaign), /campaigns\/\d+$/)
    assert.strictEqual(ad.status, 'PAUSED')
    const rsa = (ad.ad as { finalUrls: string[]; responsiveSearchAd: { headlines: { text: string }[]; descriptions: { text: string }[] } })
    assert.deepStrictEqual(rsa.finalUrls, ['https://shop.example/p/pink?src=mkabc123'])
    assert.ok(rsa.responsiveSearchAd.headlines.length >= 3 && rsa.responsiveSearchAd.descriptions.length >= 2)
    // No audience: no location request.
    assert.ok(!f.calls.some((c) => c.url.includes('campaignCriteria')))
  })

  test('with an audience the campaign gets a Harare radius', async () => {
    const f = fakeFetch()
    const r = await createPausedGoogleAd(ctx(f.fn, { credentials: { ...CREDS, loginCustomerId: '' } }), spec({ targeting: { geo: { lat: -17.8292, lng: 31.0522, radiusKm: 25 }, ageMin: 18, ageMax: 65, genders: [], interests: [] } }), NOW)
    assert.ok(r.ok)
    const crit = f.calls.find((c) => c.url.endsWith('/campaignCriteria:mutate'))!
    const create = (crit.json as { operations: { create: Record<string, unknown> }[] }).operations[0].create
    assert.match(String(create.campaign), /campaigns\/\d+$/)
    assert.deepStrictEqual(create.proximity, { geoPoint: { longitudeInMicroDegrees: 31052200, latitudeInMicroDegrees: -17829200 }, radius: 25, radiusUnits: 'KILOMETERS' })
    // No login-customer-id header when none is given.
    assert.ok(!('login-customer-id' in crit.headers))
  })

  test('resumes from the ids of an earlier attempt instead of duplicating', async () => {
    const f = fakeFetch()
    const r = await createPausedGoogleAd(ctx(f.fn), spec({ existing: { creativeId: '11', campaignId: '22' } }), NOW)
    assert.ok(r.ok)
    assert.deepStrictEqual(f.calls.filter((c) => c.url !== GOOGLE_TOKEN_URL).map((c) => c.url.split('/').pop()), ['adGroups:mutate', 'adGroupAds:mutate'])
    if (r.ok) { assert.strictEqual(r.ids.campaignId, '22'); assert.strictEqual(r.ids.creativeId, '11') }
  })

  test('a Google error is a plain failure that keeps the ids made so far', async () => {
    const f = fakeFetch({ 'POST /customers/1234567890/adGroups:mutate': { error: { message: 'Developer token is not approved' } } })
    const r = await createPausedGoogleAd(ctx(f.fn), spec(), NOW)
    assert.ok(!r.ok)
    if (!r.ok) {
      assert.match(r.error, /Basic access/)
      assert.ok(r.ids.campaignId && r.ids.creativeId && !r.ids.adSetId)
      assert.ok(!JSON.stringify(r).includes('SECRET'))
    }
  })
})

describe('every gate condition blocks with zero requests', () => {
  const cases: [string, Partial<GoogleAdsContext> | (() => void)][] = [
    ['no gate supplied', { gate: undefined }],
    ['env off', () => { process.env.GRACE_MARKETING_LIVE = 'false' }],
    ['live setting off', { gate: { ...gate(), settings: { liveEnabled: false } } }],
    ['channel missing', { gate: { ...gate(), channel: null } }],
    ['channel not connected', { gate: { ...gate(), channel: { status: 'NOT_CONNECTED', credentialsEnc: 'v1:x' } } }],
    ['no saved credentials', { gate: { ...gate(), channel: { status: 'CONNECTED', credentialsEnc: null } } }],
    ['not approved', { gate: { ...gate(), post: { approvedBy: null, approvedAt: null } } }],
    ['no cap check supplied', { capCheck: undefined }],
    ['the cap says no', { capCheck: () => { throw new WebsiteError(409, 'cap exceeded', { blocked: 'cap' }) } }],
    ['account currency is not USD', { currency: 'ZWG' }],
  ]
  for (const [name, change] of cases) {
    test(`create, schedule and start: ${name}`, async () => {
      const f = fakeFetch()
      const o = typeof change === 'function' ? (change(), {}) : change
      const c = ctx(f.fn, o)
      const created = await createPausedGoogleAd(c, spec(), NOW)
      const sched = await updateGoogleSchedule(c, { campaignId: '1', creativeId: '2' }, { dailyBudgetCents: 500, endsAt: null })
      const started = await activateGoogleAd(c, { campaignId: '1', adSetId: '2', adId: '3' })
      assert.ok(!created.ok && !sched.ok && !started.ok)
      assert.strictEqual(f.calls.length, 0, 'not even the token request')
    })
  }

  test('the cap check is the real one: over the cap throws before any request', async () => {
    const f = fakeFetch()
    const c = ctx(f.fn, { capCheck: () => assertWithinCap({ monthlySpendCapCents: 1000 }, { dailyBudgetCents: 500, startsAt: new Date('2026-12-01T00:00:00Z'), endsAt: null }, 0, NOW) })
    const r = await createPausedGoogleAd(c, spec(), NOW)
    assert.ok(!r.ok)
    if (!r.ok) assert.match(r.error, /monthly cap/)
    assert.strictEqual(f.calls.length, 0)
  })
})

describe('start, change, pause and results', () => {
  test('schedule pushes the budget amount and end date; activate enables campaign, ad group, then the ad', async () => {
    const f = fakeFetch()
    const c = ctx(f.fn)
    assert.deepStrictEqual(await updateGoogleSchedule(c, { campaignId: '22', creativeId: '11' }, { dailyBudgetCents: 750, endsAt: new Date('2026-12-19T22:00:00Z') }), { ok: true })
    assert.deepStrictEqual(await activateGoogleAd(c, { campaignId: '22', adSetId: '33', adId: '44' }), { ok: true })
    const ops = f.calls.filter((c2) => c2.url !== GOOGLE_TOKEN_URL).map((c2) => ({ path: c2.url.replace(`${GOOGLE_ADS_BASE}/customers/1234567890/`, ''), op: (c2.json as { operations: unknown[] }).operations[0] }))
    assert.deepStrictEqual(ops, [
      { path: 'campaignBudgets:mutate', op: { updateMask: 'amount_micros', update: { resourceName: 'customers/1234567890/campaignBudgets/11', amountMicros: '7500000' } } },
      { path: 'campaigns:mutate', op: { updateMask: 'end_date_time', update: { resourceName: 'customers/1234567890/campaigns/22', endDateTime: '2026-12-19 23:59:59' } } },
      { path: 'campaigns:mutate', op: { updateMask: 'status', update: { resourceName: 'customers/1234567890/campaigns/22', status: 'ENABLED' } } },
      { path: 'adGroups:mutate', op: { updateMask: 'status', update: { resourceName: 'customers/1234567890/adGroups/33', status: 'ENABLED' } } },
      { path: 'adGroupAds:mutate', op: { updateMask: 'status', update: { resourceName: 'customers/1234567890/adGroupAds/33~44', status: 'ENABLED' } } },
    ])
  })

  test('pause needs credentials only (no gate, no cap) and pauses the ad first', async () => {
    const f = fakeFetch()
    process.env.GRACE_MARKETING_LIVE = 'false'
    assert.deepStrictEqual(await pauseGoogleAd({ credentials: { ...CREDS }, fetch: f.fn }, { campaignId: '22', adSetId: '33', adId: '44' }), { ok: true })
    const order = f.calls.filter((c) => c.url !== GOOGLE_TOKEN_URL).map((c) => c.url.split('/').pop())
    assert.deepStrictEqual(order, ['adGroupAds:mutate', 'adGroups:mutate', 'campaigns:mutate'])
    const bad = await pauseGoogleAd({ credentials: {}, fetch: f.fn }, { campaignId: '22', adSetId: '33', adId: '44' })
    assert.ok(!bad.ok)
  })

  test('insights: a GAQL search on cost_micros, impressions and clicks; micros become cents', async () => {
    const f = fakeFetch({
      'POST /customers/1234567890/googleAds:search': { results: [
        { segments: { date: '2026-12-02' }, metrics: { costMicros: '1234500', impressions: '900', clicks: '12' } },
        { segments: { date: '2026-12-03' }, metrics: { impressions: '10' } },
      ] },
    })
    const r = await fetchGoogleInsights({ credentials: { ...CREDS }, fetch: f.fn }, '44')
    assert.ok(r.ok)
    if (r.ok) {
      assert.deepStrictEqual(r.days.map((d) => [d.day, d.spendCents, d.impressions, d.clicks, d.reach]), [['2026-12-02', 123, 900, 12, 0], ['2026-12-03', 0, 10, 0, 0]])
    }
    const search = f.calls.find((c) => c.url.endsWith('/googleAds:search'))!
    const q = (search.json as { query: string }).query
    assert.match(q, /^SELECT segments\.date, metrics\.cost_micros, metrics\.impressions, metrics\.clicks FROM ad_group_ad WHERE ad_group_ad\.ad\.id = 44 AND segments\.date DURING LAST_7_DAYS$/)
    const bad = await fetchGoogleInsights({ credentials: { ...CREDS }, fetch: f.fn }, '4 OR 1=1')
    assert.ok(!bad.ok)
  })

  test('verify reads the customer, keeps the currency, and refuses an inactive account', async () => {
    const ok = fakeFetch({ 'POST /customers/1234567890/googleAds:search': { results: [{ customer: { id: '1234567890', descriptiveName: 'VYRA', currencyCode: 'USD', status: 'ENABLED' } }] } })
    const v = await googleAdsConnector.verify({ ...CREDS }, ok.fn)
    assert.deepStrictEqual(v, { ok: true, externalId: '1234567890', name: 'VYRA', extraConfig: { currency: 'USD', accountName: 'VYRA' } })
    const off = fakeFetch({ 'POST /customers/1234567890/googleAds:search': { results: [{ customer: { id: '1', currencyCode: 'USD', status: 'SUSPENDED' } }] } })
    const v2 = await verifyGoogleAdsAccount({ ...CREDS }, off.fn)
    assert.ok(!v2.ok)
    const refused = fakeFetch({ 'POST /customers/1234567890/googleAds:search': { error: { message: 'The developer token is only approved for use with test accounts.' } } })
    const v3 = await verifyGoogleAdsAccount({ ...CREDS }, refused.fn)
    assert.ok(!v3.ok && /Basic access/.test(v3.error))
  })
})

describe('ad copy split into Google limits and the registry', () => {
  test('headlines are at most 30 characters, descriptions at most 90, counts within Google range, no "!" in headlines', () => {
    const long = splitAdCopy({
      headline: 'The brand new pink party dress has just arrived at VYRA!',
      primaryText: 'Soft, light and made for long summer evenings in Harare. Pair it with flat sandals or heels. Ask us about sizes on WhatsApp today and we will hold it for you.',
      description: 'Shop the new dress collection now',
    })
    assert.ok(long.headlines.length >= 3 && long.headlines.length <= 15)
    assert.ok(long.descriptions.length >= 2 && long.descriptions.length <= 4)
    for (const h of long.headlines) { assert.ok(h.length <= 30, h); assert.ok(!h.includes('!')) }
    for (const d of long.descriptions) assert.ok(d.length <= 90, d)
    assert.strictEqual(new Set(long.headlines.map((h) => h.toLowerCase())).size, long.headlines.length)
    const tiny = splitAdCopy({ headline: 'New in', primaryText: 'Pink dress.', description: null })
    assert.ok(tiny.headlines.length >= 3 && tiny.descriptions.length >= 2)
    for (const h of tiny.headlines) assert.ok(h.length <= 30)
    // The ad builder uses it and the link is the final URL.
    const g = buildAdGroupAdCreate(spec(), 'customers/1/adGroups/2')
    assert.deepStrictEqual(g.ad.finalUrls, [spec().link])
    assert.strictEqual(centsToMicros(100), '1000000')
  })
  test('a campaign never starts in the past', () => {
    const c = buildCampaignCreate(spec({ startsAt: new Date('2026-11-01T00:00:00Z') }), 'customers/1/campaignBudgets/2', NOW)
    assert.strictEqual(c.startDateTime, '2026-12-01 00:00:00')
  })
  test('GOOGLE_ADS is connectable with its fields; the login ID is optional; dashes in the customer ID are fine', () => {
    const def = getChannel('GOOGLE_ADS')!
    assert.strictEqual(def.connector, true)
    assert.deepStrictEqual(def.connectFields.map((f) => f.name), ['customerId', 'loginCustomerId', 'developerToken', 'clientId', 'clientSecret', 'refreshToken'])
    const v = { customerId: '123-456-7890', loginCustomerId: '', developerToken: 'd', clientId: 'c', clientSecret: 's', refreshToken: 'r' }
    assert.strictEqual(connectFieldsError(def.connectFields, v), null)
    assert.match(connectFieldsError(def.connectFields, { ...v, developerToken: '' }) ?? '', /Developer token/)
    assert.ok(def.apiNotes.some((n) => /Basic access/.test(n)) && def.apiNotes.some((n) => /bills the card/.test(n)))
  })
})

describe('X token refresh', () => {
  const XC = { accessToken: 'OLD-ACCESS', refreshToken: 'OLD-REFRESH', clientId: 'xcid' }
  const xFetch = (status: number, body: unknown) => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = []
    return { calls, fn: async (url: string, init?: RequestInit) => { calls.push({ url, headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body ?? '') }); return new Response(JSON.stringify(body), { status }) } }
  }
  test('public client: client_id in the body, no Authorization; both new tokens returned', async () => {
    const f = xFetch(200, { access_token: 'NEW-ACCESS', refresh_token: 'NEW-REFRESH', expires_in: 7200 })
    const r = await refreshXCredentials(XC, f.fn)
    assert.deepStrictEqual(r, { ok: true, refreshed: true, credentials: { accessToken: 'NEW-ACCESS', refreshToken: 'NEW-REFRESH', clientId: 'xcid' } })
    assert.strictEqual(X_TOKEN_URL, 'https://api.x.com/2/oauth2/token')
    assert.strictEqual(f.calls[0].url, X_TOKEN_URL)
    assert.strictEqual(f.calls[0].headers['Content-Type'], 'application/x-www-form-urlencoded')
    assert.ok(!('Authorization' in f.calls[0].headers))
    assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(f.calls[0].body)), { grant_type: 'refresh_token', refresh_token: 'OLD-REFRESH', client_id: 'xcid' })
  })
  test('confidential client: Basic authorisation, no client_id in the body', async () => {
    const f = xFetch(200, { access_token: 'NEW-ACCESS' })
    const r = await refreshXCredentials({ ...XC, clientSecret: 'xsecret' }, f.fn)
    assert.ok(r.ok && r.refreshed)
    if (r.ok) assert.strictEqual(r.credentials.refreshToken, 'OLD-REFRESH', 'kept when X sends none')
    assert.strictEqual(f.calls[0].headers.Authorization, `Basic ${Buffer.from('xcid:xsecret').toString('base64')}`)
    assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(f.calls[0].body)), { grant_type: 'refresh_token', refresh_token: 'OLD-REFRESH' })
  })
  test('nothing to refresh without a refresh token; a rejected one says connect again and never echoes tokens', async () => {
    const none = xFetch(200, {})
    assert.deepStrictEqual(await refreshXCredentials({ accessToken: 'A' }, none.fn), { ok: true, refreshed: false, credentials: { accessToken: 'A' } })
    assert.strictEqual(none.calls.length, 0)
    const bad = xFetch(400, { error: 'invalid_request', error_description: 'Value passed for the token was invalid.' })
    const r = await refreshXCredentials(XC, bad.fn)
    assert.ok(!r.ok)
    if (!r.ok) { assert.strictEqual(r.code, 401); assert.match(r.error, /connect the channel again/); assert.ok(!/OLD-/.test(r.error)) }
    const down = await refreshXCredentials(XC, async () => { throw new Error('boom') })
    assert.ok(!down.ok && down.retryable)
  })
})

describe('browser Pixel gate', () => {
  const settings = { liveEnabled: true, metaPixelId: '123456789012345' }
  const channel = { status: 'CONNECTED', credentialsEnc: 'v1:x' }
  test('the config exists only when every condition holds', () => {
    assert.deepStrictEqual(pixelConfigForStorefront({ settings, channel, env: { GRACE_MARKETING_LIVE: 'true' } }), { pixelId: '123456789012345' })
    assert.strictEqual(pixelConfigForStorefront({ settings, channel, env: {} }), null)
    assert.strictEqual(pixelConfigForStorefront({ settings: { ...settings, liveEnabled: false }, channel, env: { GRACE_MARKETING_LIVE: 'true' } }), null)
    assert.strictEqual(pixelConfigForStorefront({ settings: { ...settings, metaPixelId: null }, channel, env: { GRACE_MARKETING_LIVE: 'true' } }), null)
    assert.strictEqual(pixelConfigForStorefront({ settings, channel: { status: 'ERROR', credentialsEnc: 'v1:x' }, env: { GRACE_MARKETING_LIVE: 'true' } }), null)
    assert.strictEqual(pixelConfigForStorefront({ settings, channel: null, env: { GRACE_MARKETING_LIVE: 'true' } }), null)
    // An ID that is not digits never reaches the page's script.
    assert.strictEqual(pixelConfigForStorefront({ settings: { ...settings, metaPixelId: "1');alert(1);('" }, channel, env: { GRACE_MARKETING_LIVE: 'true' } }), null)
  })
  test('without the live env there is no database read at all (the default storefront is untouched)', async () => {
    const db = new Proxy({}, { get: () => { throw new Error('the database must not be read') } })
    assert.strictEqual(await loadPixelConfigForStorefront(db as never, {}), null)
    assert.strictEqual(await loadPixelConfigForStorefront(db as never, { GRACE_MARKETING_LIVE: 'true' }), null, 'a database error fails closed')
  })
  test('the base code carries the ID once, sends PageView and refuses a bad ID', () => {
    const s = pixelBaseSnippet('123456789012345')
    assert.match(s, /fbq\('init','123456789012345'\)/)
    assert.match(s, /fbq\('track','PageView'\)/)
    assert.throws(() => pixelBaseSnippet("1'); evil('"))
  })
})
