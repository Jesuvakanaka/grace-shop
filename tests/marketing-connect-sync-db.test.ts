// ZP-1200: connect Threads / Google Business / Google Merchant, and the owner product sync, against DATABASE_URL with a fake fetch.
// Only touches rows it creates (channels with the test ids below; settings are restored).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { connectMeta } from '../src/lib/marketing/connect'
import { syncProducts } from '../src/lib/marketing/merchant-sync'
import { decryptJson } from '../src/lib/marketing/secrets'
import { getSettings } from '../src/lib/marketing/settings'
import type { PublicProduct } from '../src/lib/storefront/dto'
import { WebsiteError } from '../src/lib/website/http'

const owner = { username: 'zp1200-sync-owner', role: 'OWNER' as const }
const staff = { username: 'zp1200-sync-staff', role: 'STAFF' as const }
const TH_TOKEN = 'THREADS-SECRET-TOKEN-4321'
const REFRESH = 'GOOGLE-REFRESH-SECRET-7788'
const MERCHANT = '9300001'
const BASE = { clientId: 'cid-zp1200', clientSecret: 'csecret-zp1200', refreshToken: REFRESH }
const savedEnv = process.env.GRACE_MARKETING_LIVE
const savedHosts = process.env.GRACE_STOREFRONT_HOSTS
let saved: { liveEnabled: boolean; productFeedEnabled: boolean } | null = null
const channelIds: number[] = []

function fake(routes: Record<string, unknown>) {
  const calls: string[] = []
  const fn = async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const key = `${init?.method ?? 'GET'} ${u.host}${u.pathname}`
    calls.push(key)
    const body = routes[key]
    if (body === undefined) return new Response(JSON.stringify({ error: { message: `no route ${key}`, code: 100 } }), { status: 404 })
    const isErr = typeof body === 'object' && body !== null && 'error' in body
    return new Response(JSON.stringify(body), { status: isErr ? 400 : 200 })
  }
  return { fn, calls }
}
const googleOk = {
  'POST oauth2.googleapis.com/token': { access_token: 'A1' },
  [`GET merchantapi.googleapis.com/accounts/v1/accounts/${MERCHANT}`]: { accountName: 'ZP1200 shop' },
}
const product = (n: number, price: number | null): PublicProduct => ({
  slug: `zp1200-p${n}`, name: `ZP1200 dress ${n}`, itemNumber: `ZP1200-${n}`, ref: `r${n}`, description: 'd', priceUsd: price, availability: 'IN_STOCK', preOrder: false,
  category: { slug: 'dresses', name: 'Dresses' }, images: [{ url: `/api/images/public/zz${n}.webp` }],
}) as unknown as PublicProduct

before(async () => {
  const s = await getSettings(prisma)
  saved = { liveEnabled: s.liveEnabled, productFeedEnabled: s.productFeedEnabled }
  process.env.GRACE_STOREFRONT_HOSTS = 'shop.zp1200.example'
})
after(async () => {
  await prisma.marketingChannel.deleteMany({ where: { id: { in: channelIds } } })
  await prisma.marketingAuditLog.deleteMany({ where: { OR: [{ actor: owner.username }, { actor: staff.username }, { entity: 'channel', entityId: { in: channelIds } }] } })
  if (saved) await prisma.marketingSettings.update({ where: { id: 1 }, data: saved })
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
  if (savedHosts === undefined) delete process.env.GRACE_STOREFRONT_HOSTS
  else process.env.GRACE_STOREFRONT_HOSTS = savedHosts
  await prisma.$disconnect()
})

const rejects = (fn: () => Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))

