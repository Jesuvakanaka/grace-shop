// ZP-1124 (MM-09-AC2/AC3): every publishing connector against a fake fetch. No network, no database.
// When the request that creates the post gets no clear answer (no post ID, or a 5xx) the post may be out,
// so the outcome is UNCERTAIN and it is never retried blind. A 4xx or 429 is a plain failure.
// A step the connector knows came before any creating request (a photo it could not download) is a plain
// failure too: there is nothing on the platform to look for.
// The registry test makes sure a new publishing connector cannot be added without a case here.
import { describe, test, beforeEach, after } from 'node:test'
import assert from 'node:assert'
import { CONNECTORS } from '../src/lib/marketing/connectors'
import { failure, networkFailure, NotSentError } from '../src/lib/marketing/connectors/common'
import { createInstagramConnector } from '../src/lib/marketing/connectors/instagram'
import { createThreadsConnector } from '../src/lib/marketing/connectors/threads'
import { failureOf, MetaGraphError, META_GRAPH_VERSION } from '../src/lib/marketing/connectors/meta-graph'
import { failureOfGoogle, GoogleApiError } from '../src/lib/marketing/connectors/google-oauth'
import type { Connector, ConnectorContext, ConnectorPost, PublishResult } from '../src/lib/marketing/connectors/types'

const savedEnv = process.env.GRACE_MARKETING_LIVE
beforeEach(() => { process.env.GRACE_MARKETING_LIVE = 'true' })
after(() => {
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
})

type Reply = () => Response
/** Routes match "METHOD url" by prefix; the longest wins. Unmatched requests answer 404. */
function fakeFetch(routes: Record<string, Reply>) {
  const calls: string[] = []
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const k = `${init?.method ?? 'GET'} ${url}`
    calls.push(k)
    const key = Object.keys(routes).filter((r) => k.startsWith(r)).sort((a, b) => b.length - a.length)[0]
    return key ? routes[key]() : json({ error: { message: "no route" } }, 404)()
  }
  return { fn, calls }
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(b), { status, headers })
const bytes = (type: string) => () => new Response(new Uint8Array(20), { status: 200, headers: { 'content-type': type } })

