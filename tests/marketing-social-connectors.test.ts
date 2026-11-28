// ZP-1200: Pinterest, Telegram, X, YouTube and TikTok connectors against a fake fetch. No network, no database.
import { describe, test, beforeEach, after } from 'node:test'
import assert from 'node:assert'
import { pinterestConnector } from '../src/lib/marketing/connectors/pinterest'
import { telegramConnector } from '../src/lib/marketing/connectors/telegram'
import { xConnector } from '../src/lib/marketing/connectors/x'
import { youtubeConnector, privacyOf } from '../src/lib/marketing/connectors/youtube'
import { tiktokConnector, TIKTOK_INBOX_MESSAGE } from '../src/lib/marketing/connectors/tiktok'
import { getConnector } from '../src/lib/marketing/connectors'
import type { Connector, ConnectorContext, ConnectorPost } from '../src/lib/marketing/connectors/types'
import type { Obj } from '../src/lib/marketing/connectors/common'
import { WebsiteError } from '../src/lib/website/http'

const savedEnv = process.env.GRACE_MARKETING_LIVE

interface Call { url: string; method: string; headers: Record<string, string>; body: Obj; raw: unknown }
type Handler = (c: Call) => Response | Promise<Response>

/** Routes are matched on "METHOD url-without-query"; the longest prefix wins. Unmatched requests answer 404. */
function fakeFetch(routes: Record<string, Handler | Handler[]>) {
  const calls: Call[] = []
  const n: Record<string, number> = {}
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    let body: Obj = init?.body as Obj
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { /* form text */ } }
    const call: Call = { url, method, headers: { ...(init?.headers as Record<string, string>) }, body, raw: init?.body }
    calls.push(call)
    const key = Object.keys(routes).filter((k) => `${method} ${url}`.startsWith(k)).sort((a, b) => b.length - a.length)[0]
    if (!key) return json({ error: 'no route' }, 404)
    const h = routes[key]
    if (Array.isArray(h)) { const i = n[key] ?? 0; n[key] = i + 1; return h[Math.min(i, h.length - 1)](call) }
    return h(call)
  }
  return { fn, calls }
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers })
const bytes = (type: string, size = 10) => () => new Response(new Uint8Array(size), { status: 200, headers: { 'content-type': type } })

