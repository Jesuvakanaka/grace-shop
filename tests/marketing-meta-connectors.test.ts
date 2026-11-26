// ZP-1200: Facebook Page and Instagram connectors against a fake fetch. No real network, no database.
import { describe, test, beforeEach, after } from 'node:test'
import assert from 'node:assert'
import { facebookPageConnector } from '../src/lib/marketing/connectors/facebook-page'
import { createInstagramConnector } from '../src/lib/marketing/connectors/instagram'
import { getConnector } from '../src/lib/marketing/connectors'
import { META_GRAPH_VERSION, graphBase, plainGraphMessage } from '../src/lib/marketing/connectors/meta-graph'
import type { ConnectorContext, ConnectorPost } from '../src/lib/marketing/connectors/types'
import { WebsiteError } from '../src/lib/website/http'

const BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`
const savedEnv = process.env.GRACE_MARKETING_LIVE

interface Call { url: string; method: string; headers: Record<string, string>; params: Record<string, string> }
type Reply = unknown | ((c: Call) => unknown)

function fakeFetch(routes: Record<string, Reply[] | Reply>, status = 200) {
  const calls: Call[] = []
  const counters: Record<string, number> = {}
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const method = init?.method ?? 'GET'
    const params: Record<string, string> = Object.fromEntries(u.searchParams)
    if (typeof init?.body === 'string') Object.assign(params, Object.fromEntries(new URLSearchParams(init.body)))
    const call: Call = { url: `${u.origin}${u.pathname}`, method, headers: { ...(init?.headers as Record<string, string>) }, params }
    calls.push(call)
    const key = `${method} ${u.pathname.replace(`/${META_GRAPH_VERSION}`, '')}`
    const entry = routes[key]
    if (entry === undefined) return new Response(JSON.stringify({ error: { message: `no route ${key}`, code: 100 } }), { status: 400 })
    let reply: Reply
    if (Array.isArray(entry)) {
      const n = counters[key] ?? 0
      counters[key] = n + 1
      reply = entry[Math.min(n, entry.length - 1)]
    } else reply = entry
    const body = typeof reply === 'function' ? (reply as (c: Call) => unknown)(call) : reply
    const isErr = typeof body === 'object' && body !== null && 'error' in body
    return new Response(JSON.stringify(body), { status: isErr ? status || 400 : 200 })
  }
  return { fn, calls }
}

const goodGate = () => ({
  settings: { liveEnabled: true },
  channel: { status: 'CONNECTED', credentialsEnc: 'v1:x' },
  post: { approvedBy: 'owner', approvedAt: new Date() },
})

const post = (o: Partial<ConnectorPost> = {}): ConnectorPost => ({
  id: 1, text: 'New in: pink dress', imageUrls: [], link: 'https://shop.example/p/pink?src=mkabc', format: 'POST', trackingTag: 'mkabc', ...o,
})

const ctx = (fetchFn: ConnectorContext['fetch'], o: Partial<ConnectorContext> = {}): ConnectorContext => ({
  credentials: { accessToken: 'TOKEN-SECRET-1234' }, externalId: '111', config: null, fetch: fetchFn, gate: goodGate(), ...o,
})

beforeEach(() => { process.env.GRACE_MARKETING_LIVE = 'true' })
after(() => {
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
})

describe('graph version and registry', () => {
  test('one version constant, overridable by env', () => {
    assert.strictEqual(META_GRAPH_VERSION, 'v25.0')
    assert.strictEqual(graphBase({}), 'https://graph.facebook.com/v25.0')
    assert.strictEqual(graphBase({ META_GRAPH_VERSION: 'v26.0' }), 'https://graph.facebook.com/v26.0')
    assert.strictEqual(graphBase({ META_GRAPH_VERSION: '../evil' }), 'https://graph.facebook.com/v25.0')
  })
  test('registry maps both kinds', () => {
    assert.strictEqual(getConnector('FACEBOOK_PAGE')?.kind, 'FACEBOOK_PAGE')
    assert.strictEqual(getConnector('INSTAGRAM')?.kind, 'INSTAGRAM')
    assert.strictEqual(getConnector('TIKTOK'), undefined)
  })
})

describe('Facebook Page publish', () => {
  test('one photo: /photos with url, caption (link appended), published=true; token in the header only', async () => {
    const f = fakeFetch({ 'POST /111/photos': { id: '900', post_id: '111_900' } })
    const r = await facebookPageConnector.publish(post({ imageUrls: ['https://shop.example/api/images/public/a.webp'] }), ctx(f.fn))
    assert.deepStrictEqual(r, { ok: true, externalId: '111_900', externalUrl: 'https://www.facebook.com/111_900' })
    assert.strictEqual(f.calls.length, 1)
    const c = f.calls[0]
    assert.strictEqual(c.url, `${BASE}/111/photos`)
    assert.strictEqual(c.method, 'POST')
    assert.strictEqual(c.headers.Authorization, 'Bearer TOKEN-SECRET-1234')
    assert.strictEqual(c.headers['Content-Type'], 'application/x-www-form-urlencoded')
    assert.deepStrictEqual(c.params, {
      url: 'https://shop.example/api/images/public/a.webp',
      caption: 'New in: pink dress\n\nhttps://shop.example/p/pink?src=mkabc',
      published: 'true',
    })
    assert.ok(!c.url.includes('TOKEN-SECRET'))
  })

  test('several photos: unpublished uploads, then /feed with attached_media', async () => {
    const f = fakeFetch({ 'POST /111/photos': [{ id: 'p1' }, { id: 'p2' }], 'POST /111/feed': { id: '111_777' } })
    const r = await facebookPageConnector.publish(post({ imageUrls: ['https://x/1.webp', 'https://x/2.webp'] }), ctx(f.fn))
    assert.strictEqual(r.ok && r.externalId, '111_777')
    assert.deepStrictEqual(f.calls.map((c) => [c.method, c.url]), [
      ['POST', `${BASE}/111/photos`], ['POST', `${BASE}/111/photos`], ['POST', `${BASE}/111/feed`],
    ])
    assert.deepStrictEqual(f.calls[0].params, { url: 'https://x/1.webp', published: 'false' })
    assert.deepStrictEqual(f.calls[1].params, { url: 'https://x/2.webp', published: 'false' })
    assert.deepStrictEqual(f.calls[2].params, {
      message: 'New in: pink dress\n\nhttps://shop.example/p/pink?src=mkabc',
      'attached_media[0]': '{"media_fbid":"p1"}',
      'attached_media[1]': '{"media_fbid":"p2"}',
    })
  })

  test('no photo: /feed with message and link', async () => {
    const f = fakeFetch({ 'POST /111/feed': { id: '111_5' } })
    const r = await facebookPageConnector.publish(post(), ctx(f.fn))
    assert.strictEqual(r.ok && r.externalUrl, 'https://www.facebook.com/111_5')
    assert.deepStrictEqual(f.calls[0].params, { message: 'New in: pink dress', link: 'https://shop.example/p/pink?src=mkabc' })
  })

  test('stories and missing credentials are refused without a request', async () => {
    const f = fakeFetch({})
    const s = await facebookPageConnector.publish(post({ format: 'STORY' }), ctx(f.fn))
    assert.strictEqual(s.ok, false)
    const n = await facebookPageConnector.publish(post(), ctx(f.fn, { externalId: null }))
    assert.strictEqual(n.ok, false)
    assert.strictEqual(f.calls.length, 0)
  })

  test('Meta errors map to plain text, keep the code, and never contain the token', async () => {
    const f = fakeFetch({ 'POST /111/feed': { error: { message: 'Error validating access token', type: 'OAuthException', code: 190, error_subcode: 463, fbtrace_id: 'AbC' } } }, 401)
    const r = await facebookPageConnector.publish(post(), ctx(f.fn))
    assert.ok(!r.ok)
    assert.strictEqual(r.code, 190)
    assert.strictEqual(r.retryable, false)
    assert.match(r.error, /connect the channel again/)
    assert.ok(!r.error.includes('TOKEN-SECRET'))
    const limit = fakeFetch({ 'POST /111/feed': { error: { message: 'slow down', code: 4 } } }, 400)
    const l = await facebookPageConnector.publish(post(), ctx(limit.fn))
    assert.ok(!l.ok && l.retryable && l.code === 4)
    assert.match(plainGraphMessage(200, null, 'x'), /permission/)
  })

  test('network failure is a retry-able plain message', async () => {
    const r = await facebookPageConnector.publish(post(), ctx(async () => { throw new Error('connect ECONNREFUSED https://graph.facebook.com/?access_token=TOKEN-SECRET-1234') }))
    assert.ok(!r.ok)
    assert.ok(!r.error.includes('TOKEN-SECRET'))
    assert.match(r.error, /Could not reach Meta/)
  })

  test('verify and insights', async () => {
    const f = fakeFetch({
      'GET /me': { id: '111', name: 'VYRA' },
      'GET /111_9/insights': { data: [{ name: 'post_impressions_unique', values: [{ value: 120 }] }, { name: 'post_clicks', values: [{ value: 7 }] }] },
    })
    assert.deepStrictEqual(await facebookPageConnector.verify({ accessToken: 'T' }, f.fn), { ok: true, externalId: '111', name: 'VYRA' })
    assert.deepStrictEqual(f.calls[0].params, { fields: 'id,name' })
    const i = await facebookPageConnector.fetchInsights!('111_9', ctx(f.fn))
    assert.deepStrictEqual(i, { ok: true, metrics: { reach: 120, clicks: 7 } })
    assert.deepStrictEqual(f.calls[1].params, { metric: 'post_impressions_unique,post_clicks' })
    const missing = fakeFetch({ 'GET /111_9/insights': { data: [] } })
    assert.deepStrictEqual(await facebookPageConnector.fetchInsights!('111_9', ctx(missing.fn)), { ok: true, metrics: { reach: undefined, clicks: undefined } })
    const bad = fakeFetch({ 'GET /111_9/insights': { error: { message: 'nope', code: 100 } } })
    assert.strictEqual((await facebookPageConnector.fetchInsights!('111_9', ctx(bad.fn))).ok, false)
    const badMe = fakeFetch({ 'GET /me': { error: { message: 'x', code: 190 } } }, 401)
    assert.strictEqual((await facebookPageConnector.verify({ accessToken: 'T' }, badMe.fn)).ok, false)
  })
})

const noSleep = { sleep: async () => {}, pollIntervalMs: 1000, maxWaitMs: 5000 }
const QUOTA = { data: [{ quota_usage: 3, config: { quota_total: 50, quota_duration: 86400 } }] }

describe('Instagram publish', () => {
  test('single photo: quota, container, poll, media_publish, permalink', async () => {
    const sleeps: number[] = []
    const ig = createInstagramConnector({ ...noSleep, sleep: async (ms) => { sleeps.push(ms) } })
    const f = fakeFetch({
      'GET /111/content_publishing_limit': QUOTA,
      'POST /111/media': { id: 'c1' },
      'GET /c1': [{ status_code: 'IN_PROGRESS' }, { status_code: 'FINISHED' }],
      'POST /111/media_publish': { id: 'm9' },
      'GET /m9': { permalink: 'https://www.instagram.com/p/abc/' },
    })
    const r = await ig.publish(post({ imageUrls: ['https://x/a.webp?format=jpeg'] }), ctx(f.fn))
    assert.deepStrictEqual(r, { ok: true, externalId: 'm9', externalUrl: 'https://www.instagram.com/p/abc/' })
    assert.deepStrictEqual(f.calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`), [
      'GET /111/content_publishing_limit', 'POST /111/media', 'GET /c1', 'GET /c1', 'POST /111/media_publish', 'GET /m9',
    ])
    assert.deepStrictEqual(f.calls[0].params, { fields: 'quota_usage,config' })
    assert.deepStrictEqual(f.calls[1].params, { image_url: 'https://x/a.webp?format=jpeg', caption: 'New in: pink dress' })
    assert.deepStrictEqual(f.calls[2].params, { fields: 'status_code' })
    assert.deepStrictEqual(f.calls[4].params, { creation_id: 'c1' })
    assert.deepStrictEqual(f.calls[5].params, { fields: 'permalink' })
    assert.deepStrictEqual(sleeps, [1000])
  })

  test('carousel: children flagged, parent with children and caption', async () => {
    const ig = createInstagramConnector(noSleep)
    const f = fakeFetch({
      'GET /111/content_publishing_limit': QUOTA,
      'POST /111/media': [{ id: 'k1' }, { id: 'k2' }, { id: 'parent' }],
      'GET /k1': { status_code: 'FINISHED' }, 'GET /k2': { status_code: 'FINISHED' }, 'GET /parent': { status_code: 'FINISHED' },
      'POST /111/media_publish': { id: 'm1' },
      'GET /m1': { error: { message: 'x', code: 100 } },
    })
    const r = await ig.publish(post({ format: 'CAROUSEL', imageUrls: ['https://x/1', 'https://x/2'] }), ctx(f.fn))
    assert.deepStrictEqual(r, { ok: true, externalId: 'm1', externalUrl: null }) // a failed permalink never fails the post
    const media = f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/111/media'))
    assert.deepStrictEqual(media[0].params, { image_url: 'https://x/1', is_carousel_item: 'true' })
    assert.deepStrictEqual(media[1].params, { image_url: 'https://x/2', is_carousel_item: 'true' })
    assert.deepStrictEqual(media[2].params, { media_type: 'CAROUSEL', children: 'k1,k2', caption: 'New in: pink dress' })
    const pub = f.calls.find((c) => c.url.endsWith('/media_publish'))!
    assert.deepStrictEqual(pub.params, { creation_id: 'parent' })
  })

  test('story: STORIES media type, first photo, no caption', async () => {
    const ig = createInstagramConnector(noSleep)
    const f = fakeFetch({
      'GET /111/content_publishing_limit': QUOTA, 'POST /111/media': { id: 's1' }, 'GET /s1': { status_code: 'FINISHED' },
      'POST /111/media_publish': { id: 'm2' }, 'GET /m2': { permalink: 'https://www.instagram.com/stories/x/' },
    })
    const r = await ig.publish(post({ format: 'STORY', imageUrls: ['https://x/1', 'https://x/2'] }), ctx(f.fn))
    assert.ok(r.ok)
    assert.deepStrictEqual(f.calls[1].params, { media_type: 'STORIES', image_url: 'https://x/1' })
  })

  test('polling gives up (never past 5 minutes) and stops on ERROR / EXPIRED', async () => {
    let slept = 0
    const slow = createInstagramConnector({ sleep: async (ms) => { slept += ms }, pollIntervalMs: 10_000, maxWaitMs: 99 * 60 * 1000 })
    const f = fakeFetch({ 'GET /111/content_publishing_limit': QUOTA, 'POST /111/media': { id: 'c' }, 'GET /c': { status_code: 'IN_PROGRESS' } })
    const r = await slow.publish(post({ imageUrls: ['https://x/1'] }), ctx(f.fn))
    assert.ok(!r.ok && r.retryable)
    assert.ok(slept <= 5 * 60 * 1000, `slept ${slept}`)
    assert.ok(!f.calls.some((c) => c.url.endsWith('media_publish')))
    for (const status_code of ['ERROR', 'EXPIRED']) {
      const g = fakeFetch({ 'GET /111/content_publishing_limit': QUOTA, 'POST /111/media': { id: 'c' }, 'GET /c': { status_code } })
      const e = await createInstagramConnector(noSleep).publish(post({ imageUrls: ['https://x/1'] }), ctx(g.fn))
      assert.ok(!e.ok && !e.retryable)
      assert.ok(!g.calls.some((c) => c.url.endsWith('media_publish')))
    }
  })

  test('quota used up: nothing is created', async () => {
    const f = fakeFetch({ 'GET /111/content_publishing_limit': { data: [{ quota_usage: 50, config: { quota_total: 50 } }] } })
    const r = await createInstagramConnector(noSleep).publish(post({ imageUrls: ['https://x/1'] }), ctx(f.fn))
    assert.ok(!r.ok)
    assert.match(r.error, /50 posts in 24 hours/)
    assert.strictEqual(f.calls.length, 1)
  })

  test('format rules refuse without any request', async () => {
    const f = fakeFetch({})
    const ig = createInstagramConnector(noSleep)
    for (const p of [post({ imageUrls: [] }), post({ format: 'REEL', imageUrls: ['https://x/1'] }), post({ format: 'CAROUSEL', imageUrls: ['https://x/1'] }), post({ imageUrls: Array(11).fill('https://x/1') })]) {
      assert.strictEqual((await ig.publish(p, ctx(f.fn))).ok, false)
    }
    assert.strictEqual(f.calls.length, 0)
  })

  test('Meta error on container creation maps to plain text with the code', async () => {
    const f = fakeFetch({ 'GET /111/content_publishing_limit': QUOTA, 'POST /111/media': { error: { message: 'Only photos or videos can be accepted', type: 'OAuthException', code: 100, error_subcode: 2207052, fbtrace_id: 'Z' } } })
    const r = await createInstagramConnector(noSleep).publish(post({ imageUrls: ['https://x/1'] }), ctx(f.fn))
    assert.ok(!r.ok)
    assert.strictEqual(r.code, 100)
    assert.match(r.error, /did not accept the request/)
  })

  test('insights and verify', async () => {
    const f = fakeFetch({
      'GET /m9/insights': { data: [{ name: 'reach', values: [{ value: 40 }] }, { name: 'likes', values: [{ value: 5 }] }] },
      'GET /111': { id: '111', username: 'vyra' },
    })
    const ig = createInstagramConnector(noSleep)
    const i = await ig.fetchInsights!('m9', ctx(f.fn))
    assert.deepStrictEqual(f.calls[0].params, { metric: 'reach,likes,comments,shares,saved' })
    assert.deepStrictEqual([i.ok, i.metrics.reach, i.metrics.likes, i.metrics.comments], [true, 40, 5, undefined])
    assert.deepStrictEqual(await ig.verify({ accessToken: 'T', igUserId: '111' }, f.fn), { ok: true, externalId: '111', name: 'vyra' })
  })
})

