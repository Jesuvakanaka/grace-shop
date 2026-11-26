// ZP-1200: weekly recommendations: facts and rule text (pure), AI wording with a fake client, the database flow and APIs.
// Only touches rows it creates (ZP1200REC-*). No real AI call: every AI key is removed for the run.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'
const savedKeys = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY }
delete process.env.ANTHROPIC_API_KEY
delete process.env.OPENAI_API_KEY

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import {
  aiAvailable, computeFacts, generateRecommendations, inventsNumbers, listRecommendations, mergeAiWording, ruleRecommendations,
  setRecommendationStatus, weekOf, type FactsInput,
} from '../src/lib/marketing/ai/recommend'
import { WebsiteError } from '../src/lib/website/http'
import * as recsRoute from '../src/app/api/marketing/recommendations/route'
import * as generateRoute from '../src/app/api/marketing/recommendations/generate/route'
import * as byIdRoute from '../src/app/api/marketing/recommendations/[id]/route'

const NOW = new Date('2026-11-26T10:00:00Z') // a Thursday
const at = (iso: string) => new Date(iso)

const base = (over: Partial<FactsInput> = {}): FactsInput => ({
  from: '2026-10-30', to: '2026-11-26', now: NOW,
  posts: [
    { postId: 1, title: 'Rose dress', channelKind: 'INSTAGRAM', productId: 10, productName: 'Rose Dress', publishedAt: at('2026-11-21T17:00:00Z'), visits: 30, enquiries: 4 }, // Sat 19:00 Harare
    { postId: 2, title: 'Rose dress', channelKind: 'FACEBOOK_PAGE', productId: 10, productName: 'Rose Dress', publishedAt: at('2026-11-14T17:30:00Z'), visits: 10, enquiries: 1 }, // Sat 19:30
    { postId: 3, title: 'Blue shirt', channelKind: 'FACEBOOK_PAGE', productId: 11, productName: 'Blue Shirt', publishedAt: at('2026-11-18T06:00:00Z'), visits: 5, enquiries: 0 }, // Wed 08:00
    { postId: 4, title: 'Green hat', channelKind: 'INSTAGRAM', productId: 12, productName: 'Green Hat', publishedAt: at('2026-11-17T06:00:00Z'), visits: 0, enquiries: 0 },
    { postId: 5, title: 'Today post', channelKind: 'INSTAGRAM', productId: 12, productName: 'Green Hat', publishedAt: at('2026-11-26T07:00:00Z'), visits: 0, enquiries: 0 },
  ],
  channels: [{ kind: 'INSTAGRAM', postsInWindow: 3 }, { kind: 'FACEBOOK_PAGE', postsInWindow: 2 }, { kind: 'THREADS', postsInWindow: 0 }],
  budget: { month: '2026-11', capCents: 5000, committedCents: 3250, remainingCents: 1750 },
  ...over,
})

describe('computeFacts', () => {
  const f = computeFacts(base())
  test('best channel and product by visits', () => {
    assert.deepStrictEqual([f.bestChannel?.kind, f.bestChannel?.visits, f.bestChannel?.enquiries, f.bestChannel?.posts], ['INSTAGRAM', 30, 4, 3])
    assert.deepStrictEqual([f.bestProduct?.name, f.bestProduct?.visits, f.bestProduct?.enquiries], ['Rose Dress', 40, 5])
  })
  test('best day and hour in Harare time, averaged per post', () => {
    assert.deepStrictEqual([f.bestDay?.day, f.bestDay?.avgVisits, f.bestDay?.posts], ['Saturday', 20, 2])
    assert.deepStrictEqual([f.bestHour?.hour, f.bestHour?.avgVisits, f.bestHour?.posts], [19, 20, 2])
  })
  test('posts with no visits ignore posts under two days old', () => {
    assert.strictEqual(f.postsWithNoVisits.count, 1)
    assert.strictEqual(f.postsWithNoVisits.examples[0].postId, 4)
  })
  test('unused connected channels and budget left', () => {
    assert.deepStrictEqual(f.unusedChannels.map((c) => c.kind), ['THREADS'])
    assert.deepStrictEqual(f.budget, { month: '2026-11', capCents: 5000, remainingCents: 1750 })
  })
  test('too few posts means no best day or hour, and no visits means no best channel', () => {
    const few = computeFacts(base({ posts: base().posts.slice(0, 2) }))
    assert.deepStrictEqual([few.bestDay, few.bestHour], [null, null])
    const none = computeFacts(base({ posts: base().posts.map((p) => ({ ...p, visits: 0, enquiries: 0 })) }))
    assert.deepStrictEqual([none.bestChannel, none.bestProduct, none.bestDay], [null, null, null])
  })
  test('no posts at all', () => {
    const e = computeFacts(base({ posts: [], channels: [] }))
    assert.strictEqual(e.postCount, 0)
    assert.deepStrictEqual(ruleRecommendations(e).map((r) => r.kind), ['no_data', 'budget_left'])
  })
})

