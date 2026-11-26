// ZP-1200: marketing hub against DATABASE_URL. Only touches rows it creates
// (product "ZP1200-*", campaign/content names "ZP1200 ...", its own channel rows and audit rows by entity id).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { getSettings, updateSettings } from '../src/lib/marketing/settings'
import { createCampaign, deleteCampaign, getCampaign, listCampaigns, updateCampaign } from '../src/lib/marketing/campaigns'
import { createContent, deleteContent, getContent, listContent, updateContent } from '../src/lib/marketing/content'
import { getPost, listPosts, transitionPost, updatePost } from '../src/lib/marketing/posts'
import { listChannels } from '../src/lib/marketing/channel-rows'
import { encryptSecret } from '../src/lib/marketing/secrets'
import { assertCanGoLive } from '../src/lib/marketing/flags'
import { WebsiteError } from '../src/lib/website/http'
import * as channelsRoute from '../src/app/api/marketing/channels/route'
import * as transitionRoute from '../src/app/api/marketing/posts/[id]/transition/route'
import * as settingsRoute from '../src/app/api/marketing/settings/route'
import * as postsRoute from '../src/app/api/marketing/posts/route'
import { createToken } from '../src/lib/auth'

const owner = { username: 'zp1200-owner', role: 'OWNER' as const }
const staff = { username: 'zp1200-staff', role: 'STAFF' as const }
let productId = 0
let ownerToken = ''
const campaignIds: number[] = []
const contentIds: number[] = []
const channelIds: number[] = []
let savedSettings: { liveEnabled: boolean; monthlySpendCapCents: number; metaPixelId: string | null; weeklyPostTarget: number; brandVoice: string | null; productFeedEnabled: boolean } | null = null
const savedEnv = process.env.GRACE_MARKETING_LIVE
const savedHub = process.env.GRACE_MARKETING_HUB

const rejects = async (fn: () => Promise<unknown>, status: number, re?: RegExp) => {
  await assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))
}

before(async () => {
  const s = await getSettings(prisma)
  savedSettings = { liveEnabled: s.liveEnabled, monthlySpendCapCents: s.monthlySpendCapCents, metaPixelId: s.metaPixelId, weeklyPostTarget: s.weeklyPostTarget, brandVoice: s.brandVoice, productFeedEnabled: s.productFeedEnabled }
  const p = await prisma.product.create({ data: { itemNumber: `ZP1200-${Date.now()}`, productName: 'ZP1200 Pink Dress', slug: `zp1200-pink-dress-${Date.now()}` } })
  productId = p.id
  ownerToken = await createToken(900200, owner.username, 'OWNER')
})

after(async () => {
  for (const id of contentIds) await prisma.marketingContent.deleteMany({ where: { id } })
  for (const id of campaignIds) await prisma.marketingCampaign.deleteMany({ where: { id } })
  if (channelIds.length) await prisma.marketingChannel.deleteMany({ where: { id: { in: channelIds } } })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: { in: [owner.username, staff.username] } } })
  await prisma.product.deleteMany({ where: { id: productId } })
  if (savedSettings) await prisma.marketingSettings.update({ where: { id: 1 }, data: savedSettings })
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
  if (savedHub === undefined) delete process.env.GRACE_MARKETING_HUB
  else process.env.GRACE_MARKETING_HUB = savedHub
  await prisma.$disconnect()
})

const audit = (entity: string, id: number) => prisma.marketingAuditLog.findMany({ where: { entity, entityId: id }, orderBy: { id: 'asc' } })

