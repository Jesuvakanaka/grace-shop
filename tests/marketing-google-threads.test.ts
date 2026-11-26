// ZP-1200: Google Business Profile, Google Merchant (Merchant API) and Threads connectors against a fake fetch.
// No real network, no database. Also the sync gate (assertCanSync) and the connect-field rules.
import { describe, test, beforeEach, after } from 'node:test'
import assert from 'node:assert'
import { getChannel, connectFieldsError } from '../src/lib/marketing/channels'
import { getConnector } from '../src/lib/marketing/connectors'
import { googleBusinessConnector, buildLocalPost } from '../src/lib/marketing/connectors/google-business'
import { googleMerchantConnector, priceFromFeed, productInputFromFeedItem, pushProducts, registerFeedSource } from '../src/lib/marketing/connectors/google-merchant'
import { exchangeRefreshToken } from '../src/lib/marketing/connectors/google-oauth'
import { createThreadsConnector, threadsBase, buildContainerParams } from '../src/lib/marketing/connectors/threads'
import type { ConnectorContext, ConnectorPost } from '../src/lib/marketing/connectors/types'
import type { FeedItem } from '../src/lib/marketing/feed'
import { assertCanSync, checkCanSync, type SyncInput } from '../src/lib/marketing/flags'
import { WebsiteError } from '../src/lib/website/http'

const savedEnv = process.env.GRACE_MARKETING_LIVE
beforeEach(() => { process.env.GRACE_MARKETING_LIVE = 'true' })
after(() => {
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
})

interface Call { method: string; url: string; path: string; headers: Record<string, string>; query: Record<string, string>; form: Record<string, string>; json: Record<string, unknown> | null }
type Reply = { status?: number; body: unknown } | ((c: Call) => { status?: number; body: unknown })
function fake(routes: Record<string, Reply | Reply[]>) {
  const calls: Call[] = []
  const counters: Record<string, number> = {}
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const raw = typeof init?.body === 'string' ? init.body : ''
    const ct = (init?.headers as Record<string, string> | undefined)?.['Content-Type'] ?? ''
    const call: Call = {
      method: init?.method ?? 'GET', url, path: u.pathname, headers: { ...(init?.headers as Record<string, string>) },
      query: Object.fromEntries(u.searchParams),
      form: ct.includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : {},
      json: ct.includes('json') && raw ? JSON.parse(raw) : null,
    }
    calls.push(call)
    const key = `${call.method} ${u.host}${u.pathname}`
    const entry = routes[key]
    if (!entry) return new Response(JSON.stringify({ error: { message: `no route ${key}`, code: 100 } }), { status: 404 })
    let r: Reply
    if (Array.isArray(entry)) { const n = counters[key] ?? 0; counters[key] = n + 1; r = entry[Math.min(n, entry.length - 1)] } else r = entry
    const out = typeof r === 'function' ? r(call) : r
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200 })
  }
  return { fn, calls }
}

const TOKEN_ROUTE = { 'POST oauth2.googleapis.com/token': { body: { access_token: 'ACCESS-1', expires_in: 3600 } } }
const gcreds = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'CSECRET-xyz', refreshToken: 'REFRESH-SECRET-1234', accountId: '111', locationId: '222', merchantId: '333' }
const goodGate = () => ({
  settings: { liveEnabled: true }, channel: { status: 'CONNECTED', credentialsEnc: 'v1:x' }, post: { approvedBy: 'owner', approvedAt: new Date() },
})
const post = (o: Partial<ConnectorPost> = {}): ConnectorPost => ({
  id: 1, text: 'New in: pink dress', imageUrls: [], link: 'https://shop.example/p/pink?src=mkabc', format: 'POST', trackingTag: 'mkabc', ...o,
})
const ctx = (fetchFn: ConnectorContext['fetch'], o: Partial<ConnectorContext> = {}): ConnectorContext => ({
  credentials: gcreds, externalId: 'accounts/111/locations/222', config: null, fetch: fetchFn, gate: goodGate(), ...o,
})
const noSleep = async () => {}