describe('the go-live gate blocks every connector path before any fetch', () => {
  const blocks: [string, () => void, Partial<ConnectorContext> | null][] = [
    ['env off', () => { delete process.env.GRACE_MARKETING_LIVE }, null],
    ['env not "true"', () => { process.env.GRACE_MARKETING_LIVE = '1' }, null],
    ['settings off', () => {}, { gate: { ...goodGate(), settings: { liveEnabled: false } } }],
    ['channel not connected', () => {}, { gate: { ...goodGate(), channel: { status: 'NOT_CONNECTED', credentialsEnc: null } } }],
    ['channel without credentials', () => {}, { gate: { ...goodGate(), channel: { status: 'CONNECTED', credentialsEnc: null } } }],
    ['not approved', () => {}, { gate: { ...goodGate(), post: { approvedBy: null, approvedAt: null } } }],
    ['gate missing (fails closed)', () => {}, { gate: undefined }],
  ]
  for (const [name, setup, override] of blocks) {
    for (const [label, connector, p] of [
      ['facebook photo', facebookPageConnector, post({ imageUrls: ['https://x/1'] })],
      ['facebook text', facebookPageConnector, post()],
      ['instagram photo', createInstagramConnector(noSleep), post({ imageUrls: ['https://x/1'] })],
      ['instagram carousel', createInstagramConnector(noSleep), post({ format: 'CAROUSEL', imageUrls: ['https://x/1', 'https://x/2'] })],
      ['instagram story', createInstagramConnector(noSleep), post({ format: 'STORY', imageUrls: ['https://x/1'] })],
    ] as const) {
      test(`${name}: ${label} throws 409 and makes no request`, async () => {
        setup()
        const f = fakeFetch({})
        await assert.rejects(
          () => connector.publish(p, ctx(f.fn, override ?? {})),
          (e: unknown) => e instanceof WebsiteError && e.status === 409,
        )
        assert.strictEqual(f.calls.length, 0)
      })
    }
  }
})