describe('connect: Threads, Google Business, Google Merchant', () => {
  test('Threads: verified first, stored encrypted, only the hint comes back', async () => {
    const f = fake({ 'GET graph.threads.net/v1.0/me': { id: '4400001', username: 'zp1200' } })
    const r = await connectMeta(prisma, { kind: 'THREADS', accessToken: TH_TOKEN }, owner.username, { fetch: f.fn })
    assert.deepStrictEqual(f.calls, ['GET graph.threads.net/v1.0/me'])
    assert.ok(!JSON.stringify(r).includes(TH_TOKEN))
    assert.strictEqual(r.channels[0].tokenHint, '4321')
    assert.strictEqual(r.channels[0].externalId, '4400001')
    channelIds.push(r.channels[0].id)
    const row = await prisma.marketingChannel.findUniqueOrThrow({ where: { id: r.channels[0].id } })
    assert.strictEqual(row.status, 'CONNECTED')
    assert.ok(!row.credentialsEnc!.includes(TH_TOKEN))
    assert.strictEqual(decryptJson<{ accessToken: string }>(row.credentialsEnc!).accessToken, TH_TOKEN)
    const log = await prisma.marketingAuditLog.findMany({ where: { entity: 'channel', entityId: row.id, action: 'channel.connect' } })
    assert.ok(log.length >= 1 && !JSON.stringify(log).includes(TH_TOKEN))
  })

  test('Google Business: checks the location, secrets stay out of config and the answer', async () => {
    const f = fake({
      'POST oauth2.googleapis.com/token': { access_token: 'A1' },
      'GET mybusinessbusinessinformation.googleapis.com/v1/accounts/6100001/locations': { locations: [{ name: 'locations/6200001', title: 'ZP1200 Shop' }] },
    })
    const body = { kind: 'GOOGLE_BUSINESS', accountId: '6100001', locationId: '6200001', ...BASE }
    const r = await connectMeta(prisma, body, owner.username, { fetch: f.fn })
    channelIds.push(r.channels[0].id)
    for (const secret of [REFRESH, BASE.clientSecret]) assert.ok(!JSON.stringify(r).includes(secret))
    assert.strictEqual(r.channels[0].externalId, 'accounts/6100001/locations/6200001')
    assert.strictEqual(r.channels[0].tokenHint, '7788')
    const row = await prisma.marketingChannel.findUniqueOrThrow({ where: { id: r.channels[0].id } })
    assert.deepStrictEqual(row.config, { accountId: '6100001', locationId: '6200001', clientId: BASE.clientId })
    assert.ok(!JSON.stringify(row.config).includes('ecret'))
    assert.strictEqual(decryptJson<Record<string, string>>(row.credentialsEnc!).clientSecret, BASE.clientSecret)
  })

  test('Google Merchant connects (and keeps saved settings on reconnect)', async () => {
    const r = await connectMeta(prisma, { kind: 'GOOGLE_MERCHANT', merchantId: MERCHANT, ...BASE }, owner.username, { fetch: fake(googleOk).fn })
    channelIds.push(r.channels[0].id)
    assert.strictEqual(r.channels[0].externalId, MERCHANT)
    await prisma.marketingChannel.update({ where: { id: r.channels[0].id }, data: { config: { merchantId: MERCHANT, apiDataSource: 'accounts/9300001/dataSources/1' } } })
    await connectMeta(prisma, { kind: 'GOOGLE_MERCHANT', merchantId: MERCHANT, ...BASE }, owner.username, { fetch: fake(googleOk).fn })
    const row = await prisma.marketingChannel.findUniqueOrThrow({ where: { id: r.channels[0].id } })
    assert.strictEqual((row.config as Record<string, string>).apiDataSource, 'accounts/9300001/dataSources/1')
  })

  test('bad input is rejected with 400 and nothing is requested or saved', async () => {
    const f = fake({})
    const before = await prisma.marketingChannel.count()
    const deps = { fetch: f.fn }
    const ok = { kind: 'GOOGLE_BUSINESS', accountId: '6100001', locationId: '6200001', ...BASE }
    await rejects(() => connectMeta(prisma, { ...ok, accountId: 'abc' }, owner.username, deps), 400, /digits only/)
    await rejects(() => connectMeta(prisma, { ...ok, refreshToken: undefined }, owner.username, deps), 400, /Refresh token/)
    await rejects(() => connectMeta(prisma, { ...ok, clientSecret: 'a b' }, owner.username, deps), 400, /spaces/)
    await rejects(() => connectMeta(prisma, { ...ok, locationId: 5 }, owner.username, deps), 400, /must be text/)
    await rejects(() => connectMeta(prisma, { ...ok, extra: 'x' }, owner.username, deps), 400, /Unknown field/)
    await rejects(() => connectMeta(prisma, { ...ok, pageId: '12345' }, owner.username, deps), 400, /Unknown field/)
    await rejects(() => connectMeta(prisma, { kind: 'THREADS' }, owner.username, deps), 400, /Threads access token/)
    await rejects(() => connectMeta(prisma, { kind: 'THREADS', accessToken: 'a b' }, owner.username, deps), 400, /spaces/)
    await rejects(() => connectMeta(prisma, { kind: 'GOOGLE_ADS', accessToken: 'x' }, owner.username, deps), 400, /kind must be one of/)
    await rejects(() => connectMeta(prisma, { kind: 'GOOGLE_MERCHANT', merchantId: MERCHANT }, owner.username, deps), 400)
    assert.strictEqual(f.calls.length, 0)
    assert.strictEqual(await prisma.marketingChannel.count(), before)
  })

  test('a rejected credential (Google says no) is a 400 in plain words and saves nothing', async () => {
    const f = fake({ 'POST oauth2.googleapis.com/token': { error: 'invalid_grant' } })
    const row = await prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'GOOGLE_MERCHANT', externalId: MERCHANT } })
    const enc = row.credentialsEnc
    await rejects(() => connectMeta(prisma, { kind: 'GOOGLE_MERCHANT', merchantId: MERCHANT, ...BASE, refreshToken: 'WRONG-REFRESH' }, owner.username, { fetch: f.fn }), 400, /no longer accepts/)
    assert.strictEqual((await prisma.marketingChannel.findUniqueOrThrow({ where: { id: row.id } })).credentialsEnc, enc)
    const f2 = fake({ 'GET graph.threads.net/v1.0/me': { error: { code: 190, message: 'bad' } } })
    await rejects(() => connectMeta(prisma, { kind: 'THREADS', accessToken: 'WRONG' }, owner.username, { fetch: f2.fn }), 400, /connect the channel again/)
  })
})