describe('registry and connect fields', () => {
  test('connectors exist and are flagged', () => {
    for (const k of ['THREADS', 'GOOGLE_BUSINESS', 'GOOGLE_MERCHANT']) {
      assert.ok(getConnector(k), k)
      assert.strictEqual(getChannel(k)!.connector, true, k)
      assert.ok(getChannel(k)!.connectFields.length > 0, k)
    }
    assert.deepStrictEqual(getChannel('FACEBOOK_PAGE')!.connectFields.map((f) => f.name), ['pageId', 'accessToken'])
    assert.deepStrictEqual(getChannel('WHATSAPP_CLOUD')!.connectFields, [])
    assert.match(getChannel('GOOGLE_BUSINESS')!.apiNotes.join(' '), /approval of the project/)
  })
  test('connectFieldsError', () => {
    const f = getChannel('GOOGLE_BUSINESS')!.connectFields
    const ok = { accountId: '12345', locationId: '67890', clientId: 'a', clientSecret: 'b', refreshToken: 'c' }
    assert.strictEqual(connectFieldsError(f, ok), null)
    assert.match(connectFieldsError(f, { ...ok, locationId: 'abc' })!, /digits only/)
    assert.match(connectFieldsError(f, { ...ok, refreshToken: '' })!, /Fill in: Refresh token/)
    assert.match(connectFieldsError(f, { ...ok, clientSecret: 'a b' })!, /spaces/)
  })
})

describe('Google OAuth exchange', () => {
  test('exact token request; secrets only in the body', async () => {
    const f = fake(TOKEN_ROUTE)
    assert.strictEqual(await exchangeRefreshToken(gcreds, f.fn), 'ACCESS-1')
    const c = f.calls[0]
    assert.strictEqual(c.url, 'https://oauth2.googleapis.com/token')
    assert.strictEqual(c.method, 'POST')
    assert.deepStrictEqual(c.form, { client_id: gcreds.clientId, client_secret: gcreds.clientSecret, refresh_token: gcreds.refreshToken, grant_type: 'refresh_token' })
  })
  test('invalid_grant is a plain message with no secret in it', async () => {
    const f = fake({ 'POST oauth2.googleapis.com/token': { status: 400, body: { error: 'invalid_grant' } } })
    await assert.rejects(() => exchangeRefreshToken(gcreds, f.fn), (e: Error) => /no longer accepts/.test(e.message) && !e.message.includes(gcreds.refreshToken))
  })
})

