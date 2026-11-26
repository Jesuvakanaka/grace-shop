// ZP-1200: AI drafting, suggestions and planning API/lib against DATABASE_URL, with a fake writer.
// Only touches rows it creates (product "ZP1200AI-*", content titled "ZP1200AI ...", audit rows of its own actor).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { createContent } from '../src/lib/marketing/content'
import { transitionPost } from '../src/lib/marketing/posts'
import { draftContentPosts } from '../src/lib/marketing/ai/draft'
import { draftPosts, type DraftInput } from '../src/lib/marketing/ai/writer'
import { WebsiteError } from '../src/lib/website/http'
import * as draftRoute from '../src/app/api/marketing/content/[id]/draft/route'
import * as suggestionsRoute from '../src/app/api/marketing/suggestions/route'
import * as planRoute from '../src/app/api/marketing/plan/route'
import * as applyRoute from '../src/app/api/marketing/plan/apply/route'
import { createToken } from '../src/lib/auth'

const owner = { username: 'zp1200ai-owner', role: 'OWNER' as const }
let ownerToken = ''
let staffToken = ''
let productId = 0
const contentIds: number[] = []
const savedEnv = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY, hub: process.env.GRACE_MARKETING_HUB }

const req = (url: string, method = 'GET', body?: unknown, token = ownerToken) =>
  new Request(`http://localhost${url}`, { method, headers: { cookie: `auth-token=${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })

before(async () => {
  ownerToken = await createToken(900201, owner.username, 'OWNER')
  staffToken = await createToken(900202, 'zp1200ai-staff', 'STAFF')
  const p = await prisma.product.create({
    data: { itemNumber: `ZP1200AI-${Date.now()}`, productName: 'ZP1200AI Dress', slug: `zp1200ai-dress-${Date.now()}`, sellingPriceUsd: 45, priceDisplay: 'SHOW_PRICE', sizes: '4-8 years', published: true },
  })
  productId = p.id
})

after(async () => {
  await prisma.marketingContent.deleteMany({ where: { id: { in: contentIds } } })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: owner.username } })
  await prisma.product.deleteMany({ where: { id: productId } })
  for (const [k, v] of [['ANTHROPIC_API_KEY', savedEnv.a], ['OPENAI_API_KEY', savedEnv.o], ['GRACE_MARKETING_HUB', savedEnv.hub]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await prisma.$disconnect()
})

async function makeContent(channels: string[]) {
  const c = await createContent(prisma, { title: 'ZP1200AI idea', brief: 'New pink dress', productId, channels }, owner.username)
  contentIds.push(c.id)
  return c
}

// A fake model: one line per channel, with placeholders.
const fakeWrite = async (input: DraftInput) =>
  draftPosts(input, {
    client: {
      messages: {
        create: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({ posts: input.channels.map((c) => ({ channel: c, text: 'Our new pink dress. Now {price}. Sizes: {sizes}.', headline: 'New in', description: 'Order today', subject: 'New in', hashtags: [] })) }) }],
          usage: { input_tokens: 1000, output_tokens: 500 },
        }),
      },
    } as never,
  })

describe('draftContentPosts', () => {
  test('writes DRAFT posts, fills price and sizes from the product, flags aiGenerated, adds cost, audits', async () => {
    const c = await makeContent(['FACEBOOK_PAGE', 'THREADS'])
    const out = await draftContentPosts(prisma, c.id, { actor: owner.username, write: fakeWrite })
    assert.strictEqual(out.posts.length, 2)
    assert.strictEqual(out.costCents, 2)
    assert.strictEqual(out.posts.reduce((n, p) => n + p.aiCostCents, 0), 2)
    for (const p of out.posts) {
      assert.ok(p.aiGenerated)
      assert.match(p.text, /Our new pink dress\. Now \$45\. Sizes: 4-8 years\./)
      if (p.link) assert.ok(p.text.includes(p.link), 'tracking link added')
      assert.strictEqual(p.status, 'DRAFT')
      const log = await prisma.marketingAuditLog.findMany({ where: { entity: 'post', entityId: p.id, action: 'post.ai_draft' } })
      assert.strictEqual(log.length, 1)
    }
  })

  test('price stays hidden when the product asks for the price to be hidden', async () => {
    await prisma.product.update({ where: { id: productId }, data: { priceDisplay: 'ASK_FOR_PRICE' } })
    try {
      const c = await makeContent(['TELEGRAM'])
      const out = await draftContentPosts(prisma, c.id, { actor: owner.username, write: fakeWrite })
      assert.strictEqual(out.posts[0].text.split('\n\n')[0], 'Our new pink dress. Sizes: 4-8 years.')
      assert.ok(!out.posts[0].text.includes('$'))
      assert.ok(!out.posts[0].text.includes('{'))
    } finally {
      await prisma.product.update({ where: { id: productId }, data: { priceDisplay: 'SHOW_PRICE' } })
    }
  })

  test('a REJECTED post goes back to DRAFT; a post past DRAFT/REJECTED answers 409', async () => {
    const c = await makeContent(['TELEGRAM', 'FACEBOOK_PAGE'])
    const [tg, fb] = c.posts!
    await transitionPost(prisma, tg.id, 'submit', owner)
    await transitionPost(prisma, tg.id, 'reject', owner)
    await transitionPost(prisma, fb.id, 'submit', owner)
    await assert.rejects(draftContentPosts(prisma, c.id, { channels: ['FACEBOOK_PAGE'], actor: owner.username, write: fakeWrite }), (e) => e instanceof WebsiteError && e.status === 409)
    const out = await draftContentPosts(prisma, c.id, { actor: owner.username, write: fakeWrite })
    assert.deepStrictEqual(out.posts.map((p) => p.id), [tg.id]) // only the rejected one; the waiting post is untouched
    assert.strictEqual(out.posts[0].status, 'DRAFT')
    assert.strictEqual((await prisma.marketingPost.findUniqueOrThrow({ where: { id: fb.id } })).status, 'PENDING_APPROVAL')
  })

  test('failed channels are reported, not saved', async () => {
    const c = await makeContent(['TELEGRAM'])
    const bad = async (i: DraftInput) => ({ drafts: [], failures: [{ channel: i.channels[0], reason: 'The AI wrote no text.' }], costCents: 1, writer: 'claude' as const })
    const out = await draftContentPosts(prisma, c.id, { actor: owner.username, write: bad })
    assert.strictEqual(out.posts.length, 0)
    assert.strictEqual(out.failed[0].reason, 'The AI wrote no text.')
    assert.strictEqual((await prisma.marketingPost.findUniqueOrThrow({ where: { id: c.posts![0].id } })).aiGenerated, false)
  })
})

describe('draft route', () => {
  test('auth, kill switch, 404, 400, 409 and 503', async () => {
    const c = await makeContent(['TELEGRAM'])
    assert.strictEqual((await draftRoute.POST(req(`/x`, 'POST', {}, staffToken), ctx(c.id))).status, 403)
    assert.strictEqual((await draftRoute.POST(new Request('http://localhost/x', { method: 'POST' }), ctx(c.id))).status, 401)
    process.env.GRACE_MARKETING_HUB = 'false'
    assert.strictEqual((await draftRoute.POST(req('/x', 'POST', {}), ctx(c.id))).status, 404)
    delete process.env.GRACE_MARKETING_HUB

    assert.strictEqual((await draftRoute.POST(req('/x', 'POST', {}), ctx(987654321))).status, 404)
    assert.strictEqual((await draftRoute.POST(req('/x', 'POST', { channels: 'TELEGRAM' }), ctx(c.id))).status, 400)
    assert.strictEqual((await draftRoute.POST(req('/x', 'POST', { channels: ['X'] }), ctx(c.id))).status, 400) // no X post on this idea

    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    const none = await draftRoute.POST(req('/x', 'POST', {}), ctx(c.id))
    assert.strictEqual(none.status, 503)
    assert.match((await none.json()).error, /not set up/)

    await transitionPost(prisma, c.posts![0].id, 'submit', owner)
    const past = await draftRoute.POST(req('/x', 'POST', { channels: ['TELEGRAM'] }), ctx(c.id))
    assert.strictEqual(past.status, 409)
    const nothing = await draftRoute.POST(req('/x', 'POST', {}), ctx(c.id))
    assert.strictEqual(nothing.status, 409)
  })
})

describe('suggestions and plan routes', () => {
  test('GET suggestions is owner only and returns a list', async () => {
    assert.strictEqual((await suggestionsRoute.GET(req('/x', 'GET', undefined, staffToken))).status, 403)
    const res = await suggestionsRoute.GET(req('/api/marketing/suggestions?limit=3'))
    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body.suggestions) && body.suggestions.length <= 3)
    process.env.GRACE_MARKETING_HUB = 'false'
    assert.strictEqual((await suggestionsRoute.GET(req('/x'))).status, 404)
    delete process.env.GRACE_MARKETING_HUB
  })

  test('plan proposes without saving; apply schedules API posts and only suggests for manual ones', async () => {
    const c = await makeContent(['TELEGRAM', 'WHATSAPP_STATUS'])
    const [tg, wa] = c.posts!
    for (const p of [tg, wa]) {
      await transitionPost(prisma, p.id, 'submit', owner)
      await transitionPost(prisma, p.id, 'approve', owner)
    }
    assert.strictEqual((await planRoute.POST(req('/x', 'POST', {}))).status, 400)
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString()
    const res = await planRoute.POST(req('/x', 'POST', { start }))
    assert.strictEqual(res.status, 200)
    const { plan } = await res.json()
    const mine = plan.items.filter((i: { postId: number }) => [tg.id, wa.id].includes(i.postId))
    // The planner never saves anything.
    assert.strictEqual((await prisma.marketingPost.findUniqueOrThrow({ where: { id: tg.id } })).scheduledFor, null)
    // Items are only proposed for posts that fit the weekly target; make our own when the DB has others.
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const items = [{ postId: tg.id, scheduledFor: when }, { postId: wa.id, scheduledFor: when }, { postId: 987654321, scheduledFor: when }]
    assert.ok(mine.length <= 2)
    const applied = await applyRoute.POST(req('/x', 'POST', { items }))
    assert.strictEqual(applied.status, 200)
    const results = (await applied.json()).results
    assert.deepStrictEqual(results.map((r: { result: string }) => r.result), ['scheduled', 'suggested', 'failed'])
    const tgRow = await prisma.marketingPost.findUniqueOrThrow({ where: { id: tg.id } })
    assert.strictEqual(tgRow.status, 'SCHEDULED')
    assert.strictEqual(tgRow.scheduledFor?.toISOString(), when)
    const waRow = await prisma.marketingPost.findUniqueOrThrow({ where: { id: wa.id } })
    assert.strictEqual(waRow.status, 'APPROVED')
    assert.strictEqual(waRow.scheduledFor, null)
    // Applying again fails per item (already scheduled) without breaking the request.
    const again = await applyRoute.POST(req('/x', 'POST', { items: [{ postId: tg.id, scheduledFor: when }] }))
    assert.strictEqual((await again.json()).results[0].result, 'failed')
    // Bad input.
    assert.strictEqual((await applyRoute.POST(req('/x', 'POST', { items: [] }))).status, 400)
    assert.strictEqual((await applyRoute.POST(req('/x', 'POST', { items: [{ postId: tg.id }] }))).status, 400)
    assert.strictEqual((await applyRoute.POST(req('/x', 'POST', { items }, staffToken))).status, 403)
  })
})