describe('syncProducts: every condition blocks, and nothing is sent', () => {
  const routes = {
    ...googleOk,
    [`POST merchantapi.googleapis.com/datasources/v1/accounts/${MERCHANT}/dataSources`]: { name: `accounts/${MERCHANT}/dataSources/50` },
    [`POST merchantapi.googleapis.com/products/v1/accounts/${MERCHANT}/productInputs:insert`]: { name: 'p' },
  }
  const set = async (live: boolean, feed = true) => {
    process.env.GRACE_MARKETING_LIVE = live ? 'true' : 'false'
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: live, productFeedEnabled: feed } })
  }
  const loadProducts = async () => [product(1, 12), product(2, null), product(3, 20)]
  const ch = () => prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'GOOGLE_MERCHANT', externalId: MERCHANT } })

  test('blocked by each condition', async () => {
    const row = await ch()
    const f = fake(routes)
    const deps = { fetch: f.fn, loadProducts }
    await set(false)
    await rejects(() => syncProducts(prisma, row.id, 'products', owner, deps), 409, /server/)
    process.env.GRACE_MARKETING_LIVE = 'true' // env on but the setting is off
    await rejects(() => syncProducts(prisma, row.id, 'products', owner, deps), 409, /marketing settings/)
    await set(true)
    await rejects(() => syncProducts(prisma, row.id, 'products', staff, deps), 409, /Only the owner/)
    await prisma.marketingChannel.update({ where: { id: row.id }, data: { status: 'NOT_CONNECTED' } })
    await rejects(() => syncProducts(prisma, row.id, 'products', owner, deps), 409, /not connected/)
    await prisma.marketingChannel.update({ where: { id: row.id }, data: { status: 'CONNECTED', credentialsEnc: null } })
    await rejects(() => syncProducts(prisma, row.id, 'products', owner, deps), 409, /no saved credentials/)
    await prisma.marketingChannel.update({ where: { id: row.id }, data: { credentialsEnc: row.credentialsEnc } })
    await set(true, false)
    await rejects(() => syncProducts(prisma, row.id, 'products', owner, deps), 409, /Product feed/)
    await rejects(() => syncProducts(prisma, 987654321, 'products', owner, deps), 404)
    const threads = await prisma.marketingChannel.findFirstOrThrow({ where: { kind: 'THREADS', externalId: '4400001' } })
    await set(true)
    await rejects(() => syncProducts(prisma, threads.id, 'products', owner, deps), 409, /Only Google Merchant/)
    assert.strictEqual(f.calls.length, 0)
  })

  test('all conditions hold: products are pushed, the data source is saved, the audit row has counts only', async () => {
    await set(true)
    const row = await ch()
    const f = fake(routes)
    const r = await syncProducts(prisma, row.id, 'products', owner, { fetch: f.fn, loadProducts })
    assert.deepStrictEqual(r, { mode: 'products', sent: 2, skipped: 1, failed: 0, capped: false, firstError: null })
    assert.strictEqual(f.calls.filter((c) => c.endsWith(':insert')).length, 2)
    const after = await ch()
    // the data source saved earlier is reused, so no new one is created
    assert.strictEqual((after.config as Record<string, string>).apiDataSource, `accounts/${MERCHANT}/dataSources/1`)
    assert.ok(!f.calls.some((c) => c.endsWith('/dataSources')))
    const log = await prisma.marketingAuditLog.findFirstOrThrow({ where: { entity: 'channel', entityId: row.id, action: 'channel.sync' }, orderBy: { id: 'desc' } })
    assert.deepStrictEqual(log.detail, { mode: 'products', sent: 2, skipped: 1, failed: 0, capped: false })
    assert.ok(!JSON.stringify(log).includes(REFRESH))
  })

  test('register-feed sends the public feed URL', async () => {
    await set(true)
    const row = await ch()
    const f = fake(routes)
    const r = await syncProducts(prisma, row.id, 'register-feed', owner, { fetch: f.fn })
    assert.deepStrictEqual(r, { mode: 'register-feed', dataSource: `accounts/${MERCHANT}/dataSources/50`, feedUrl: 'https://shop.zp1200.example/api/public/marketing/feed.xml' })
  })

  test('revoked credentials move the channel to ERROR with a plain message', async () => {
    await set(true)
    const row = await ch()
    const f = fake({ 'POST oauth2.googleapis.com/token': { error: 'invalid_grant' } })
    await rejects(() => syncProducts(prisma, row.id, 'products', owner, { fetch: f.fn, loadProducts }), 400, /no longer accepts/)
    const after = await ch()
    assert.strictEqual(after.status, 'ERROR')
    assert.match(after.lastError ?? '', /no longer accepts/)
  })
})