describe('Google Business Profile', () => {
  test('verify lists the location (read only) and finds it', async () => {
    const f = fake({
      ...TOKEN_ROUTE,
      'GET mybusinessbusinessinformation.googleapis.com/v1/accounts/111/locations': { body: { locations: [{ name: 'locations/222', title: 'VYRA Harare' }] } },
    })
    const r = await googleBusinessConnector.verify(gcreds, f.fn)
    assert.deepStrictEqual(r, { ok: true, externalId: 'accounts/111/locations/222', name: 'VYRA Harare' })
    const list = f.calls[1]
    assert.strictEqual(list.headers.Authorization, 'Bearer ACCESS-1')
    assert.strictEqual(list.query.readMask, 'name,title')
    assert.ok(f.calls.every((c) => c.method !== 'POST' || c.path === '/token'))
  })
  test('verify: unknown location, and a 403 explains the Google approval', async () => {
    const f1 = fake({ ...TOKEN_ROUTE, 'GET mybusinessbusinessinformation.googleapis.com/v1/accounts/111/locations': { body: { locations: [{ name: 'locations/999', title: 'Other' }] } } })
    const r1 = await googleBusinessConnector.verify(gcreds, f1.fn)
    assert.ok(!r1.ok && /did not list that location/.test(r1.error))
    const f2 = fake({ ...TOKEN_ROUTE, 'GET mybusinessbusinessinformation.googleapis.com/v1/accounts/111/locations': { status: 403, body: { error: { message: 'API not enabled' } } } })
    const r2 = await googleBusinessConnector.verify(gcreds, f2.fn)
    assert.ok(!r2.ok && /approve your Cloud project/.test(r2.error))
  })
  test('publish: exact localPosts request with photo and Learn more button', async () => {
    const f = fake({ ...TOKEN_ROUTE, 'POST mybusiness.googleapis.com/v4/accounts/111/locations/222/localPosts': { body: { name: 'accounts/111/locations/222/localPosts/9', searchUrl: 'https://g.co/p' } } })
    const r = await googleBusinessConnector.publish(post({ imageUrls: ['https://shop.example/api/images/public/a.webp?format=jpeg'] }), ctx(f.fn))
    assert.deepStrictEqual(r, { ok: true, externalId: 'accounts/111/locations/222/localPosts/9', externalUrl: 'https://g.co/p' })
    const c = f.calls[1]
    assert.strictEqual(c.url, 'https://mybusiness.googleapis.com/v4/accounts/111/locations/222/localPosts')
    assert.strictEqual(c.headers.Authorization, 'Bearer ACCESS-1')
    assert.deepStrictEqual(c.json, {
      languageCode: 'en', summary: 'New in: pink dress', topicType: 'STANDARD',
      callToAction: { actionType: 'LEARN_MORE', url: 'https://shop.example/p/pink?src=mkabc' },
      media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://shop.example/api/images/public/a.webp?format=jpeg' }],
    })
    assert.ok(!JSON.stringify(f.calls).includes('REFRESH-SECRET') || f.calls[0].path === '/token')
  })
  test('Call button has no url; no link means no button', () => {
    assert.deepStrictEqual(buildLocalPost(post(), 'CALL').callToAction, { actionType: 'CALL' })
    assert.strictEqual(buildLocalPost(post({ link: null })).callToAction, undefined)
    assert.strictEqual(buildLocalPost(post()).media, undefined)
  })
  test('config.callToAction is used when valid', async () => {
    const f = fake({ ...TOKEN_ROUTE, 'POST mybusiness.googleapis.com/v4/accounts/111/locations/222/localPosts': { body: { name: 'n' } } })
    await googleBusinessConnector.publish(post(), ctx(f.fn, { config: { callToAction: 'SHOP' } }))
    assert.strictEqual((f.calls[1].json?.callToAction as { actionType: string }).actionType, 'SHOP')
  })
  test('publish refuses bad input without calling Google', async () => {
    const f = fake({})
    const bad = [
      await googleBusinessConnector.publish(post({ format: 'STORY' }), ctx(f.fn)),
      await googleBusinessConnector.publish(post({ text: 'x'.repeat(1501) }), ctx(f.fn)),
      await googleBusinessConnector.publish(post({ imageUrls: ['a', 'b'] }), ctx(f.fn)),
      await googleBusinessConnector.publish(post(), ctx(f.fn, { externalId: '../evil' })),
    ]
    for (const r of bad) assert.ok(!r.ok)
    assert.strictEqual(f.calls.length, 0)
  })
  test('revoked credentials give code 190 (channel goes to ERROR)', async () => {
    const f = fake({ 'POST oauth2.googleapis.com/token': { status: 400, body: { error: 'invalid_grant' } } })
    const r = await googleBusinessConnector.publish(post(), ctx(f.fn))
    assert.ok(!r.ok && r.code === 190 && !r.retryable)
  })
  test('every go-live condition blocks and nothing is requested', async () => {
    const cases: [string, Partial<ConnectorContext>][] = [
      ['no gate', { gate: undefined }],
      ['live setting off', { gate: { ...goodGate(), settings: { liveEnabled: false } } }],
      ['channel not connected', { gate: { ...goodGate(), channel: { status: 'NOT_CONNECTED', credentialsEnc: 'v1:x' } } }],
      ['no credentials saved', { gate: { ...goodGate(), channel: { status: 'CONNECTED', credentialsEnc: null } } }],
      ['not approved', { gate: { ...goodGate(), post: { approvedBy: null, approvedAt: null } } }],
    ]
    for (const [name, o] of cases) {
      const f = fake({})
      await assert.rejects(() => googleBusinessConnector.publish(post(), ctx(f.fn, o)), (e: unknown) => e instanceof WebsiteError && e.status === 409, name)
      assert.strictEqual(f.calls.length, 0, name)
    }
    process.env.GRACE_MARKETING_LIVE = 'false'
    const f = fake({})
    await assert.rejects(() => googleBusinessConnector.publish(post(), ctx(f.fn)), /switched off on this server/)
    assert.strictEqual(f.calls.length, 0)
  })
})