describe('settings', () => {
  test('singleton with safe defaults is created once', async () => {
    await prisma.marketingSettings.deleteMany({})
    const a = await getSettings(prisma)
    const b = await getSettings(prisma)
    assert.strictEqual(a.id, 1)
    assert.strictEqual(b.id, 1)
    assert.strictEqual(a.liveEnabled, false)
    assert.strictEqual(a.monthlySpendCapCents, 0)
    assert.strictEqual(await prisma.marketingSettings.count(), 1)
  })
  test('validated update, audited, with unknown or bad fields refused', async () => {
    const s = await updateSettings(prisma, { weeklyPostTarget: 5, brandVoice: ' warm and simple ', metaPixelId: '123456789' }, owner.username)
    assert.deepStrictEqual([s.weeklyPostTarget, s.brandVoice, s.metaPixelId, s.updatedBy], [5, 'warm and simple', '123456789', owner.username])
    const log = await audit('settings', 1)
    assert.ok(log.some((l) => l.actor === owner.username && l.action === 'settings.update'))
    await rejects(() => updateSettings(prisma, { weeklyPostTarget: -1 }, owner.username), 400)
    await rejects(() => updateSettings(prisma, { liveEnabled: 'yes' }, owner.username), 400)
    await rejects(() => updateSettings(prisma, { metaPixelId: 'abc' }, owner.username), 400)
    await rejects(() => updateSettings(prisma, { secret: 1 }, owner.username), 400, /Unknown/)
    await rejects(() => updateSettings(prisma, {}, owner.username), 400)
    await rejects(() => updateSettings(prisma, null, owner.username), 400)
  })
})

describe('campaigns and content', () => {
  test('campaign CRUD with products and audit', async () => {
    const c = await createCampaign(prisma, { name: 'ZP1200 Easter', objective: 'VISITS', productIds: [productId], budgetCents: 5000 }, owner.username)
    campaignIds.push(c.id)
    assert.deepStrictEqual([c.status, c.objective, c.productIds], ['DRAFT', 'VISITS', [productId]])
    const u = await updateCampaign(prisma, c.id, { status: 'ACTIVE', productIds: [] }, owner.username)
    assert.deepStrictEqual([u.status, u.productIds], ['ACTIVE', []])
    assert.ok((await listCampaigns(prisma, 'ACTIVE')).some((x) => x.id === c.id))
    await rejects(() => createCampaign(prisma, { name: '' }, owner.username), 400)
    await rejects(() => createCampaign(prisma, { name: 'x', objective: 'FAME' }, owner.username), 400)
    await rejects(() => createCampaign(prisma, { name: 'x', productIds: [2147483000] }, owner.username), 400)
    await rejects(() => createCampaign(prisma, { name: 'x', startsAt: '2026-12-02', endsAt: '2026-12-01' }, owner.username), 400)
    await rejects(() => updateCampaign(prisma, 2147483000, { name: 'x' }, owner.username), 404)
    const actions = (await audit('campaign', c.id)).map((l) => l.action)
    assert.deepStrictEqual(actions, ['campaign.create', 'campaign.active'])
  })

  test('content with one draft post per channel, tracked link and product slug', async () => {
    const camp = await createCampaign(prisma, { name: 'ZP1200 Spring' }, owner.username)
    campaignIds.push(camp.id)
    const c = await createContent(prisma, { title: 'ZP1200 Pink dress', brief: 'New in!', productId, campaignId: camp.id, channels: ['FACEBOOK_PAGE', 'WHATSAPP_STATUS', 'X'] }, owner.username, { host: 'uat.example' })
    contentIds.push(c.id)
    assert.strictEqual(c.posts!.length, 3)
    for (const p of c.posts!) {
      assert.strictEqual(p.status, 'DRAFT')
      assert.match(p.trackingTag, /^mk[a-f0-9]{12}$/)
      assert.match(p.link!, /\/p\/zp1200-pink-dress-\d+\?src=mk/)
      assert.ok(p.link!.endsWith(`src=${p.trackingTag}`))
      assert.strictEqual(p.text, 'New in!')
    }
    assert.strictEqual(new Set(c.posts!.map((p) => p.trackingTag)).size, 3)
    assert.ok((await listContent(prisma, { campaignId: camp.id })).some((x) => x.id === c.id))
    const u = await updateContent(prisma, c.id, { title: 'ZP1200 Pink dress 2' }, owner.username)
    assert.strictEqual(u.title, 'ZP1200 Pink dress 2')
    await rejects(() => createContent(prisma, { title: 'x', channels: ['MYSPACE'] }, owner.username), 400, /Unknown channel/)
    await rejects(() => createContent(prisma, { title: 'x', productId: 2147483000 }, owner.username), 400)
    // deleting the campaign keeps the content
    await deleteCampaign(prisma, camp.id, owner.username)
    assert.strictEqual((await getContent(prisma, c.id))!.campaignId, null)
    assert.strictEqual(await getCampaign(prisma, camp.id), null)
  })

  test('content that has gone out cannot be deleted; draft content can', async () => {
    const c = await createContent(prisma, { title: 'ZP1200 shared', channels: ['WHATSAPP_STATUS'] }, owner.username)
    contentIds.push(c.id)
    const id = c.posts![0].id
    await transitionPost(prisma, id, 'submit', owner)
    await transitionPost(prisma, id, 'approve', owner)
    await transitionPost(prisma, id, 'share', owner)
    await rejects(() => deleteContent(prisma, c.id, owner.username), 409)
    const d = await createContent(prisma, { title: 'ZP1200 throwaway', channels: ['FACEBOOK_PAGE'] }, owner.username)
    await deleteContent(prisma, d.id, owner.username)
    assert.strictEqual(await prisma.marketingPost.count({ where: { contentId: d.id } }), 0)
  })
})