const goodGate = () => ({
  settings: { liveEnabled: true },
  channel: { status: 'CONNECTED', credentialsEnc: 'v1:x' },
  post: { approvedBy: 'owner', approvedAt: new Date() },
})
const post = (o: Partial<ConnectorPost> = {}): ConnectorPost => ({
  id: 1, text: 'Pink dress, new in\nSizes 2 to 8.', imageUrls: [], link: 'https://shop.example/p/pink?src=mkabc', format: 'POST', trackingTag: 'mkabc', ...o,
})
const ctx = (fetchFn: ConnectorContext['fetch'], o: Partial<ConnectorContext> = {}): ConnectorContext => ({
  credentials: { accessToken: 'TOKEN-SECRET-1234' }, externalId: '999', config: null, fetch: fetchFn, gate: goodGate(), ...o,
})
const ytCreds = { clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtok' }

beforeEach(() => { process.env.GRACE_MARKETING_LIVE = 'true' })
after(() => {
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
})

test('all five are registered', () => {
  for (const k of ['PINTEREST', 'TELEGRAM', 'X', 'YOUTUBE', 'TIKTOK']) assert.strictEqual(getConnector(k)?.kind, k)
})

describe('Pinterest', () => {
  test('creates a pin with the exact v5 request', async () => {
    const f = fakeFetch({ 'POST https://api.pinterest.com/v5/pins': () => json({ id: '123' }, 201) })
    const r = await pinterestConnector.publish(post({ format: 'PIN', imageUrls: ['https://img/1.jpg'] }), ctx(f.fn))
    assert.deepStrictEqual(r, { ok: true, externalId: '123', externalUrl: 'https://www.pinterest.com/pin/123/' })
    assert.strictEqual(f.calls.length, 1)
    assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer TOKEN-SECRET-1234')
    assert.deepStrictEqual(f.calls[0].body, {
      board_id: '999', title: 'Pink dress, new in', description: 'Sizes 2 to 8.', link: 'https://shop.example/p/pink?src=mkabc',
      media_source: { source_type: 'image_url', url: 'https://img/1.jpg' },
    })
  })
  test('needs an image and a board', async () => {
    const f = fakeFetch({})
    const a = await pinterestConnector.publish(post({ format: 'PIN' }), ctx(f.fn))
    assert.ok(!a.ok && /picture/.test(a.error))
    const b = await pinterestConnector.publish(post({ format: 'PIN', imageUrls: ['https://i/1'] }), ctx(f.fn, { externalId: null }))
    assert.ok(!b.ok && /board/.test(b.error))
    assert.strictEqual(f.calls.length, 0)
  })
  test('token expired is not retryable, rate limit is', async () => {
    const e = await pinterestConnector.publish(post({ format: 'PIN', imageUrls: ['https://i/1'] }), ctx(fakeFetch({ 'POST ': () => json({ code: 2, message: 'Authentication failed.' }, 401) }).fn))
    assert.ok(!e.ok && !e.retryable && e.code === 401 && /expired/.test(e.error))
    const l = await pinterestConnector.publish(post({ format: 'PIN', imageUrls: ['https://i/1'] }), ctx(fakeFetch({ 'POST ': () => json({ code: 8, message: 'slow down' }, 429) }).fn))
    assert.ok(!l.ok && l.retryable && l.code === 429)
    const s = await pinterestConnector.publish(post({ format: 'PIN', imageUrls: ['https://i/1'] }), ctx(fakeFetch({ 'POST ': () => json({}, 503) }).fn))
    // ZP-1124: a 5xx on the creating request may mean the pin exists: uncertain, never retried blind.
    assert.ok(!s.ok && !s.retryable && s.uncertain === true)
  })
  test('verify reads the user account', async () => {
    const f = fakeFetch({ 'GET https://api.pinterest.com/v5/user_account': () => json({ username: 'vyra', id: 'u1' }) })
    assert.deepStrictEqual(await pinterestConnector.verify({ accessToken: 'T' }, f.fn), { ok: true, externalId: 'u1', name: 'vyra' })
    const bad = await pinterestConnector.verify({ accessToken: 'T' }, fakeFetch({ 'GET ': () => json({ message: 'no' }, 401) }).fn)
    assert.ok(!bad.ok)
  })
})

describe('Telegram', () => {
  const B = 'https://api.telegram.org/botBOT:SECRET'
  const tctx = (f: ConnectorContext['fetch'], o: Partial<ConnectorContext> = {}) => ctx(f, { credentials: { botToken: 'BOT:SECRET' }, externalId: '@vyrashop', ...o })
  test('text goes through sendMessage', async () => {
    const f = fakeFetch({ [`POST ${B}/sendMessage`]: () => json({ ok: true, result: { message_id: 7, chat: { id: -100, username: 'vyrashop' } } }) })
    const r = await telegramConnector.publish(post(), tctx(f.fn))
    assert.deepStrictEqual(r, { ok: true, externalId: '-100:7', externalUrl: 'https://t.me/vyrashop/7' })
    assert.deepStrictEqual(f.calls[0].body, { chat_id: '@vyrashop', text: 'Pink dress, new in\nSizes 2 to 8.\n\nhttps://shop.example/p/pink?src=mkabc' })
  })
  test('one photo goes through sendPhoto with a caption', async () => {
    const f = fakeFetch({ [`POST ${B}/sendPhoto`]: () => json({ ok: true, result: { message_id: 8, chat: { id: -100 } } }) })
    const r = await telegramConnector.publish(post({ imageUrls: ['https://img/1.jpg'] }), tctx(f.fn))
    assert.ok(r.ok)
    assert.deepStrictEqual(f.calls[0].body, { chat_id: '@vyrashop', photo: 'https://img/1.jpg', caption: 'Pink dress, new in\nSizes 2 to 8.\n\nhttps://shop.example/p/pink?src=mkabc' })
  })
  test('several photos go through sendMediaGroup, caption on the first', async () => {
    const f = fakeFetch({ [`POST ${B}/sendMediaGroup`]: () => json({ ok: true, result: [{ message_id: 9, chat: { id: -100 } }, { message_id: 10, chat: { id: -100 } }] }) })
    const r = await telegramConnector.publish(post({ text: 'Hi', link: null, imageUrls: ['https://i/1', 'https://i/2'] }), tctx(f.fn))
    assert.ok(r.ok && r.externalId === '-100:9')
    assert.deepStrictEqual(f.calls[0].body, { chat_id: '@vyrashop', media: [{ type: 'photo', media: 'https://i/1', caption: 'Hi' }, { type: 'photo', media: 'https://i/2' }] })
  })
  test('a caption over 1024 characters is sent as a message after the photo', async () => {
    const f = fakeFetch({
      [`POST ${B}/sendPhoto`]: () => json({ ok: true, result: { message_id: 1, chat: { id: -100 } } }),
      [`POST ${B}/sendMessage`]: () => json({ ok: true, result: { message_id: 2, chat: { id: -100 } } }),
    })
    const r = await telegramConnector.publish(post({ text: 'x'.repeat(1500), link: null, imageUrls: ['https://i/1'] }), tctx(f.fn))
    assert.ok(r.ok)
    assert.deepStrictEqual(f.calls.map((c) => c.url.split('/').pop()), ['sendPhoto', 'sendMessage'])
    assert.strictEqual(f.calls[0].body.caption, undefined)
  })
  test('errors: bad token, rate limit with retry_after, and the token never leaks', async () => {
    const e = await telegramConnector.publish(post(), tctx(fakeFetch({ 'POST ': () => json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401) }).fn))
    assert.ok(!e.ok && !e.retryable && e.code === 401)
    const l = await telegramConnector.publish(post(), tctx(fakeFetch({ 'POST ': () => json({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 5', parameters: { retry_after: 5 } }, 429) }).fn))
    assert.ok(!l.ok && l.retryable)
    const leak = await telegramConnector.publish(post(), tctx(fakeFetch({ 'POST ': () => json({ ok: false, error_code: 400, description: 'bad url https://api.telegram.org/bot123:ABC-def/x' }, 400) }).fn))
    assert.ok(!leak.ok && !/ABC-def/.test(leak.error))
  })
  test('verify calls getMe then getChat', async () => {
    const f = fakeFetch({
      [`POST ${B}/getMe`]: () => json({ ok: true, result: { id: 1, is_bot: true } }),
      [`POST ${B}/getChat`]: () => json({ ok: true, result: { id: -100, title: 'VYRA' } }),
    })
    assert.deepStrictEqual(await telegramConnector.verify({ botToken: 'BOT:SECRET', channel: '@vyrashop' }, f.fn), { ok: true, externalId: '-100', name: 'VYRA' })
    assert.deepStrictEqual(f.calls.map((c) => c.url.split('/').pop()), ['getMe', 'getChat'])
    assert.deepStrictEqual(f.calls[1].body, { chat_id: '@vyrashop' })
  })
})

describe('X', () => {
  const X = 'https://api.x.com/2'
  test('text-only post with a link costs $0.20', async () => {
    const f = fakeFetch({ [`POST ${X}/tweets`]: () => json({ data: { id: '55', text: 'x' } }, 201) })
    const r = await xConnector.publish(post(), ctx(f.fn))
    assert.ok(r.ok && r.externalUrl === 'https://x.com/i/status/55' && /\$0\.20/.test(r.message ?? ''))
    assert.deepStrictEqual(f.calls[0].body, { text: 'Pink dress, new in\nSizes 2 to 8.\n\nhttps://shop.example/p/pink?src=mkabc' })
    assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer TOKEN-SECRET-1234')
  })
  test('post without a link costs $0.015', async () => {
    const f = fakeFetch({ [`POST ${X}/tweets`]: () => json({ data: { id: '56' } }, 201) })
    const r = await xConnector.publish(post({ link: null }), ctx(f.fn))
    assert.ok(r.ok && /\$0\.015/.test(r.message ?? ''))
  })
  test('image goes through v2 initialize, append, finalize, then the post carries media_ids', async () => {
    const f = fakeFetch({
      'GET https://img/1.png': bytes('image/png', 100),
      [`POST ${X}/media/upload/initialize`]: () => json({ data: { id: 'm1', media_key: '3_1', expires_after_secs: 100 } }),
      [`POST ${X}/media/upload/m1/append`]: () => new Response(null, { status: 204 }),
      [`POST ${X}/media/upload/m1/finalize`]: () => json({ data: { id: 'm1', size: 100 } }),
      [`POST ${X}/tweets`]: () => json({ data: { id: '57' } }, 201),
    })
    const r = await xConnector.publish(post({ imageUrls: ['https://img/1.png'] }), ctx(f.fn))
    assert.ok(r.ok)
    assert.deepStrictEqual(f.calls.map((c) => `${c.method} ${c.url.replace(X, '')}`), [
      'GET https://img/1.png', 'POST /media/upload/initialize', 'POST /media/upload/m1/append', 'POST /media/upload/m1/finalize', 'POST /tweets',
    ])
    assert.deepStrictEqual(f.calls[1].body, { media_type: 'image/png', total_bytes: 100, media_category: 'tweet_image' })
    const form = f.calls[2].raw as FormData
    assert.strictEqual(form.get('segment_index'), '0')
    assert.ok(form.get('media') instanceof Blob)
    assert.deepStrictEqual(f.calls[4].body.media, { media_ids: ['m1'] })
  })
  test('too long text is refused before any request', async () => {
    const f = fakeFetch({})
    const r = await xConnector.publish(post({ text: 'a'.repeat(270), link: 'https://shop.example/x' }), ctx(f.fn))
    assert.ok(!r.ok && !r.retryable && /280/.test(r.error))
    assert.strictEqual(f.calls.length, 0)
  })
  test('error mapping: expired token, rate limit, no credit', async () => {
    const mk = (s: number) => fakeFetch({ 'POST ': () => json({ title: 'x', detail: 'd' }, s) }).fn
    const a = await xConnector.publish(post(), ctx(mk(401)))
    assert.ok(!a.ok && !a.retryable && a.code === 401)
    const b = await xConnector.publish(post(), ctx(mk(429)))
    assert.ok(!b.ok && b.retryable)
    const c = await xConnector.publish(post(), ctx(mk(402)))
    assert.ok(!c.ok && !c.retryable && /credit/.test(c.error))
  })
  test('verify reads /2/users/me', async () => {
    const f = fakeFetch({ [`GET ${X}/users/me`]: () => json({ data: { id: '1', username: 'vyra' } }) })
    assert.deepStrictEqual(await xConnector.verify({ accessToken: 'T' }, f.fn), { ok: true, externalId: '1', name: '@vyra' })
  })
})

describe('YouTube', () => {
  const TOKEN = 'https://oauth2.googleapis.com/token'
  const UP = 'https://www.googleapis.com/upload/youtube/v3/videos'
  const yctx = (f: ConnectorContext['fetch'], o: Partial<ConnectorContext> = {}) => ctx(f, { credentials: ytCreds, externalId: null, config: { videoUrl: 'https://cdn/v.mp4' }, ...o })
  const routes = (): Record<string, Handler> => ({
    [`POST ${TOKEN}`]: () => json({ access_token: 'AT' }),
    'GET https://cdn/v.mp4': bytes('video/mp4', 50),
    [`POST ${UP}`]: () => json({}, 200, { location: 'https://upload.example/session1' }),
    'PUT https://upload.example/session1': () => json({ id: 'vid1' }),
  })
  test('refresh, resumable init, upload; unlisted by default', async () => {
    const f = fakeFetch(routes())
    const r = await youtubeConnector.publish(post({ format: 'VIDEO' }), yctx(f.fn))
    assert.ok(r.ok && r.externalId === 'vid1' && r.externalUrl === 'https://www.youtube.com/watch?v=vid1')
    const token = f.calls[0]
    assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(token.body)), { client_id: 'cid', client_secret: 'csecret', refresh_token: 'rtok', grant_type: 'refresh_token' })
    const init = f.calls[2]
    assert.strictEqual(init.url, `${UP}?uploadType=resumable&part=snippet,status`)
    assert.strictEqual(init.headers.Authorization, 'Bearer AT')
    assert.strictEqual(init.headers['X-Upload-Content-Length'], '50')
    assert.strictEqual(init.headers['X-Upload-Content-Type'], 'video/mp4')
    assert.deepStrictEqual(init.body, {
      snippet: { title: 'Pink dress, new in', description: 'Sizes 2 to 8.\n\nhttps://shop.example/p/pink?src=mkabc', categoryId: '22' },
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
    })
    const put = f.calls[3]
    assert.strictEqual(put.method, 'PUT')
    assert.strictEqual(put.headers['Content-Length'], '50')
  })
  test('privacy: default unlisted, public only when configured, junk falls back', async () => {
    assert.strictEqual(privacyOf(null), 'unlisted')
    assert.strictEqual(privacyOf({ privacy: 'public' }), 'public')
    assert.strictEqual(privacyOf({ privacy: 'everyone' }), 'unlisted')
    const f = fakeFetch(routes())
    await youtubeConnector.publish(post({ format: 'VIDEO' }), yctx(f.fn, { config: { videoUrl: 'https://cdn/v.mp4', privacy: 'public' } }))
    assert.strictEqual(f.calls[2].body.status.privacyStatus, 'public')
  })
  test('the video can come from the attached files', async () => {
    const f = fakeFetch(routes())
    const r = await youtubeConnector.publish(post({ format: 'VIDEO', imageUrls: ['https://cdn/v.mp4'] }), yctx(f.fn, { config: null }))
    assert.ok(r.ok)
  })
  test('no video: clear error and no request', async () => {
    const f = fakeFetch(routes())
    const r = await youtubeConnector.publish(post({ format: 'VIDEO', imageUrls: ['https://cdn/pic.jpg'] }), yctx(f.fn, { config: null }))
    assert.ok(!r.ok && !r.retryable && /needs a video/.test(r.error))
    assert.strictEqual(f.calls.length, 0)
  })
  test('error mapping: revoked refresh token, daily upload limit, rate limit', async () => {
    const dead = await youtubeConnector.publish(post({ format: 'VIDEO' }), yctx(fakeFetch({ [`POST ${TOKEN}`]: () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400) }).fn))
    assert.ok(!dead.ok && !dead.retryable && dead.code === 401 && /expired/.test(dead.error))
    const quota = await youtubeConnector.publish(post({ format: 'VIDEO' }), yctx(fakeFetch({ ...routes(), [`POST ${UP}`]: () => json({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'q' } }, 403) }).fn))
    assert.ok(!quota.ok && !quota.retryable && /100 uploads/.test(quota.error))
    const rate = await youtubeConnector.publish(post({ format: 'VIDEO' }), yctx(fakeFetch({ ...routes(), [`POST ${UP}`]: () => json({ error: { message: 'slow' } }, 429) }).fn))
    assert.ok(!rate.ok && rate.retryable)
    const down = await youtubeConnector.publish(post({ format: 'VIDEO' }), yctx(fakeFetch({ ...routes(), 'PUT https://upload.example/session1': () => json({}, 503) }).fn))
    assert.ok(!down.ok && !down.retryable && down.uncertain === true)
  })
  test('verify refreshes then reads the channel', async () => {
    const f = fakeFetch({ [`POST ${TOKEN}`]: () => json({ access_token: 'AT' }), 'GET https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true': () => json({ items: [{ id: 'UC1', snippet: { title: 'VYRA' } }] }) })
    assert.deepStrictEqual(await youtubeConnector.verify(ytCreds, f.fn), { ok: true, externalId: 'UC1', name: 'VYRA' })
    assert.strictEqual(f.calls[1].headers.Authorization, 'Bearer AT')
  })
})

describe('TikTok (inbox drafts only)', () => {
  const T = 'https://open.tiktokapis.com/v2'
  const okInit = () => json({ data: { publish_id: 'p1' }, error: { code: 'ok', message: '', log_id: 'l' } })
  test('video: inbox init by URL, never direct post', async () => {
    const f = fakeFetch({ [`POST ${T}/post/publish/inbox/video/init/`]: okInit })
    const r = await tiktokConnector.publish(post({ format: 'VIDEO' }), ctx(f.fn, { config: { videoUrl: 'https://cdn/v.mp4' } }))
    assert.deepStrictEqual(r, { ok: true, externalId: 'p1', externalUrl: null, message: 'Sent to your TikTok inbox: open TikTok to post it' })
    assert.strictEqual(TIKTOK_INBOX_MESSAGE, 'Sent to your TikTok inbox: open TikTok to post it')
    assert.deepStrictEqual(f.calls[0].body, { source_info: { source: 'PULL_FROM_URL', video_url: 'https://cdn/v.mp4' } })
    assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer TOKEN-SECRET-1234')
    assert.ok(!f.calls.some((c) => /direct|publish\/video/.test(c.url)))
  })
  test('video: file upload mode sends the bytes to the upload url', async () => {
    const f = fakeFetch({
      'GET https://cdn/v.mp4': bytes('video/mp4', 100),
      [`POST ${T}/post/publish/inbox/video/init/`]: () => json({ data: { publish_id: 'p2', upload_url: 'https://upload.tiktok/x?y=1' }, error: { code: 'ok' } }),
      'PUT https://upload.tiktok/x?y=1': () => new Response(null, { status: 201 }),
    })
    const r = await tiktokConnector.publish(post({ format: 'REEL' }), ctx(f.fn, { config: { videoUrl: 'https://cdn/v.mp4', uploadMode: 'file' } }))
    assert.ok(r.ok)
    assert.deepStrictEqual(f.calls[1].body, { source_info: { source: 'FILE_UPLOAD', video_size: 100, chunk_size: 100, total_chunk_count: 1 } })
    assert.strictEqual(f.calls[2].headers['Content-Range'], 'bytes 0-99/100')
    assert.strictEqual(f.calls[2].headers['Content-Type'], 'video/mp4')
  })
  test('photos: content init with MEDIA_UPLOAD', async () => {
    const f = fakeFetch({ [`POST ${T}/post/publish/content/init/`]: okInit })
    const r = await tiktokConnector.publish(post({ format: 'POST', imageUrls: ['https://i/1.jpg', 'https://i/2.jpg'] }), ctx(f.fn))
    assert.ok(r.ok && r.message === TIKTOK_INBOX_MESSAGE)
    assert.deepStrictEqual(f.calls[0].body, {
      media_type: 'PHOTO', post_mode: 'MEDIA_UPLOAD',
      post_info: { title: 'Pink dress, new in', description: 'Sizes 2 to 8.\n\nhttps://shop.example/p/pink?src=mkabc' },
      source_info: { source: 'PULL_FROM_URL', photo_images: ['https://i/1.jpg', 'https://i/2.jpg'], photo_cover_index: 0 },
    })
  })
  test('nothing to send: clear errors, no request', async () => {
    const f = fakeFetch({})
    const v = await tiktokConnector.publish(post({ format: 'VIDEO' }), ctx(f.fn))
    assert.ok(!v.ok && /needs a video/.test(v.error))
    const p = await tiktokConnector.publish(post({ format: 'POST' }), ctx(f.fn))
    assert.ok(!p.ok)
    assert.strictEqual(f.calls.length, 0)
  })
  test('error mapping from the error code in the body', async () => {
    const mk = (status: number, code: string) => fakeFetch({ 'POST ': () => json({ data: {}, error: { code, message: 'm' } }, status) }).fn
    const run = (status: number, code: string) => tiktokConnector.publish(post({ format: 'VIDEO' }), ctx(mk(status, code), { config: { videoUrl: 'https://cdn/v.mp4' } }))
    const exp = await run(401, 'access_token_invalid')
    assert.ok(!exp.ok && !exp.retryable && exp.code === 401)
    const rate = await run(429, 'rate_limit_exceeded')
    assert.ok(!rate.ok && rate.retryable)
    const pending = await run(403, 'spam_risk_too_many_pending_share')
    assert.ok(!pending.ok && !pending.retryable && /5 drafts/.test(pending.error))
    const dom = await run(403, 'url_ownership_unverified')
    assert.ok(!dom.ok && /verify/i.test(dom.error))
    const ise = await run(500, 'internal_error')
    assert.ok(!ise.ok && !ise.retryable && ise.uncertain === true)
    // an error code inside a 200 answer is still a failure
    const soft = await run(200, 'invalid_param')
    assert.ok(!soft.ok)
  })
  test('verify reads user info', async () => {
    const f = fakeFetch({ [`GET ${T}/user/info/`]: () => json({ data: { user: { open_id: 'o1', display_name: 'VYRA' } }, error: { code: 'ok' } }) })
    assert.deepStrictEqual(await tiktokConnector.verify({ accessToken: 'T' }, f.fn), { ok: true, externalId: 'o1', name: 'VYRA' })
  })
})

describe('the go-live gate blocks every connector before any fetch', () => {
  const blocks: [string, () => void, Partial<ConnectorContext>][] = [
    ['env off', () => { delete process.env.GRACE_MARKETING_LIVE }, {}],
    ['env not "true"', () => { process.env.GRACE_MARKETING_LIVE = '1' }, {}],
    ['settings off', () => {}, { gate: { ...goodGate(), settings: { liveEnabled: false } } }],
    ['channel not connected', () => {}, { gate: { ...goodGate(), channel: { status: 'NOT_CONNECTED', credentialsEnc: null } } }],
    ['channel without credentials', () => {}, { gate: { ...goodGate(), channel: { status: 'CONNECTED', credentialsEnc: null } } }],
    ['not approved', () => {}, { gate: { ...goodGate(), post: { approvedBy: null, approvedAt: null } } }],
    ['gate missing (fails closed)', () => {}, { gate: undefined }],
  ]
  const cases: [string, Connector, ConnectorPost, Partial<ConnectorContext>][] = [
    ['pinterest', pinterestConnector, post({ format: 'PIN', imageUrls: ['https://i/1'] }), {}],
    ['telegram', telegramConnector, post(), { credentials: { botToken: 'b' }, externalId: '@c' }],
    ['x', xConnector, post(), {}],
    ['youtube', youtubeConnector, post({ format: 'VIDEO' }), { credentials: ytCreds, config: { videoUrl: 'https://cdn/v.mp4' } }],
    ['tiktok video', tiktokConnector, post({ format: 'VIDEO' }), { config: { videoUrl: 'https://cdn/v.mp4' } }],
    ['tiktok photos', tiktokConnector, post({ imageUrls: ['https://i/1'] }), {}],
  ]
  for (const [name, setup, override] of blocks) {
    for (const [label, connector, p, base] of cases) {
      test(`${name}: ${label} throws 409 and makes no request`, async () => {
        setup()
        const f = fakeFetch({})
        await assert.rejects(
          () => connector.publish(p, ctx(f.fn, { ...base, ...override })),
          (e: unknown) => e instanceof WebsiteError && e.status === 409,
        )
        assert.strictEqual(f.calls.length, 0)
      })
    }
  }
})