describe('Threads', () => {
  const U = 'graph.threads.net/v1.0'
  const tctx = (fetchFn: ConnectorContext['fetch'], o: Partial<ConnectorContext> = {}) => ctx(fetchFn, { credentials: { accessToken: 'THREADS-TOKEN-5678' }, externalId: '555', ...o })
  const connector = createThreadsConnector({ sleep: noSleep, pollIntervalMs: 1, maxChecks: 3 })

  test('version constant and override', () => {
    assert.strictEqual(threadsBase({}), 'https://graph.threads.net/v1.0')
    assert.strictEqual(threadsBase({ THREADS_API_VERSION: 'v2.0' }), 'https://graph.threads.net/v2.0')
    assert.strictEqual(threadsBase({ THREADS_API_VERSION: '../x' }), 'https://graph.threads.net/v1.0')
  })
  test('verify reads /me', async () => {
    const f = fake({ [`GET ${U}/me`]: { body: { id: '555', username: 'vyra' } } })
    assert.deepStrictEqual(await connector.verify({ accessToken: 'T' }, f.fn), { ok: true, externalId: '555', name: '@vyra' })
    assert.strictEqual(f.calls[0].query.fields, 'id,username')
  })
  test('text post: TEXT container with link_attachment, status check, then threads_publish', async () => {
    const f = fake({
      [`POST ${U}/555/threads`]: { body: { id: 'C1' } },
      [`GET ${U}/C1`]: [{ body: { status: 'IN_PROGRESS' } }, { body: { status: 'FINISHED' } }],
      [`POST ${U}/555/threads_publish`]: { body: { id: 'P1' } },
      [`GET ${U}/P1`]: { body: { permalink: 'https://www.threads.com/@vyra/post/abc' } },
    })
    const r = await connector.publish(post(), tctx(f.fn))
    assert.deepStrictEqual(r, { ok: true, externalId: 'P1', externalUrl: 'https://www.threads.com/@vyra/post/abc' })
    assert.deepStrictEqual(f.calls.map((c) => `${c.method} ${c.path}`), [
      'POST /v1.0/555/threads', 'GET /v1.0/C1', 'GET /v1.0/C1', 'POST /v1.0/555/threads_publish', 'GET /v1.0/P1',
    ])
    assert.deepStrictEqual(f.calls[0].form, {
      media_type: 'TEXT', text: 'New in: pink dress', link_attachment: 'https://shop.example/p/pink?src=mkabc', access_token: 'THREADS-TOKEN-5678',
    })
    assert.strictEqual(f.calls[1].query.fields, 'status,error_message')
    assert.deepStrictEqual(f.calls[3].form, { creation_id: 'C1', access_token: 'THREADS-TOKEN-5678' })
  })
  test('image post: IMAGE container with image_url and the link in the words', async () => {
    const p = post({ imageUrls: ['https://shop.example/api/images/public/a.webp?format=jpeg'] })
    assert.deepStrictEqual(buildContainerParams(p), {
      media_type: 'IMAGE', image_url: 'https://shop.example/api/images/public/a.webp?format=jpeg', text: 'New in: pink dress\n\nhttps://shop.example/p/pink?src=mkabc',
    })
    const f = fake({
      [`POST ${U}/555/threads`]: { body: { id: 'C2' } }, [`GET ${U}/C2`]: { body: { status: 'FINISHED' } }, [`POST ${U}/555/threads_publish`]: { body: { id: 'P2' } },
    })
    const r = await connector.publish(p, tctx(f.fn))
    assert.ok(r.ok && r.externalId === 'P2' && r.externalUrl === null) // permalink lookup failing does not undo the post
    assert.strictEqual(f.calls[0].form.media_type, 'IMAGE')
  })
  test('errors never contain the token; processing errors stop before publishing', async () => {
    const f = fake({ [`POST ${U}/555/threads`]: { status: 400, body: { error: { code: 190, message: 'bad THREADS-TOKEN-5678' } } } })
    const r = await connector.publish(post(), tctx(f.fn))
    assert.ok(!r.ok && r.code === 190)
    const f2 = fake({ [`POST ${U}/555/threads`]: { body: { id: 'C3' } }, [`GET ${U}/C3`]: { body: { status: 'ERROR', error_message: 'bad image' } } })
    const r2 = await connector.publish(post(), tctx(f2.fn))
    assert.ok(!r2.ok && /could not process/.test(r2.error))
    assert.ok(!f2.calls.some((c) => c.path.endsWith('threads_publish')))
  })
  test('refuses bad posts without a request', async () => {
    const f = fake({})
    for (const p of [post({ format: 'STORY' }), post({ imageUrls: ['a', 'b'] }), post({ text: 'x'.repeat(501), link: null }), post({ text: '', link: null })]) {
      assert.ok(!(await connector.publish(p, tctx(f.fn))).ok)
    }
    assert.strictEqual(f.calls.length, 0)
  })
  test('the Facebook go-live checks all block', async () => {
    const cases: [string, Partial<ConnectorContext>][] = [
      ['no gate', { gate: undefined }],
      ['live setting off', { gate: { ...goodGate(), settings: { liveEnabled: false } } }],
      ['not connected', { gate: { ...goodGate(), channel: { status: 'ERROR', credentialsEnc: 'v1:x' } } }],
      ['no credentials', { gate: { ...goodGate(), channel: { status: 'CONNECTED', credentialsEnc: '' } } }],
      ['not approved', { gate: { ...goodGate(), post: { approvedBy: 'o', approvedAt: null } } }],
    ]
    for (const [name, o] of cases) {
      const f = fake({})
      await assert.rejects(() => connector.publish(post(), tctx(f.fn, o)), (e: unknown) => e instanceof WebsiteError && e.status === 409, name)
      assert.strictEqual(f.calls.length, 0, name)
    }
    process.env.GRACE_MARKETING_LIVE = 'false'
    const f = fake({})
    await assert.rejects(() => connector.publish(post(), tctx(f.fn)), /switched off on this server/)
    assert.strictEqual(f.calls.length, 0)
  })
})