describe('post transitions', () => {
  async function newPost(channel: string, body: Record<string, unknown> = {}) {
    const c = await createContent(prisma, { title: 'ZP1200 piece', brief: 'Hello', channels: [channel], ...body }, owner.username)
    contentIds.push(c.id)
    return c.posts![0]
  }

  test('draft -> pending -> approved -> shared (manual), each step audited', async () => {
    const p = await newPost('WHATSAPP_STATUS')
    assert.strictEqual((await transitionPost(prisma, p.id, 'submit', owner)).status, 'PENDING_APPROVAL')
    await rejects(() => transitionPost(prisma, p.id, 'approve', staff), 409, /owner/)
    const a = await transitionPost(prisma, p.id, 'approve', owner)
    assert.deepStrictEqual([a.status, a.approvedBy], ['APPROVED', owner.username])
    assert.ok(a.approvedAt)
    const s = await transitionPost(prisma, p.id, 'share', owner)
    assert.deepStrictEqual([s.status !== undefined && s.status, !!s.publishedAt], ['SHARED', true])
    await rejects(() => transitionPost(prisma, p.id, 'cancel', owner), 409)
    const log = await audit('post', p.id)
    assert.deepStrictEqual(log.map((l) => l.action), ['post.create', 'post.submit', 'post.approve', 'post.share'])
    assert.deepStrictEqual(log[2].detail, { from: 'PENDING_APPROVAL', to: 'APPROVED', channel: 'WHATSAPP_STATUS' })
  })

  test('editing an approved post sends it back to draft and clears approval', async () => {
    const p = await newPost('FACEBOOK_PAGE')
    await transitionPost(prisma, p.id, 'submit', owner)
    await transitionPost(prisma, p.id, 'approve', owner)
    const same = await updatePost(prisma, p.id, { text: 'Hello' }, owner)
    assert.strictEqual(same.status, 'APPROVED', 'unchanged text is not an edit')
    const e = await updatePost(prisma, p.id, { text: 'Hello, changed' }, owner)
    assert.deepStrictEqual([e.status, e.approvedBy, e.approvedAt, e.text], ['DRAFT', null, null, 'Hello, changed'])
    assert.ok((await audit('post', p.id)).some((l) => l.action === 'post.edit'))
    await rejects(() => updatePost(prisma, p.id, { text: 'x'.repeat(5001) }, owner), 400, /at most 5000/)
    await rejects(() => updatePost(prisma, p.id, { format: 'PIN' }, owner), 400)
    await rejects(() => updatePost(prisma, p.id, { trackingTag: 'x' }, owner), 400, /Unknown/)
  })

  test('submit needs words and, where required, a photo', async () => {
    const p = await newPost('INSTAGRAM')
    await rejects(() => transitionPost(prisma, p.id, 'submit', owner), 409, /photo/)
    await updatePost(prisma, p.id, { imageKeys: ['products/zp1200.jpg'] }, owner)
    assert.strictEqual((await transitionPost(prisma, p.id, 'submit', owner)).status, 'PENDING_APPROVAL')
    await rejects(() => updatePost(prisma, p.id, { imageKeys: ['../etc/passwd'] }, owner), 400)
  })

  test('publishing is blocked until every go-live condition holds, then starts once', async () => {
    const p = await newPost('FACEBOOK_PAGE')
    await transitionPost(prisma, p.id, 'submit', owner)
    await transitionPost(prisma, p.id, 'approve', owner)
    // env off
    delete process.env.GRACE_MARKETING_LIVE
    await rejects(() => transitionPost(prisma, p.id, 'publish', owner), 409, /server/)
    // env on, settings off
    process.env.GRACE_MARKETING_LIVE = 'true'
    await updateSettings(prisma, { liveEnabled: false }, owner.username)
    await rejects(() => transitionPost(prisma, p.id, 'publish', owner), 409, /settings/)
    // settings on, channel missing
    await updateSettings(prisma, { liveEnabled: true }, owner.username)
    await prisma.marketingChannel.deleteMany({ where: { kind: 'FACEBOOK_PAGE', name: { startsWith: 'ZP1200' } } })
    await rejects(() => transitionPost(prisma, p.id, 'publish', owner), 409, /not connected/)
    // channel connected but no credentials
    const ch = await prisma.marketingChannel.create({ data: { kind: 'FACEBOOK_PAGE', name: 'ZP1200 page', status: 'CONNECTED' } })
    channelIds.push(ch.id)
    await prisma.marketingPost.update({ where: { id: p.id }, data: { channelId: ch.id } })
    await rejects(() => transitionPost(prisma, p.id, 'publish', owner), 409, /credentials/)
    // nothing was changed by any refusal
    assert.strictEqual((await getPost(prisma, p.id))!.status, 'APPROVED')
    assert.strictEqual((await getPost(prisma, p.id))!.attempts, 0)
    // everything in place
    await prisma.marketingChannel.update({ where: { id: ch.id }, data: { credentialsEnc: encryptSecret('{"token":"x"}') } })
    const r = await transitionPost(prisma, p.id, 'publish', owner)
    assert.deepStrictEqual([r.status, r.attempts], ['PUBLISHING', 1])
    // and an unapproved post is blocked by the same gate
    assert.throws(() => assertCanGoLive({ env: { GRACE_MARKETING_LIVE: 'true' }, settings: { liveEnabled: true }, channel: ch, post: { approvedBy: null, approvedAt: null } }), WebsiteError)
    // finish via the runner actions
    const done = await transitionPost(prisma, p.id, 'published', { username: 'runner', role: 'SYSTEM' }, { externalId: 'fb_1', externalUrl: 'https://facebook.example/1' })
    assert.deepStrictEqual([done.status, done.externalId], ['PUBLISHED', 'fb_1'])
    delete process.env.GRACE_MARKETING_LIVE
    await updateSettings(prisma, { liveEnabled: false }, owner.username)
  })

  test('scheduling and filtering for the calendar', async () => {
    const p = await newPost('FACEBOOK_PAGE')
    await transitionPost(prisma, p.id, 'submit', owner)
    await transitionPost(prisma, p.id, 'approve', owner)
    const when = new Date(Date.now() + 3 * 86400_000)
    const s = await transitionPost(prisma, p.id, 'schedule', owner, { scheduledFor: when })
    assert.strictEqual(s.status, 'SCHEDULED')
    const day = (d: Date, add: number) => new Date(d.getTime() + add * 86400_000).toISOString()
    const inRange = await listPosts(prisma, { status: 'SCHEDULED', channel: 'FACEBOOK_PAGE', from: day(when, -1), to: day(when, 1) })
    assert.ok(inRange.some((x) => x.id === p.id))
    const outRange = await listPosts(prisma, { from: day(when, 1), to: day(when, 2) })
    assert.ok(!outRange.some((x) => x.id === p.id))
    await rejects(() => listPosts(prisma, { status: 'NOPE' }), 400)
    await rejects(() => listPosts(prisma, { channel: 'NOPE' }), 400)
    await rejects(() => listPosts(prisma, { from: 'yesterday-ish' }), 400)
    const u = await transitionPost(prisma, p.id, 'unschedule', owner)
    assert.deepStrictEqual([u.status, u.scheduledFor], ['APPROVED', null])
  })

  test('two simultaneous transitions: only one wins', async () => {
    const p = await newPost('WHATSAPP_STATUS')
    const results = await Promise.allSettled([transitionPost(prisma, p.id, 'submit', owner), transitionPost(prisma, p.id, 'submit', owner)])
    assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.strictEqual(results.filter((r) => r.status === 'rejected').length, 1)
  })
})

