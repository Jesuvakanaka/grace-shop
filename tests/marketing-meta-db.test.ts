// ZP-1200: connect / disconnect, publishPost and runDuePosts against DATABASE_URL with a fake Meta (no network).
// Only touches rows it creates (content "ZP1200 meta ...", channels with the test page ids, audit rows by id).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { connectMeta, disconnectChannel } from '../src/lib/marketing/connect'
import { publishPost, runDuePosts, publicImageUrls } from '../src/lib/marketing/publish'
import { getSettings } from '../src/lib/marketing/settings'
import { decryptJson } from '../src/lib/marketing/secrets'
import { generateTrackingTag } from '../src/lib/marketing/tracking'
import { META_GRAPH_VERSION } from '../src/lib/marketing/connectors/meta-graph'
import { WebsiteError } from '../src/lib/website/http'

const owner = { username: 'zp1200-meta-owner', role: 'OWNER' as const }
const TOKEN = 'EAAB-test-token-SECRET-9876'
const PAGE = '777000111'
const IG = '888000222'
const KEY = `products/${'a'.repeat(32)}.webp`
const savedEnv = process.env.GRACE_MARKETING_LIVE
const savedHosts = process.env.GRACE_STOREFRONT_HOSTS
let saved: { liveEnabled: boolean } | null = null
let contentId = 0
const channelIds: number[] = []
const postIds: number[] = []

type Route = (url: URL, init: RequestInit) => unknown
function fake(route: Route) {
  const calls: { method: string; path: string; body: string }[] = []
  const fn = async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    calls.push({ method: init?.method ?? 'GET', path: u.pathname.replace(`/${META_GRAPH_VERSION}`, ''), body: String(init?.body ?? u.search) })
    const body = route(u, init ?? {})
    const isErr = typeof body === 'object' && body !== null && 'error' in body
    return new Response(JSON.stringify(body), { status: isErr ? 400 : 200 })
  }
  return { fn, calls }
}

const pageFetch = (ig: string | null = IG) => fake((u) => {
  const p = u.pathname.replace(`/${META_GRAPH_VERSION}`, '')
  if (p === '/me') return { id: PAGE, name: 'VYRA' }
  if (p === `/${PAGE}`) return { id: PAGE, name: 'VYRA Test Page', ...(ig ? { instagram_business_account: { id: ig } } : {}) }
  return { error: { message: 'nope', code: 100 } }
})

const live = async (on: boolean) => {
  process.env.GRACE_MARKETING_LIVE = on ? 'true' : 'false'
  await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: on } })
}

async function newPost(kind: 'FACEBOOK_PAGE' | 'INSTAGRAM', o: { status?: string; approved?: boolean; scheduledFor?: Date | null; imageKeys?: string[]; attempts?: number } = {}) {
  const channel = await prisma.marketingChannel.findFirst({ where: { kind, externalId: kind === 'INSTAGRAM' ? IG : PAGE } })
  const p = await prisma.marketingPost.create({
    data: {
      contentId, channelKind: kind, channelId: channel!.id, format: 'POST', text: 'ZP1200 meta hello', imageKeys: o.imageKeys ?? [],
      trackingTag: generateTrackingTag(), link: 'https://shop.example/?src=x', status: o.status ?? 'APPROVED',
      approvedBy: o.approved === false ? null : owner.username, approvedAt: o.approved === false ? null : new Date(),
      scheduledFor: o.scheduledFor ?? null, attempts: o.attempts ?? 0, createdBy: owner.username,
    },
  })
  postIds.push(p.id)
  return p
}

before(async () => {
  saved = { liveEnabled: (await getSettings(prisma)).liveEnabled }
  const c = await prisma.marketingContent.create({ data: { title: 'ZP1200 meta content', createdBy: owner.username } })
  contentId = c.id
})

after(async () => {
  await prisma.marketingPost.deleteMany({ where: { id: { in: postIds } } })
  await prisma.marketingContent.deleteMany({ where: { id: contentId } })
  await prisma.marketingChannel.deleteMany({ where: { externalId: { in: [PAGE, IG] } } })
  await prisma.marketingAuditLog.deleteMany({ where: { OR: [{ actor: owner.username }, { entity: 'post', entityId: { in: postIds } }, { entity: 'channel', entityId: { in: channelIds } }] } })
  if (saved) await prisma.marketingSettings.update({ where: { id: 1 }, data: saved })
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
  if (savedHosts === undefined) delete process.env.GRACE_STOREFRONT_HOSTS
  else process.env.GRACE_STOREFRONT_HOSTS = savedHosts
  await prisma.$disconnect()
})