const item = (o: Partial<FeedItem> = {}): FeedItem => ({
  id: 'VY-001', title: 'Pink dress', description: 'A pink dress', availability: 'in stock', condition: 'new', price: '12.50 USD',
  link: 'https://shop.example/p/pink?src=feed', image_link: 'https://shop.example/api/images/public/a.webp?format=jpeg&w=1200',
  additional_image_link: 'https://shop.example/b.jpg,https://shop.example/c.jpg', brand: 'VYRA', google_product_category: 'Apparel & Accessories > Clothing > Dresses',
  product_type: 'Dresses', identifier_exists: 'no', ...o,
})
const syncGate = (o: Partial<SyncInput> = {}): SyncInput => ({ settings: { liveEnabled: true }, channel: { status: 'CONNECTED', credentialsEnc: 'v1:x' }, actor: { role: 'OWNER' }, ...o })
const mctx = (fetchFn: ConnectorContext['fetch'], o: Record<string, unknown> = {}) => ({ credentials: gcreds, config: null, fetch: fetchFn, gate: syncGate(), ...o })

describe('assertCanSync: each condition blocks', () => {
  test('all conditions hold -> allowed', () => {
    assert.doesNotThrow(() => assertCanSync(syncGate()))
    assert.deepStrictEqual(checkCanSync(syncGate()), { ok: true })
  })
  test('env not live', () => {
    assert.throws(() => assertCanSync(syncGate({ env: { GRACE_MARKETING_LIVE: undefined } })), (e: unknown) => e instanceof WebsiteError && e.status === 409 && /server/.test(e.message))
    assert.throws(() => assertCanSync(syncGate({ env: { GRACE_MARKETING_LIVE: 'yes' } })), WebsiteError)
  })
  test('live setting off or missing', () => {
    assert.throws(() => assertCanSync(syncGate({ settings: { liveEnabled: false } })), /marketing settings/)
    assert.throws(() => assertCanSync(syncGate({ settings: null })), WebsiteError)
  })
  test('channel missing, not connected, or without credentials', () => {
    assert.throws(() => assertCanSync(syncGate({ channel: null })), /not connected/)
    assert.throws(() => assertCanSync(syncGate({ channel: { status: 'ERROR', credentialsEnc: 'v1:x' } })), /not connected/)
    assert.throws(() => assertCanSync(syncGate({ channel: { status: 'CONNECTED', credentialsEnc: null } })), /no saved credentials/)
  })
  test('not an owner action', () => {
    for (const actor of [null, undefined, { role: 'STAFF' }, { role: 'SYSTEM' }]) {
      assert.throws(() => assertCanSync(syncGate({ actor })), (e: unknown) => e instanceof WebsiteError && e.status === 409 && /Only the owner/.test(e.message))
    }
  })
})