describe('connect: Telegram and Pinterest through the field list', () => {
  test('Telegram: the bot token is verified, stored encrypted, the chat id becomes the channel id', async () => {
    const BOT = '123456:ZP1200-BOT-SECRET-9911'
    const f = fake({
      [`POST api.telegram.org/bot${BOT}/getMe`]: { ok: true, result: { id: 1, username: 'zp1200_bot' } },
      [`POST api.telegram.org/bot${BOT}/getChat`]: { ok: true, result: { id: -1009300001, title: 'ZP1200 channel' } },
    })
    const r = await connectMeta(prisma, { kind: 'TELEGRAM', channel: '@zp1200shop', botToken: BOT }, owner.username, { fetch: f.fn })
    channelIds.push(r.channels[0].id)
    assert.strictEqual(r.channels[0].tokenHint, '9911')
    assert.ok(!JSON.stringify(r).includes(BOT))
    const row = await prisma.marketingChannel.findUniqueOrThrow({ where: { id: r.channels[0].id } })
    assert.deepStrictEqual([row.status, row.externalId], ['CONNECTED', '-1009300001'])
    assert.strictEqual(decryptJson<Record<string, string>>(row.credentialsEnc!).botToken, BOT)
  })

  test('Pinterest: the board id is kept in config and a missing board is refused before any call', async () => {
    const TOKEN = 'pina_ZP1200-SECRET-5566'
    const f = fake({ 'GET api.pinterest.com/v5/user_account': { id: '77001', username: 'zp1200' } })
    await rejects(() => connectMeta(prisma, { kind: 'PINTEREST', accessToken: TOKEN }, owner.username, { fetch: f.fn }), 400, /Board ID/)
    assert.strictEqual(f.calls.length, 0)
    const r = await connectMeta(prisma, { kind: 'PINTEREST', boardId: '930000123', accessToken: TOKEN }, owner.username, { fetch: f.fn })
    channelIds.push(r.channels[0].id)
    const row = await prisma.marketingChannel.findUniqueOrThrow({ where: { id: r.channels[0].id } })
    assert.strictEqual((row.config as Record<string, string>).boardId, '930000123')
  })
})