describe('API shapes never expose credentials', () => {
  const req = (url: string, method = 'GET', body?: unknown) =>
    new Request(`http://localhost${url}`, { method, headers: { cookie: `auth-token=${ownerToken}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

  test('channel list has hints but never credentialsEnc or the token', async () => {
    const secret = 'EAAB-super-secret-token-WXYZ'
    const ch = await prisma.marketingChannel.create({
      data: { kind: 'THREADS', name: 'ZP1200 threads', status: 'CONNECTED', credentialsEnc: encryptSecret(secret), tokenHint: 'WXYZ' },
    })
    channelIds.push(ch.id)
    const res = await channelsRoute.GET(req('/api/marketing/channels'))
    const text = await res.text()
    assert.strictEqual(res.status, 200)
    assert.ok(!text.includes('credentialsEnc'))
    assert.ok(!text.includes(secret))
    assert.ok(!text.includes(ch.credentialsEnc!))
    const threads = (JSON.parse(text).channels as { kind: string; channel: { tokenHint: string } | null; effectiveStatus: string }[]).find((c) => c.kind === 'THREADS')!
    assert.strictEqual(threads.channel!.tokenHint, 'WXYZ')
    assert.strictEqual(threads.effectiveStatus, 'CONNECTED')
    const all = await listChannels(prisma)
    assert.ok(all.length >= 24)
    assert.ok(!JSON.stringify(all).includes('credentialsEnc'))
  })

  test('transition endpoint: owner actions only, plain errors', async () => {
    const p = (await createContent(prisma, { title: 'ZP1200 api', channels: ['WHATSAPP_STATUS'] }, owner.username)).posts![0]
    contentIds.push((await prisma.marketingPost.findUniqueOrThrow({ where: { id: p.id } })).contentId)
    const ctx = { params: Promise.resolve({ id: String(p.id) }) }
    const bad = await transitionRoute.POST(req(`/x`, 'POST', { action: 'published' }), ctx)
    assert.strictEqual(bad.status, 400)
    const ok = await transitionRoute.POST(req(`/x`, 'POST', { action: 'submit' }), ctx)
    assert.strictEqual(ok.status, 200)
    assert.strictEqual((await ok.json()).post.status, 'PENDING_APPROVAL')
    const again = await transitionRoute.POST(req(`/x`, 'POST', { action: 'submit' }), ctx)
    assert.strictEqual(again.status, 409)
    assert.match((await again.json()).error, /Cannot submit/)
  })

  test('settings endpoint answers with the env flag and the kill switch makes everything 404', async () => {
    const res = await settingsRoute.GET(req('/api/marketing/settings'))
    assert.strictEqual(res.status, 200)
    assert.strictEqual(typeof (await res.json()).liveAllowedByEnv, 'boolean')
    process.env.GRACE_MARKETING_HUB = 'false'
    try {
      for (const r of [await settingsRoute.GET(req('/a')), await channelsRoute.GET(req('/a')), await postsRoute.GET(req('/a'))]) {
        assert.strictEqual(r.status, 404)
      }
    } finally {
      delete process.env.GRACE_MARKETING_HUB
    }
    assert.strictEqual((await postsRoute.GET(req('/api/marketing/posts?status=DRAFT'))).status, 200)
  })
})