describe('Google Merchant (Merchant API)', () => {
  test('price conversion and product input from a feed row', () => {
    assert.deepStrictEqual(priceFromFeed('12.50 USD'), { amountMicros: '12500000', currencyCode: 'USD' })
    assert.deepStrictEqual(priceFromFeed('39.00 USD'), { amountMicros: '39000000', currencyCode: 'USD' })
    assert.strictEqual(priceFromFeed(''), null)
    assert.strictEqual(priceFromFeed('0.00 USD'), null)
    assert.deepStrictEqual(productInputFromFeedItem(item(), { contentLanguage: 'en', feedLabel: 'VYRA' }), {
      offerId: 'VY-001', contentLanguage: 'en', feedLabel: 'VYRA',
      productAttributes: {
        title: 'Pink dress', description: 'A pink dress', link: 'https://shop.example/p/pink?src=feed',
        imageLink: 'https://shop.example/api/images/public/a.webp?format=jpeg&w=1200', availability: 'IN_STOCK', condition: 'NEW',
        price: { amountMicros: '12500000', currencyCode: 'USD' }, brand: 'VYRA', identifierExists: false,
        additionalImageLinks: ['https://shop.example/b.jpg', 'https://shop.example/c.jpg'],
        googleProductCategory: 'Apparel & Accessories > Clothing > Dresses', productTypes: ['Dresses'],
      },
    })
    assert.strictEqual(productInputFromFeedItem(item({ price: '' }), { contentLanguage: 'en', feedLabel: 'VYRA' }), null)
    const pre = productInputFromFeedItem(item({ availability: 'preorder' }), { contentLanguage: 'en', feedLabel: 'X' })!
    assert.strictEqual((pre.productAttributes as { availability: string }).availability, 'PREORDER')
    assert.strictEqual(pre.feedLabel, 'X')
  })
  test('publish never sends and says why', async () => {
    const r = await googleMerchantConnector.publish(post(), ctx(fake({}).fn))
    assert.ok(!r.ok && /product catalogue, not posts/.test(r.error) && !r.retryable)
  })
  test('verify reads the account', async () => {
    const f = fake({ ...TOKEN_ROUTE, 'GET merchantapi.googleapis.com/accounts/v1/accounts/333': { body: { accountName: 'VYRA' } } })
    assert.deepStrictEqual(await googleMerchantConnector.verify(gcreds, f.fn), { ok: true, externalId: '333', name: 'VYRA' })
    assert.strictEqual(f.calls[1].headers.Authorization, 'Bearer ACCESS-1')
  })
  test('register the feed URL: exact data source request', async () => {
    const f = fake({ ...TOKEN_ROUTE, 'POST merchantapi.googleapis.com/datasources/v1/accounts/333/dataSources': { body: { name: 'accounts/333/dataSources/77' } } })
    const r = await registerFeedSource(mctx(f.fn), 'https://shop.example/api/public/marketing/feed.xml')
    assert.deepStrictEqual(r, { name: 'accounts/333/dataSources/77' })
    assert.deepStrictEqual(f.calls[1].json, {
      displayName: 'VYRA product feed',
      primaryProductDataSource: { feedLabel: 'VYRA', contentLanguage: 'en' },
      fileInput: { fetchSettings: { enabled: true, frequency: 'FREQUENCY_DAILY', timeOfDay: { hours: 3 }, timeZone: 'Africa/Harare', fetchUri: 'https://shop.example/api/public/marketing/feed.xml' } },
    })
  })
  test('push products: creates an API data source, inserts each priced product, skips the rest', async () => {
    const f = fake({
      ...TOKEN_ROUTE,
      'POST merchantapi.googleapis.com/datasources/v1/accounts/333/dataSources': { body: { name: 'accounts/333/dataSources/88' } },
      'POST merchantapi.googleapis.com/products/v1/accounts/333/productInputs:insert': { body: { name: 'x' } },
    })
    const r = await pushProducts(mctx(f.fn), [item(), item({ id: 'VY-002', price: '' }), item({ id: 'VY-003' })])
    assert.deepStrictEqual({ sent: r.sent, skipped: r.skipped, failed: r.failed.length, dataSource: r.dataSource }, { sent: 2, skipped: 1, failed: 0, dataSource: 'accounts/333/dataSources/88' })
    assert.deepStrictEqual(f.calls[1].json, { displayName: 'VYRA products (API)', primaryProductDataSource: { feedLabel: 'VYRA', contentLanguage: 'en' } })
    const ins = f.calls.filter((c) => c.path.endsWith(':insert'))
    assert.strictEqual(ins.length, 2)
    assert.strictEqual(ins[0].query.dataSource, 'accounts/333/dataSources/88')
    assert.strictEqual(ins[0].json?.offerId, 'VY-001')
  })
  test('push reuses a saved data source and stops after repeated refusals', async () => {
    const f = fake({
      ...TOKEN_ROUTE,
      'POST merchantapi.googleapis.com/products/v1/accounts/333/productInputs:insert': { status: 400, body: { error: { message: 'bad' } } },
    })
    const items = Array.from({ length: 6 }, (_, i) => item({ id: `VY-${i}` }))
    const r = await pushProducts(mctx(f.fn, { config: { apiDataSource: 'accounts/333/dataSources/5' } }), items)
    assert.strictEqual(r.failed.length, 3)
    assert.strictEqual(r.sent, 0)
    assert.ok(!f.calls.some((c) => c.path.endsWith('/dataSources')))
  })
  test('every sync condition blocks before any request', async () => {
    const gates: [string, SyncInput | undefined][] = [
      ['no gate', undefined],
      ['live setting off', syncGate({ settings: { liveEnabled: false } })],
      ['not connected', syncGate({ channel: { status: 'NOT_CONNECTED', credentialsEnc: 'v1:x' } })],
      ['not owner', syncGate({ actor: { role: 'STAFF' } })],
      ['env off', syncGate({ env: {} })],
    ]
    for (const [name, gate] of gates) {
      const f = fake({})
      await assert.rejects(() => pushProducts(mctx(f.fn, { gate }), [item()]), WebsiteError, name)
      await assert.rejects(() => registerFeedSource(mctx(f.fn, { gate }), 'https://shop.example/feed.xml'), WebsiteError, name)
      assert.strictEqual(f.calls.length, 0, name)
    }
  })
})