const gate = () => ({ settings: { liveEnabled: true }, channel: { status: 'CONNECTED', credentialsEnc: 'v1:x' }, post: { approvedBy: 'owner', approvedAt: new Date() } })
const basePost = (o: Partial<ConnectorPost> = {}): ConnectorPost => ({
  id: 1, text: 'New in: pink dress', imageUrls: [], link: 'https://shop.example/p/pink?src=mkabc', format: 'POST', trackingTag: 'mkabc', ...o,
})
const noSleep = async () => {}
const G = `https://graph.facebook.com/${META_GRAPH_VERSION}`
const TH = 'https://graph.threads.net/v1.0'
const TG = 'https://api.telegram.org/botBOT:SECRET'
const TT = 'https://open.tiktokapis.com/v2'
const GOOGLE_TOKEN = 'POST https://oauth2.googleapis.com/token'
const gcreds = { clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt', accountId: '111', locationId: '222' }

interface Case {
  connector: Connector
  post: ConnectorPost
  ctx: Partial<ConnectorContext>
  /** Everything before the creating request, answered as on a good day. */
  before: Record<string, Reply>
  /** The request that creates the post. */
  creating: string
  /** A success-shaped answer to it with no post ID. */
  noId: Reply
  /** A refusal body for a 4xx / 429 in the platform's own shape. */
  refusal: (status: number) => Reply
  /** A request the connector makes BEFORE creating anything that can fail (photo or video download). */
  download?: string
}

const metaRefusal = (s: number) => json({ error: { message: 'refused', code: 100 } }, s)
const CASES: Record<string, Case> = {
  FACEBOOK_PAGE: {
    connector: CONNECTORS.FACEBOOK_PAGE, post: basePost(), ctx: { credentials: { accessToken: 'T' }, externalId: '111' },
    before: {}, creating: `POST ${G}/111/feed`, noId: json({}), refusal: metaRefusal,
  },
  INSTAGRAM: {
    connector: createInstagramConnector({ sleep: noSleep, pollIntervalMs: 1, maxWaitMs: 5 }),
    post: basePost({ imageUrls: ['https://x/a.webp?format=jpeg'] }), ctx: { credentials: { accessToken: 'T' }, externalId: '111' },
    before: {
      [`GET ${G}/111/content_publishing_limit`]: json({ data: [{ quota_usage: 1, config: { quota_total: 50 } }] }),
      [`POST ${G}/111/media`]: json({ id: 'c1' }),
      [`GET ${G}/c1`]: json({ status_code: 'FINISHED' }),
    },
    creating: `POST ${G}/111/media_publish`, noId: json({}), refusal: metaRefusal,
  },
  THREADS: {
    connector: createThreadsConnector({ sleep: noSleep, pollIntervalMs: 1, maxChecks: 2 }),
    post: basePost(), ctx: { credentials: { accessToken: 'T' }, externalId: '555' },
    before: { [`POST ${TH}/555/threads`]: json({ id: 'C1' }), [`GET ${TH}/C1`]: json({ status: 'FINISHED' }) },
    creating: `POST ${TH}/555/threads_publish`, noId: json({}), refusal: metaRefusal,
  },
  PINTEREST: {
    connector: CONNECTORS.PINTEREST, post: basePost({ format: 'PIN', imageUrls: ['https://img/1.jpg'] }), ctx: { credentials: { accessToken: 'T' }, externalId: '999' },
    before: {}, creating: 'POST https://api.pinterest.com/v5/pins', noId: json({}, 201), refusal: (s) => json({ code: 1, message: 'refused' }, s),
  },
  TELEGRAM: {
    connector: CONNECTORS.TELEGRAM, post: basePost(), ctx: { credentials: { botToken: 'BOT:SECRET' }, externalId: '@vyrashop' },
    before: {}, creating: `POST ${TG}/sendMessage`, noId: json({ ok: true, result: { chat: { id: -100 } } }),
    refusal: (s) => json({ ok: false, error_code: s, description: 'refused' }, s),
  },
  X: {
    connector: CONNECTORS.X, post: basePost(), ctx: { credentials: { accessToken: 'T' }, externalId: null },
    before: {}, creating: 'POST https://api.x.com/2/tweets', noId: json({ data: {} }, 201), refusal: (s) => json({ title: 'refused', detail: 'refused' }, s),
  },
  YOUTUBE: {
    connector: CONNECTORS.YOUTUBE, post: basePost({ format: 'VIDEO' }), ctx: { credentials: gcreds, externalId: null, config: { videoUrl: 'https://cdn/v.mp4' } },
    before: {
      [GOOGLE_TOKEN]: json({ access_token: 'AT' }),
      'GET https://cdn/v.mp4': bytes('video/mp4'),
      'POST https://www.googleapis.com/upload/youtube/v3/videos': json({}, 200, { location: 'https://upload.example/s1' }),
    },
    creating: 'PUT https://upload.example/s1', noId: json({}), refusal: (s) => json({ error: { message: 'refused', errors: [{ reason: 'badRequest' }] } }, s),
    download: 'GET https://cdn/v.mp4',
  },
  TIKTOK: {
    connector: CONNECTORS.TIKTOK, post: basePost({ imageUrls: ['https://i/1.jpg'] }), ctx: { credentials: { accessToken: 'T' }, externalId: null },
    before: {}, creating: `POST ${TT}/post/publish/content/init/`, noId: json({ data: {}, error: { code: 'ok' } }),
    refusal: (s) => json({ error: { code: s === 429 ? 'rate_limit_exceeded' : 'invalid_params', message: 'refused' } }, s),
  },
  GOOGLE_BUSINESS: {
    connector: CONNECTORS.GOOGLE_BUSINESS, post: basePost(), ctx: { credentials: gcreds, externalId: 'accounts/111/locations/222' },
    before: { [GOOGLE_TOKEN]: json({ access_token: 'AT', expires_in: 3600 }) },
    creating: 'POST https://mybusiness.googleapis.com/v4/accounts/111/locations/222/localPosts', noId: json({}), refusal: (s) => json({ error: { message: 'refused' } }, s),
  },
}
/** Connectors that never create a post: messages go out from the Messages screen; the catalogue and ads have their own screens. */
const NOT_POSTS = ['GOOGLE_MERCHANT', 'GOOGLE_ADS']

const run = (c: Case, creating: Reply, extra: Record<string, Reply> = {}): Promise<PublishResult> => {
  const f = fakeFetch({ ...c.before, [c.creating]: creating, ...extra })
  return c.connector.publish(c.post, { credentials: {}, externalId: null, config: null, gate: gate(), ...c.ctx, fetch: f.fn })
}

test('every publishing connector in the registry has a case here', () => {
  for (const [kind, c] of Object.entries(CONNECTORS)) {
    if (c.messagesOnly || NOT_POSTS.includes(kind)) continue
    assert.ok(CASES[kind], `${kind} publishes posts but has no uncertain-outcome case in this file`)
  }
})

test('the connectors that do not post refuse without any request', async () => {
  for (const kind of NOT_POSTS) {
    const f = fakeFetch({})
    const r = await CONNECTORS[kind].publish(basePost(), { credentials: {}, externalId: null, config: null, fetch: f.fn, gate: gate() })
    assert.ok(!r.ok && !r.uncertain, kind)
    assert.strictEqual(f.calls.length, 0, kind)
  }
})

for (const [kind, c] of Object.entries(CASES)) {
  describe(kind, () => {
    test('a success-shaped answer without the post ID is uncertain (MM-09-AC3)', async () => {
      const r = await run(c, c.noId)
      assert.ok(!r.ok && r.uncertain === true && !r.retryable, JSON.stringify(r))
    })
    test('a 5xx on the creating request is uncertain, never Try again (MM-09-AC2)', async () => {
      for (const s of [500, 502, 503, 504]) {
        const r = await run(c, json({ error: { message: 'down' } }, s))
        assert.ok(!r.ok && r.uncertain === true, `${s}: ${JSON.stringify(r)}`)
      }
    })
    test('a 4xx or 429 is a plain failure', async () => {
      for (const s of [400, 403, 429]) {
        const r = await run(c, c.refusal(s))
        assert.ok(!r.ok && !r.uncertain, `${s}: ${JSON.stringify(r)}`)
      }
    })
    if (c.download) {
      test('a file that cannot be downloaded is a plain failure: nothing was sent', async () => {
        const r = await run(c, c.noId, { [c.download as string]: json({}, 404) })
        assert.ok(!r.ok && !r.uncertain, JSON.stringify(r))
      })
    }
  })
}

describe('the error helpers', () => {
  test('failure(): 5xx is uncertain, 4xx and 429 are not', () => {
    for (const s of [500, 502, 503, 504]) assert.ok(failure(s, 'P', '').uncertain === true && !failure(s, 'P', '').retryable, String(s))
    for (const s of [400, 401, 403, 404, 429]) assert.ok(!failure(s, 'P', '').uncertain, String(s))
    assert.ok(failure(429, 'P', '').retryable)
  })
  test('Meta and Google errors: 0 and 5xx are uncertain, 4xx and 429 are not', () => {
    for (const s of [0, 500, 503]) {
      assert.strictEqual(failureOf(new MetaGraphError('x', null, null, null, s, null)).uncertain, true, `meta ${s}`)
      assert.strictEqual(failureOfGoogle(new GoogleApiError('x', s, true)).uncertain, true, `google ${s}`)
    }
    for (const s of [400, 403, 429]) {
      assert.ok(!failureOf(new MetaGraphError('x', 4, null, null, s, null)).uncertain, `meta ${s}`)
      assert.ok(!failureOfGoogle(new GoogleApiError('x', s, s === 429)).uncertain, `google ${s}`)
    }
  })
  test('a NotSentError (nothing was sent) is never uncertain', () => {
    const r = networkFailure('X', new NotSentError('Could not download the file.'))
    assert.ok(!r.ok && !r.uncertain && /download/.test(r.error))
    assert.ok(!failureOf(new NotSentError('no photo')).uncertain)
    assert.strictEqual(networkFailure('X', new Error('socket hang up')).uncertain, true)
  })
})