const rejects = (fn: () => Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))

describe('connect and disconnect', () => {
  test('connect verifies with Meta, stores both channels encrypted and never returns the token', async () => {
    const f = pageFetch()
    const r = await connectMeta(prisma, { kind: 'FACEBOOK_PAGE', pageId: PAGE, accessToken: TOKEN }, owner.username, { fetch: f.fn })
    assert.strictEqual(r.instagramLinked, true)
    assert.strictEqual(r.channels.length, 2)
    assert.ok(!JSON.stringify(r).includes(TOKEN))
    assert.ok(!JSON.stringify(r).includes('credentialsEnc'))
    assert.deepStrictEqual(f.calls.map((c) => `${c.method} ${c.path}`), ['GET /me', `GET /${PAGE}`])
    const rows = await prisma.marketingChannel.findMany({ where: { externalId: { in: [PAGE, IG] } }, orderBy: { id: 'asc' } })
    assert.strictEqual(rows.length, 2)
    for (const row of rows) {
      channelIds.push(row.id)
      assert.strictEqual(row.status, 'CONNECTED')
      assert.strictEqual(row.tokenHint, '9876')
      assert.strictEqual(row.connectedBy, owner.username)
      assert.ok(row.connectedAt)
      assert.match(row.credentialsEnc!, /^v1:/)
      assert.ok(!row.credentialsEnc!.includes(TOKEN))
      assert.strictEqual(decryptJson<{ accessToken: string }>(row.credentialsEnc!).accessToken, TOKEN)
      const log = await prisma.marketingAuditLog.findMany({ where: { entity: 'channel', entityId: row.id, action: 'channel.connect' } })
      assert.strictEqual(log.length, 1)
      assert.ok(!JSON.stringify(log[0].detail).includes(TOKEN))
    }
    assert.deepStrictEqual(rows.map((x) => x.kind).sort(), ['FACEBOOK_PAGE', 'INSTAGRAM'])
    // connecting again updates the same rows
    await connectMeta(prisma, { kind: 'INSTAGRAM', pageId: PAGE, accessToken: TOKEN }, owner.username, { fetch: pageFetch().fn })
    assert.strictEqual(await prisma.marketingChannel.count({ where: { externalId: { in: [PAGE, IG] } } }), 2)
  })

  test('bad input, a rejected token and a Page without Instagram change nothing', async () => {
    const before = await prisma.marketingChannel.findMany({ where: { externalId: { in: [PAGE, IG] } }, orderBy: { id: 'asc' } })
    const deps = { fetch: pageFetch().fn }
    await rejects(() => connectMeta(prisma, { kind: 'TIKTOK', pageId: PAGE, accessToken: TOKEN }, owner.username, deps), 400)
    await rejects(() => connectMeta(prisma, { kind: 'FACEBOOK_PAGE', pageId: 'abc', accessToken: TOKEN }, owner.username, deps), 400)
    await rejects(() => connectMeta(prisma, { kind: 'FACEBOOK_PAGE', pageId: PAGE, accessToken: 'a b' }, owner.username, deps), 400)
    await rejects(() => connectMeta(prisma, { kind: 'FACEBOOK_PAGE', pageId: PAGE }, owner.username, deps), 400)
    await rejects(() => connectMeta(prisma, { kind: 'FACEBOOK_PAGE', pageId: PAGE, accessToken: TOKEN, extra: 1 }, owner.username, deps), 400)
    const bad = fake(() => ({ error: { message: 'Invalid OAuth access token', code: 190, type: 'OAuthException' } }))
    await rejects(() => connectMeta(prisma, { kind: 'FACEBOOK_PAGE', pageId: PAGE, accessToken: 'zzzz' }, owner.username, { fetch: bad.fn }), 400, /connect the channel again/)
    await rejects(() => connectMeta(prisma, { kind: 'INSTAGRAM', pageId: PAGE, accessToken: TOKEN }, owner.username, { fetch: pageFetch(null).fn }), 400, /no Instagram account/)
    const after = await prisma.marketingChannel.findMany({ where: { externalId: { in: [PAGE, IG] } }, orderBy: { id: 'asc' } })
    assert.deepStrictEqual(after.map((r) => r.credentialsEnc), before.map((r) => r.credentialsEnc))
  })

  test('disconnect wipes credentials, audits, and a missing channel is 404', async () => {
    const row = await prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'INSTAGRAM', externalId: IG } })
    const dto = await disconnectChannel(prisma, row.id, owner.username)
    assert.strictEqual(dto.status, 'NOT_CONNECTED')
    assert.ok(!('credentialsEnc' in dto))
    const after = await prisma.marketingChannel.findUniqueOrThrow({ where: { id: row.id } })
    assert.deepStrictEqual([after.credentialsEnc, after.tokenHint, after.status], [null, null, 'NOT_CONNECTED'])
    assert.strictEqual((await prisma.marketingAuditLog.findMany({ where: { entity: 'channel', entityId: row.id, action: 'channel.disconnect' } })).length, 1)
    await rejects(() => disconnectChannel(prisma, 2147483000, owner.username), 404)
    // reconnect for the publish tests
    await connectMeta(prisma, { kind: 'FACEBOOK_PAGE', pageId: PAGE, accessToken: TOKEN }, owner.username, { fetch: pageFetch().fn })
  })

  test('any connector: code 401 marks the channel ERROR; a success message goes on the activity log', async () => {
    await live(true)
    const stub = (result: unknown) => () => ({ kind: 'FACEBOOK_PAGE', verify: async () => ({ ok: true as const, externalId: null, name: null }), publish: async () => result }) as never
    const dead = await newPost('FACEBOOK_PAGE')
    const r = await publishPost(prisma, dead.id, owner, { fetch: fake(() => ({})).fn, getConnector: stub({ ok: false, error: 'Token expired', retryable: false, code: 401 }) })
    assert.strictEqual(r.status, 'FAILED')
    const ch = await prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'FACEBOOK_PAGE', externalId: PAGE } })
    assert.strictEqual(ch.status, 'ERROR')
    await connectMeta(prisma, { kind: 'FACEBOOK_PAGE', pageId: PAGE, accessToken: TOKEN }, owner.username, { fetch: pageFetch().fn })
    const noted = await newPost('FACEBOOK_PAGE')
    const p = await publishPost(prisma, noted.id, owner, { fetch: fake(() => ({})).fn, getConnector: stub({ ok: true, externalId: 'x1', externalUrl: null, message: 'Sent to your inbox' }) })
    assert.strictEqual(p.status, 'PUBLISHED')
    const log = await prisma.marketingAuditLog.findFirst({ where: { entity: 'post', entityId: noted.id, action: 'post.publish_note' } })
    assert.deepStrictEqual(log?.detail, { message: 'Sent to your inbox' })
  })
})