describe('ruleRecommendations', () => {
  const recs = ruleRecommendations(computeFacts(base()))
  test('one plain item per fact, numbers straight from the facts', () => {
    assert.deepStrictEqual(recs.map((r) => r.kind), ['best_channel', 'best_product', 'best_time', 'no_visits', 'unused_channels', 'budget_left'])
    const ch = recs.find((r) => r.kind === 'best_channel')!
    assert.match(ch.body, /30 visits and 4 enquiries from 3 posts/)
    assert.match(recs.find((r) => r.kind === 'budget_left')!.title, /^\$17\.50 of ad budget left/)
    assert.match(recs.find((r) => r.kind === 'best_time')!.body, /Saturdays \(20 visits per post\).*19:00/)
  })
  test('singular wording and a zero budget cap', () => {
    const r = ruleRecommendations(computeFacts(base({ budget: { month: '2026-11', capCents: 0, committedCents: 0, remainingCents: 0 } })))
    assert.match(r.find((x) => x.kind === 'budget_left')!.title, /No ad budget set/)
  })
})

describe('AI wording never invents numbers', () => {
  const rules = ruleRecommendations(computeFacts(base()))
  test('inventsNumbers', () => {
    const rule = { title: 'Instagram is best', body: 'It sent 30 visits.' }
    assert.strictEqual(inventsNumbers({ title: 'Instagram wins', body: 'Thirty... 30 visits came.' }, rule), false)
    assert.strictEqual(inventsNumbers({ title: 'Instagram wins', body: 'About 35 visits came.' }, rule), true)
    assert.strictEqual(inventsNumbers({ title: 'x', body: 'That is 50% more.' }, rule), true)
  })
  test('good rewording is used, an invented number keeps the rule text, unknown kinds are ignored', () => {
    const json = { items: [
      { kind: 'best_channel', title: 'Instagram is your star', body: 'It sent 30 visits and 4 enquiries from 3 posts. Start there.' },
      { kind: 'best_product', title: 'Rose Dress is a winner', body: 'It brought about 45 visits.' },
      { kind: 'made_up', title: 'Hello', body: 'World' },
    ] }
    const { recs, reworded } = mergeAiWording(rules, json)
    assert.strictEqual(reworded, 1)
    assert.strictEqual(recs.find((r) => r.kind === 'best_channel')!.title, 'Instagram is your star')
    assert.deepStrictEqual(recs.find((r) => r.kind === 'best_product'), rules.find((r) => r.kind === 'best_product'))
    assert.strictEqual(recs.length, rules.length)
  })
  test('a reply in the wrong shape throws', () => {
    assert.throws(() => mergeAiWording(rules, { nope: 1 }))
  })
  test('aiAvailable is false without keys and true with an injected client', () => {
    assert.strictEqual(aiAvailable({}), false)
    assert.strictEqual(aiAvailable({ client: {} as never }), true)
  })
})

