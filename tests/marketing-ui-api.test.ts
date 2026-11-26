// ZP-1200: the small endpoints the Marketing screens use (status, products, add channels to content).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import { getSettings } from '../src/lib/marketing/settings'
import { createContent } from '../src/lib/marketing/content'
import { getHubStatus } from '../src/lib/marketing/status'
import { cleanQuery } from '../src/lib/marketing/product-picker'
import * as statusRoute from '../src/app/api/marketing/status/route'
import * as productsRoute from '../src/app/api/marketing/products/route'
import * as contentPostsRoute from '../src/app/api/marketing/content/[id]/posts/route'

let ownerToken = ''
let staffToken = ''
let liveProductId = 0
let draftProductId = 0
let contentId = 0
let saved: { liveEnabled: boolean } | null = null
const KEY = 'a'.repeat(32)
const savedHub = process.env.GRACE_MARKETING_HUB
const stamp = Date.now()

const req = (url: string, token: string | null, method = 'GET', body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { ...(token ? { cookie: `auth-token=${token}` } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })

before(async () => {
  ownerToken = await createToken(900210, 'zp1200-ui-owner', 'OWNER')
  staffToken = await createToken(900211, 'zp1200-ui-staff', 'STAFF')
  saved = { liveEnabled: (await getSettings(prisma)).liveEnabled }
  const live = await prisma.product.create({ data: { itemNumber: `ZP1200-UI-${stamp}`, productName: 'ZP1200 UI Coral Skirt', slug: `zp1200-ui-coral-${stamp}`, published: true } })
  liveProductId = live.id
  await prisma.productImage.create({ data: { productId: live.id, imageKey: `products/${KEY}.webp`, isPrimary: true } })
  await prisma.productImage.create({ data: { productId: live.id, imageKey: 'products/not-a-valid-key.webp' } })
  const draft = await prisma.product.create({ data: { itemNumber: `ZP1200-UI-D-${stamp}`, productName: 'ZP1200 UI Hidden Skirt', slug: `zp1200-ui-hidden-${stamp}`, published: false } })
  draftProductId = draft.id
  const c = await createContent(prisma, { title: 'ZP1200 UI content', channels: ['WHATSAPP_STATUS'] }, 'zp1200-ui-owner')
  contentId = c.id
})

after(async () => {
  await prisma.marketingContent.deleteMany({ where: { id: contentId } })
  await prisma.product.deleteMany({ where: { id: { in: [liveProductId, draftProductId] } } })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: 'zp1200-ui-owner' } })
  if (saved) await prisma.marketingSettings.update({ where: { id: 1 }, data: saved })
  if (savedHub === undefined) delete process.env.GRACE_MARKETING_HUB
  else process.env.GRACE_MARKETING_HUB = savedHub
  await prisma.$disconnect()
})

describe('GET /api/marketing/status', () => {
  test('reports each live switch and never claims live when one is missing', async () => {
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: false } })
    const s = await getHubStatus(prisma, {})
    assert.deepStrictEqual([s.enabled, s.live.env, s.live.settings], [true, false, false])
    const on = await getHubStatus(prisma, { GRACE_MARKETING_LIVE: 'true' })
    assert.strictEqual(on.live.env, true)
    assert.strictEqual(on.live.settings, false)
  })
  test('owner gets 200; staff 403; no cookie 401; hub off 404', async () => {
    assert.strictEqual((await statusRoute.GET(req('/api/marketing/status', ownerToken))).status, 200)
    assert.strictEqual((await statusRoute.GET(req('/api/marketing/status', staffToken))).status, 403)
    assert.strictEqual((await statusRoute.GET(req('/api/marketing/status', null))).status, 401)
    process.env.GRACE_MARKETING_HUB = 'false'
    try {
      assert.strictEqual((await statusRoute.GET(req('/api/marketing/status', ownerToken))).status, 404)
    } finally {
      if (savedHub === undefined) delete process.env.GRACE_MARKETING_HUB
      else process.env.GRACE_MARKETING_HUB = savedHub
    }
  })
})

describe('GET /api/marketing/products', () => {
  test('finds published products with valid photos only; hides unpublished ones unless asked by id', async () => {
    const res = await productsRoute.GET(req('/api/marketing/products?q=ZP1200%20UI', ownerToken))
    const { products } = (await res.json()) as { products: { id: number; name: string; photos: { imageKey: string; url: string }[] }[] }
    const live = products.find((p) => p.id === liveProductId)!
    assert.ok(live)
    assert.deepStrictEqual(live.photos.map((p) => [p.imageKey, p.url]), [[`products/${KEY}.webp`, `/api/images/${KEY}.webp`]])
    assert.ok(!products.some((p) => p.id === draftProductId))
    const byId = (await (await productsRoute.GET(req(`/api/marketing/products?q=nomatchxyz&ids=${draftProductId}`, ownerToken))).json()) as { products: { id: number }[] }
    assert.deepStrictEqual(byId.products.map((p) => p.id), [draftProductId])
  })
  test('is owner only', async () => {
    assert.strictEqual((await productsRoute.GET(req('/api/marketing/products', staffToken))).status, 403)
  })
  test('cleanQuery trims and caps', () => {
    assert.strictEqual(cleanQuery('  pink  '), 'pink')
    assert.strictEqual(cleanQuery(null), '')
    assert.strictEqual(cleanQuery('x'.repeat(200)).length, 80)
  })
})

describe('POST /api/marketing/content/[id]/posts', () => {
  const call = (body: unknown, token: string | null = ownerToken, id = contentId) =>
    contentPostsRoute.POST(req(`/api/marketing/content/${id}/posts`, token, 'POST', body), { params: Promise.resolve({ id: String(id) }) })

  test('adds draft posts for new channels and skips ones already there', async () => {
    const res = await call({ channels: ['WHATSAPP_STATUS', 'INSTAGRAM'] })
    assert.strictEqual(res.status, 201)
    const { posts } = (await res.json()) as { posts: { channelKind: string; status: string; trackingTag: string }[] }
    assert.deepStrictEqual(posts.map((p) => [p.channelKind, p.status]), [['INSTAGRAM', 'DRAFT']])
    assert.match(posts[0].trackingTag, /^mk[a-z0-9]+$/)
    const again = (await (await call({ channels: ['INSTAGRAM'] })).json()) as { posts: unknown[] }
    assert.strictEqual(again.posts.length, 0)
    assert.strictEqual(await prisma.marketingPost.count({ where: { contentId } }), 2)
  })
  test('refuses an empty list, an unknown channel and staff', async () => {
    assert.strictEqual((await call({ channels: [] })).status, 400)
    assert.strictEqual((await call({ channels: ['MYSPACE'] })).status, 400)
    assert.strictEqual((await call({ channels: ['X'] }, staffToken)).status, 403)
    assert.strictEqual((await call({ channels: ['X'] }, null)).status, 401)
  })
  test('answers 404 for missing content', async () => {
    assert.strictEqual((await call({ channels: ['X'] }, ownerToken, 2147483000)).status, 404)
  })
})