describe('publishPost', () => {
  const ok = () => fake((u) => {
    const p = u.pathname.replace(`/${META_GRAPH_VERSION}`, '')
    if (p === `/${PAGE}/photos`) return { id: '1', post_id: `${PAGE}_1` }
    if (p === `/${PAGE}/feed`) return { id: `${PAGE}_2` }
    if (p === `/${IG}/content_publishing_limit`) return { data: [{ quota_usage: 0, config: { quota_total: 50 } }] }
    if (p === `/${IG}/media`) return { id: 'c1' }
    if (p === '/c1') return { status_code: 'FINISHED' }
    if (p === `/${IG}/media_publish`) return { id: 'm1' }
    if (p === '/m1') return { permalink: 'https://www.instagram.com/p/x/' }
    return { error: { message: `unexpected ${p}`, code: 100 } }
  })

  test('every gate condition blocks before any request and leaves the post as it was', async () => {
    const post = await newPost('FACEBOOK_PAGE')
    const f = ok()
    const deps = { fetch: f.fn, baseUrl: 'https://shop.example' }
    await live(false) // env false and settings off
    await rejects(() => publishPost(prisma, post.id, owner, deps), 409, /switched off/)
    process.env.GRACE_MARKETING_LIVE = 'true' // env on, settings off
    await rejects(() => publishPost(prisma, post.id, owner, deps), 409, /marketing settings/)
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: true } })
    const unapproved = await newPost('FACEBOOK_PAGE', { approved: false })
    await rejects(() => publishPost(prisma, unapproved.id, owner, deps), 409, /not approved/)
    const ch = await prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'FACEBOOK_PAGE', externalId: PAGE } })
    await prisma.marketingChannel.update({ where: { id: ch.id }, data: { status: 'NOT_CONNECTED' } })
    await rejects(() => publishPost(prisma, post.id, owner, deps), 409, /not connected/)
    await prisma.marketingChannel.update({ where: { id: ch.id }, data: { status: 'CONNECTED', credentialsEnc: null } })
    await rejects(() => publishPost(prisma, post.id, owner, deps), 409, /no saved credentials/)
    await connectMeta(prisma, { kind: 'FACEBOOK_PAGE', pageId: PAGE, accessToken: TOKEN }, owner.username, { fetch: pageFetch().fn })
    assert.strictEqual(f.calls.length, 0)
    assert.strictEqual((await prisma.marketingPost.findUniqueOrThrow({ where: { id: post.id } })).status, 'APPROVED')
    // wrong status, and a channel with no connector
    await rejects(() => publishPost(prisma, 2147483000, owner, deps), 404)
    const draft = await newPost('FACEBOOK_PAGE', { status: 'DRAFT' })
    await rejects(() => publishPost(prisma, draft.id, owner, deps), 409)
    assert.strictEqual(f.calls.length, 0)
  })

  test('Facebook post with a photo goes out and is recorded', async () => {
    await live(true)
    const post = await newPost('FACEBOOK_PAGE', { imageKeys: [KEY] })
    const f = ok()
    const r = await publishPost(prisma, post.id, owner, { fetch: f.fn, baseUrl: 'https://shop.example/' })
    assert.deepStrictEqual([r.status, r.externalId, r.externalUrl, r.attempts, r.error], ['PUBLISHED', `${PAGE}_1`, `https://www.facebook.com/${PAGE}_1`, 1, null])
    assert.ok(r.publishedAt)
    assert.strictEqual(f.calls.length, 1)
    assert.match(f.calls[0].body, new RegExp(`url=${encodeURIComponent(`https://shop.example/api/images/public/${'a'.repeat(32)}.webp`)}`))
    assert.ok(!f.calls[0].body.includes(TOKEN))
    const log = (await prisma.marketingAuditLog.findMany({ where: { entity: 'post', entityId: post.id }, orderBy: { id: 'asc' } })).map((l) => l.action)
    assert.deepStrictEqual(log, ['post.publish', 'post.published'])
    await rejects(() => publishPost(prisma, post.id, owner, { fetch: f.fn }), 409) // already published
  })

  test('Instagram asks for the JPEG rendition of the photo', async () => {
    await live(true)
    await connectMeta(prisma, { kind: 'INSTAGRAM', pageId: PAGE, accessToken: TOKEN }, owner.username, { fetch: pageFetch().fn })
    const post = await newPost('INSTAGRAM', { imageKeys: [KEY] })
    const f = ok()
    const r = await publishPost(prisma, post.id, owner, { fetch: f.fn, baseUrl: 'https://shop.example' })
    assert.strictEqual(r.status, 'PUBLISHED')
    const media = f.calls.find((c) => c.method === 'POST' && c.path === `/${IG}/media`)!
    assert.ok(media.body.includes(encodeURIComponent(`https://shop.example/api/images/public/${'a'.repeat(32)}.webp?format=jpeg`)))
    assert.strictEqual(r.externalUrl, 'https://www.instagram.com/p/x/')
    assert.deepStrictEqual(publicImageUrls([KEY], 'https://h', true), [`https://h/api/images/public/${'a'.repeat(32)}.webp?format=jpeg`])
    assert.throws(() => publicImageUrls([KEY], null, false), /GRACE_STOREFRONT_HOSTS/)
    assert.throws(() => publicImageUrls(['../x'], 'https://h', false), /product photo/)
  })

  test('a Meta failure records FAILED with a plain error; retry is allowed up to 3 attempts; a bad token marks the channel ERROR', async () => {
    await live(true)
    const post = await newPost('FACEBOOK_PAGE')
    const bad = fake(() => ({ error: { message: 'temporary', code: 2 } }))
    const r = await publishPost(prisma, post.id, owner, { fetch: bad.fn })
    assert.deepStrictEqual([r.status, r.attempts], ['FAILED', 1])
    assert.match(r.error!, /temporary problem/)
    const again = await publishPost(prisma, post.id, owner, { fetch: ok().fn }) // retry
    assert.deepStrictEqual([again.status, again.attempts], ['PUBLISHED', 2])
    const worn = await newPost('FACEBOOK_PAGE', { status: 'FAILED', attempts: 3 })
    await rejects(() => publishPost(prisma, worn.id, owner, { fetch: ok().fn }), 409, /failed 3 times/)
    const expired = await newPost('FACEBOOK_PAGE')
    const e = await publishPost(prisma, expired.id, owner, { fetch: fake(() => ({ error: { message: 'expired', code: 190 } })).fn })
    assert.strictEqual(e.status, 'FAILED')
    const ch = await prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'FACEBOOK_PAGE', externalId: PAGE } })
    assert.strictEqual(ch.status, 'ERROR')
    assert.match(ch.lastError!, /connect the channel again/)
    await connectMeta(prisma, { kind: 'FACEBOOK_PAGE', pageId: PAGE, accessToken: TOKEN }, owner.username, { fetch: pageFetch().fn })
  })
})