describe('weekOf', () => {
  test('is the Monday of the Harare week', () => {
    assert.strictEqual(weekOf(NOW).toISOString().slice(0, 10), '2026-11-23')
    assert.strictEqual(weekOf(new Date('2026-11-22T23:00:00Z')).toISOString().slice(0, 10), '2026-11-23') // Sunday 23:00 UTC is Monday 01:00 Harare
    assert.strictEqual(weekOf(new Date('2026-11-22T21:00:00Z')).toISOString().slice(0, 10), '2026-11-16')
  })
})

// ───────────────────────── database ─────────────────────────

const stamp = Date.now()
let ownerToken = ''
let staffToken = ''
let productId = 0
let contentId = 0
let channelId = 0
const postIds: number[] = []
const req = (url: string, token: string | null, method = 'GET', body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { ...(token ? { cookie: `auth-token=${token}` } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })

function fakeClaude(reply: unknown, calls: unknown[] = []) {
  return {
    messages: {
      create: async (args: unknown) => {
        calls.push(args)
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) }], usage: { input_tokens: 1000, output_tokens: 500 } }
      },
    },
  } as never
}

describe('generateRecommendations (database)', () => {
  before(async () => {
    ownerToken = await createToken(900320, 'zp1200-rec-owner', 'OWNER')
    staffToken = await createToken(900321, 'zp1200-rec-staff', 'STAFF')
    productId = (await prisma.product.create({ data: { itemNumber: `ZP1200REC-${stamp}`, productName: 'ZP1200REC Rose Dress', slug: `zp1200rec-${stamp}`, published: true } })).id
    contentId = (await prisma.marketingContent.create({ data: { title: 'ZP1200REC idea', productId, imageKeys: [], createdBy: 'x' } })).id
    channelId = (await prisma.marketingChannel.create({ data: { kind: 'THREADS', name: 'ZP1200REC threads', status: 'CONNECTED', credentialsEnc: 'x' } })).id
    const p = await prisma.marketingPost.create({ data: { contentId, channelKind: 'INSTAGRAM', format: 'POST', text: 'ZP1200REC', imageKeys: [], trackingTag: `mkzp1200rec${stamp}`.slice(0, 36), status: 'PUBLISHED', createdBy: 'x', publishedAt: at('2026-11-20T10:00:00Z') } })
    postIds.push(p.id)
    await prisma.marketingMetric.create({ data: { entity: 'POST', entityId: p.id, day: new Date('2026-11-21T00:00:00Z'), visits: 12, enquiries: 2 } })
  })
  after(async () => {
    await prisma.marketingRecommendation.deleteMany({})
    await prisma.marketingMetric.deleteMany({ where: { entity: 'POST', entityId: { in: postIds } } })
    await prisma.marketingContent.deleteMany({ where: { id: contentId } })
    await prisma.marketingChannel.deleteMany({ where: { id: channelId } })
    await prisma.product.deleteMany({ where: { id: productId } })
    await prisma.marketingAuditLog.deleteMany({ where: { actor: { in: ['zp1200-rec-owner', 'zp1200-rec-staff'] } } })
  })

  test('works with no AI: rule text is saved, costs nothing, and the unused connected channel is found', async () => {
    const r = await generateRecommendations(prisma, 'zp1200-rec-owner', { now: NOW })
    assert.deepStrictEqual([r.usedAi, r.costCents, r.aiError, r.weekOf], [false, 0, null, '2026-11-23'])
    const kinds = r.recommendations.map((x) => x.kind)
    for (const k of ['best_channel', 'best_product', 'unused_channels', 'budget_left']) assert.ok(kinds.includes(k), k)
    const ch = r.recommendations.find((x) => x.kind === 'best_channel')!
    assert.match(ch.body, /Instagram/)
    assert.match(ch.body, /12 visits and 2 enquiries/)
    assert.strictEqual(ch.status, 'NEW')
    const audit = await prisma.marketingAuditLog.findFirst({ where: { action: 'recommendations.generate', actor: 'zp1200-rec-owner' } })
    assert.ok(audit)
  })

  test('with a fake AI the wording is used, the cost is recorded, and invented numbers are refused', async () => {
    const calls: unknown[] = []
    const reply = { items: [
      { kind: 'best_channel', title: 'Instagram is your star', body: 'It sent 12 visits and 2 enquiries from 1 post.' },
      { kind: 'best_product', title: 'Rose Dress sells itself', body: 'It brought 99 visits.' },
    ] }
    const r = await generateRecommendations(prisma, 'zp1200-rec-owner', { now: NOW, ai: { client: fakeClaude(reply, calls) } })
    assert.strictEqual(r.usedAi, true)
    assert.ok(r.costCents > 0)
    assert.strictEqual(r.recommendations.find((x) => x.kind === 'best_channel')!.title, 'Instagram is your star')
    assert.doesNotMatch(r.recommendations.find((x) => x.kind === 'best_product')!.body, /99/)
    assert.strictEqual(r.recommendations.reduce((s, x) => s + x.aiCostCents, 0), r.costCents)
    // The prompt carries only numbers the code worked out.
    assert.strictEqual(calls.length, 1)
    assert.match(JSON.stringify(calls[0]), /12 visits and 2 enquiries/)
    // Re-running replaced the week's NEW items instead of piling up.
    assert.strictEqual((await listRecommendations(prisma, { weekOf: weekOf(NOW) })).filter((x) => x.kind === 'best_channel').length, 1)
  })

  test('an AI that fails or returns junk falls back to the rule text and says why', async () => {
    const boom = { messages: { create: async () => { throw new Error('model down') } } } as never
    const a = await generateRecommendations(prisma, 'zp1200-rec-owner', { now: NOW, ai: { client: boom } })
    assert.deepStrictEqual([a.usedAi, a.aiError], [false, 'model down'])
    assert.ok(a.recommendations.length > 0)
    const b = await generateRecommendations(prisma, 'zp1200-rec-owner', { now: NOW, ai: { client: fakeClaude('not json') } })
    assert.strictEqual(b.usedAi, false)
    assert.match(b.aiError ?? '', /not valid JSON/)
    assert.match(b.recommendations.find((x) => x.kind === 'best_channel')!.body, /12 visits/)
  })

  test('done and dismissed items are kept and not repeated; every change is audited', async () => {
    const list = await listRecommendations(prisma, { weekOf: weekOf(NOW), status: 'NEW' })
    const first = list.find((x) => x.kind === 'best_channel')!
    const done = await setRecommendationStatus(prisma, first.id, 'DONE', { username: 'zp1200-rec-owner', role: 'OWNER' })
    assert.strictEqual(done.status, 'DONE')
    const dismissed = await setRecommendationStatus(prisma, list.find((x) => x.kind === 'budget_left')!.id, 'DISMISSED', 'zp1200-rec-owner')
    assert.strictEqual(dismissed.status, 'DISMISSED')
    const audits = await prisma.marketingAuditLog.findMany({ where: { action: 'recommendation.status', entityId: { in: [first.id, dismissed.id] } } })
    assert.deepStrictEqual(audits.map((a) => (a.detail as { to: string }).to).sort(), ['DISMISSED', 'DONE'])
    assert.deepStrictEqual((audits.find((a) => a.entityId === first.id)!.detail as { from: string }).from, 'NEW')
    await generateRecommendations(prisma, 'zp1200-rec-owner', { now: NOW })
    const all = await listRecommendations(prisma, { weekOf: weekOf(NOW) })
    assert.strictEqual(all.filter((x) => x.kind === 'best_channel').length, 1)
    assert.strictEqual(all.find((x) => x.kind === 'best_channel')!.status, 'DONE')
    assert.strictEqual(all.filter((x) => x.kind === 'budget_left').length, 1)
    // Same status again writes nothing new.
    const before = await prisma.marketingAuditLog.count({ where: { action: 'recommendation.status', entityId: first.id } })
    await setRecommendationStatus(prisma, first.id, 'DONE', 'zp1200-rec-owner')
    assert.strictEqual(await prisma.marketingAuditLog.count({ where: { action: 'recommendation.status', entityId: first.id } }), before)
  })

  test('bad status and missing advice are refused', async () => {
    await assert.rejects(() => setRecommendationStatus(prisma, 1, 'MAYBE', 'x'), (e: unknown) => e instanceof WebsiteError && e.status === 400)
    await assert.rejects(() => setRecommendationStatus(prisma, 987654321, 'DONE', 'x'), (e: unknown) => e instanceof WebsiteError && e.status === 404)
  })
})