describe('runDuePosts', () => {
  const now = new Date('2026-12-01T10:00:00Z')
  const okFetch = () => fake((u) => (u.pathname.endsWith('/feed') ? { id: `${PAGE}_9` } : { error: { message: 'x', code: 100 } }))

  test('publishes only due, approved posts, at most max per run, oldest first', async () => {
    await live(true)
    const a = await newPost('FACEBOOK_PAGE', { status: 'SCHEDULED', scheduledFor: new Date('2026-12-01T08:00:00Z') })
    const b = await newPost('FACEBOOK_PAGE', { status: 'SCHEDULED', scheduledFor: new Date('2026-12-01T09:00:00Z') })
    const later = await newPost('FACEBOOK_PAGE', { status: 'SCHEDULED', scheduledFor: new Date('2026-12-01T11:00:00Z') })
    const f = okFetch()
    const r1 = await runDuePosts(prisma, now, { fetch: f.fn }, { max: 1 })
    assert.deepStrictEqual([r1.checked, r1.published], [1, [a.id]])
    const r2 = await runDuePosts(prisma, now, { fetch: f.fn })
    assert.deepStrictEqual(r2.published.filter((id) => id === b.id), [b.id])
    assert.strictEqual((await prisma.marketingPost.findUniqueOrThrow({ where: { id: later.id } })).status, 'SCHEDULED')
    assert.strictEqual((await prisma.marketingPost.findUniqueOrThrow({ where: { id: a.id } })).status, 'PUBLISHED')
  })

  test('with the gate closed nothing is touched or fetched and the reason is returned', async () => {
    const p = await newPost('FACEBOOK_PAGE', { status: 'SCHEDULED', scheduledFor: new Date('2026-12-01T08:30:00Z') })
    const unapproved = await newPost('FACEBOOK_PAGE', { status: 'SCHEDULED', approved: false, scheduledFor: new Date('2026-12-01T08:31:00Z') })
    for (const [label, setup, re] of [
      ['env off', async () => { await live(false) }, /GRACE_MARKETING_LIVE/],
      ['settings off', async () => { process.env.GRACE_MARKETING_LIVE = 'true'; await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: false } }) }, /marketing settings/],
    ] as const) {
      await setup()
      const f = okFetch()
      const r = await runDuePosts(prisma, now, { fetch: f.fn }, { max: 50 })
      assert.strictEqual(f.calls.length, 0, label)
      assert.deepStrictEqual(r.published, [], label)
      assert.match(r.reason ?? '', re, label)
      assert.ok(r.blocked.some((x) => x.postId === p.id), label)
    }
    await live(true)
    const f = okFetch()
    const r = await runDuePosts(prisma, now, { fetch: f.fn }, { max: 50 })
    assert.ok(r.blocked.some((x) => x.postId === unapproved.id && /not approved/.test(x.reason)))
    assert.ok(r.published.includes(p.id))
    assert.strictEqual((await prisma.marketingPost.findUniqueOrThrow({ where: { id: unapproved.id } })).status, 'SCHEDULED')
  })

  test('a failing post is reported failed and the run goes on', async () => {
    await live(true)
    const p = await newPost('FACEBOOK_PAGE', { status: 'SCHEDULED', scheduledFor: new Date('2026-12-01T07:00:00Z') })
    const r = await runDuePosts(prisma, now, { fetch: fake(() => ({ error: { message: 'x', code: 1 } })).fn }, { max: 50 })
    assert.ok(r.failed.includes(p.id))
    assert.strictEqual((await prisma.marketingPost.findUniqueOrThrow({ where: { id: p.id } })).status, 'FAILED')
  })
})