after(async () => {
  await prisma.marketingRecommendation.deleteMany({})
  await prisma.marketingAuditLog.deleteMany({ where: { action: { in: ['recommendations.generate', 'recommendation.status'] } } })
  if (savedKeys.a !== undefined) process.env.ANTHROPIC_API_KEY = savedKeys.a
  if (savedKeys.o !== undefined) process.env.OPENAI_API_KEY = savedKeys.o
  await prisma.$disconnect()
})

describe('recommendation APIs', () => {
  test('POST generate is owner only and works with no AI key', async () => {
    assert.strictEqual((await generateRoute.POST(req('/api/marketing/recommendations/generate', staffToken, 'POST'))).status, 403)
    assert.strictEqual((await generateRoute.POST(req('/api/marketing/recommendations/generate', null, 'POST'))).status, 401)
    const ok = await generateRoute.POST(req('/api/marketing/recommendations/generate', ownerToken, 'POST'))
    assert.strictEqual(ok.status, 201)
    const body = (await ok.json()) as { result: { usedAi: boolean; recommendations: { id: number; status: string }[] } }
    assert.strictEqual(body.result.usedAi, false)
    assert.ok(body.result.recommendations.length > 0)
  })

  test('GET lists, filters by status, rejects bad filters, owner only', async () => {
    const ok = await recsRoute.GET(req('/api/marketing/recommendations?status=NEW', ownerToken))
    assert.strictEqual(ok.status, 200)
    const body = (await ok.json()) as { recommendations: { status: string }[] }
    assert.ok(body.recommendations.length > 0)
    assert.ok(body.recommendations.every((r) => r.status === 'NEW'))
    assert.strictEqual((await recsRoute.GET(req('/api/marketing/recommendations?status=NOPE', ownerToken))).status, 400)
    assert.strictEqual((await recsRoute.GET(req('/api/marketing/recommendations?week=2026-02-31', ownerToken))).status, 400)
    assert.strictEqual((await recsRoute.GET(req('/api/marketing/recommendations', staffToken))).status, 403)
  })

  test('PATCH sets the status; bad body 400; unknown 404; staff 403', async () => {
    const list = (await (await recsRoute.GET(req('/api/marketing/recommendations?status=NEW', ownerToken))).json()) as { recommendations: { id: number }[] }
    const id = list.recommendations[0].id
    const ctx = (i: number | string) => ({ params: Promise.resolve({ id: String(i) }) })
    const ok = await byIdRoute.PATCH(req(`/api/marketing/recommendations/${id}`, ownerToken, 'PATCH', { status: 'DISMISSED' }), ctx(id))
    assert.strictEqual(ok.status, 200)
    assert.strictEqual(((await ok.json()) as { recommendation: { status: string } }).recommendation.status, 'DISMISSED')
    assert.strictEqual((await byIdRoute.PATCH(req(`/api/marketing/recommendations/${id}`, ownerToken, 'PATCH', { status: 'X' }), ctx(id))).status, 400)
    assert.strictEqual((await byIdRoute.PATCH(req(`/api/marketing/recommendations/${id}`, ownerToken, 'PATCH', { status: 'DONE', title: 'hack' }), ctx(id))).status, 400)
    assert.strictEqual((await byIdRoute.PATCH(req('/api/marketing/recommendations/987654321', ownerToken, 'PATCH', { status: 'DONE' }), ctx(987654321))).status, 404)
    assert.strictEqual((await byIdRoute.PATCH(req(`/api/marketing/recommendations/${id}`, staffToken, 'PATCH', { status: 'DONE' }), ctx(id))).status, 403)
  })
})
