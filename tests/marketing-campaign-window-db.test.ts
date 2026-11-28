// ZP-1124 (AT-04, AT-05, MM-04-AC3/AC4/AC6, MM-09-AC1 to AC3) against DATABASE_URL with a stub connector (no network).
// Campaign dates are set relative to today in shop time. Only touches rows it creates
// (campaigns and content "ZP1124 ...", the channel with the test page id, audit rows by id).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1124-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { archiveCampaign } from '../src/lib/marketing/campaigns'
import { shopDay } from '../src/lib/marketing/campaign-window'
import { markStalePublishing, publishPost, runDuePosts, PUBLISH_LEASE_MS, type PublishDeps } from '../src/lib/marketing/publish'
import { transitionPost } from '../src/lib/marketing/posts'
import { getSettings } from '../src/lib/marketing/settings'
import { encryptJson } from '../src/lib/marketing/secrets'
import { generateTrackingTag } from '../src/lib/marketing/tracking'
import type { Connector, PublishResult } from '../src/lib/marketing/connectors/types'
import { WebsiteError } from '../src/lib/website/http'

const owner = { username: 'zp1124-owner', role: 'OWNER' as const }
const PAGE = '771124000'
const DAY = 86_400_000
const savedEnv = process.env.GRACE_MARKETING_LIVE
let saved: { liveEnabled: boolean } | null = null
let channelId = 0
const campaignIds: number[] = []
const contentIds: number[] = []
const postIds: number[] = []

/** UTC midnight of the shop day `offset` days from today, the way the campaign page stores a chosen day. */
const day = (offset: number) => new Date(new Date(`${shopDay(new Date())}T00:00:00Z`).getTime() + offset * DAY)

const rejects = (fn: () => Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))

/** A connector that records every post it is asked to send, and answers with `answer` (or throws it). */
function stub(answer: PublishResult | Error) {
  const sent: number[] = []
  const connector: Connector = {
    kind: 'FACEBOOK_PAGE',
    verify: async () => ({ ok: true, externalId: PAGE, name: 'ZP1124' }),
    publish: async (p) => {
      sent.push(p.id)
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  const deps: PublishDeps = { fetch: async () => { throw new Error('the stub connector must be used') }, baseUrl: 'https://vyra.example', getConnector: () => connector }
  return { deps, sent }
}

async function newCampaign(o: { status?: string; startsAt?: Date | null; endsAt?: Date | null } = {}) {
  const c = await prisma.marketingCampaign.create({
    data: { name: `ZP1124 campaign ${campaignIds.length + 1}`, status: o.status ?? 'ACTIVE', startsAt: o.startsAt === undefined ? day(-1) : o.startsAt, endsAt: o.endsAt === undefined ? day(1) : o.endsAt, createdBy: owner.username },
  })
  campaignIds.push(c.id)
  const content = await prisma.marketingContent.create({ data: { title: 'ZP1124 content', campaignId: c.id, createdBy: owner.username } })
  contentIds.push(content.id)
  return { campaign: c, contentId: content.id }
}

async function newPost(contentId: number, o: { status?: string; scheduledFor?: Date | null; kind?: string; attempts?: number } = {}) {
  const kind = o.kind ?? 'FACEBOOK_PAGE'
  const p = await prisma.marketingPost.create({
    data: {
      contentId, channelKind: kind, channelId: kind === 'FACEBOOK_PAGE' ? channelId : null, format: 'POST', text: 'ZP1124 hello', imageKeys: [],
      trackingTag: generateTrackingTag(), link: 'https://shop.example/?src=x', status: o.status ?? 'APPROVED',
      approvedBy: owner.username, approvedAt: new Date(), scheduledFor: o.scheduledFor ?? null, attempts: o.attempts ?? 0, createdBy: owner.username,
    },
  })
  postIds.push(p.id)
  return p
}

const statusOf = async (id: number) => (await prisma.marketingPost.findUniqueOrThrow({ where: { id } })).status

before(async () => {
  saved = { liveEnabled: (await getSettings(prisma)).liveEnabled }
  process.env.GRACE_MARKETING_LIVE = 'true'
  await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: true } })
  const ch = await prisma.marketingChannel.create({
    data: { kind: 'FACEBOOK_PAGE', name: 'ZP1124 Page', status: 'CONNECTED', externalId: PAGE, credentialsEnc: encryptJson({ accessToken: 'EAAB-zp1124-token' }), connectedBy: owner.username, connectedAt: new Date() },
  })
  channelId = ch.id
})

after(async () => {
  await prisma.marketingPost.deleteMany({ where: { id: { in: postIds } } })
  await prisma.marketingContent.deleteMany({ where: { id: { in: contentIds } } })
  await prisma.marketingCampaign.deleteMany({ where: { id: { in: campaignIds } } })
  await prisma.marketingChannel.deleteMany({ where: { externalId: PAGE } })
  await prisma.marketingAuditLog.deleteMany({
    where: { OR: [{ actor: owner.username }, { entity: 'post', entityId: { in: postIds } }, { entity: 'campaign', entityId: { in: campaignIds } }, { entity: 'channel', entityId: channelId }] },
  })
  if (saved) await prisma.marketingSettings.update({ where: { id: 1 }, data: saved })
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
  await prisma.$disconnect()
})

describe('AT-04: nothing goes out outside its campaign (MM-04-AC3/AC4/AC6)', () => {
  test('scheduling after the last day is refused; the last day itself is fine', async () => {
    const { contentId } = await newCampaign({ startsAt: day(-1), endsAt: day(1) })
    const p = await newPost(contentId)
    // 08:00 Harare the day after the last day.
    await rejects(() => transitionPost(prisma, p.id, 'schedule', owner, { scheduledFor: new Date(day(2).getTime() + 6 * 3_600_000) }), 409, /Nothing goes out after its last day/)
    assert.strictEqual(await statusOf(p.id), 'APPROVED')
    // 21:00 Harare on the last day.
    const ok = await transitionPost(prisma, p.id, 'schedule', owner, { scheduledFor: new Date(day(1).getTime() + 19 * 3_600_000) })
    assert.strictEqual(ok.status, 'SCHEDULED')
  })

  test('the run the day after the end closes the campaign and withdraws its posts without calling the platform', async () => {
    const { campaign, contentId } = await newCampaign({ startsAt: day(-3), endsAt: day(-1) })
    const due = await newPost(contentId, { status: 'SCHEDULED', scheduledFor: new Date(Date.now() - 3_600_000) })
    const waiting = await newPost(contentId, { status: 'APPROVED' })
    const s = stub({ ok: true, externalId: 'should-not-happen', externalUrl: null })
    const r = await runDuePosts(prisma, new Date(), s.deps)
    assert.ok(r.endedCampaigns.includes(campaign.id))
    assert.ok(r.withdrawn.includes(due.id) && r.withdrawn.includes(waiting.id))
    assert.ok(!s.sent.includes(due.id) && !s.sent.includes(waiting.id))
    assert.strictEqual((await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).status, 'ENDED')
    for (const id of [due.id, waiting.id]) {
      const row = await prisma.marketingPost.findUniqueOrThrow({ where: { id } })
      assert.strictEqual(row.status, 'CANCELLED')
      assert.match(row.error ?? '', /Withdrawn: the campaign ended on/)
      assert.strictEqual(await prisma.marketingAuditLog.count({ where: { entity: 'post', entityId: id, action: 'post.withdrawn' } }), 1)
    }
    assert.strictEqual(await prisma.marketingAuditLog.count({ where: { entity: 'campaign', entityId: campaign.id, action: 'campaign.ended' } }), 1)
  })

  test('Try again and Mark as shared are refused once the last day is over, even before the run closes the campaign', async () => {
    const { contentId } = await newCampaign({ startsAt: day(-5), endsAt: day(-2) })
    const failed = await newPost(contentId, { status: 'FAILED', attempts: 1 })
    const manual = await newPost(contentId, { status: 'APPROVED', kind: 'FACEBOOK_GROUPS' })
    const s = stub({ ok: true, externalId: 'x', externalUrl: null })
    await rejects(() => publishPost(prisma, failed.id, owner, s.deps), 409, /Nothing goes out after its last day/)
    await rejects(() => transitionPost(prisma, manual.id, 'share', owner), 409, /Nothing goes out after its last day/)
    assert.deepStrictEqual(s.sent, [])
    assert.strictEqual(await statusOf(failed.id), 'FAILED')
    assert.strictEqual(await statusOf(manual.id), 'APPROVED')
  })

  test('a paused campaign, and one that has not started, block Publish', async () => {
    const paused = await newCampaign({ status: 'PAUSED' })
    const later = await newCampaign({ startsAt: day(2), endsAt: day(4) })
    const a = await newPost(paused.contentId)
    const b = await newPost(later.contentId)
    const s = stub({ ok: true, externalId: 'x', externalUrl: null })
    await rejects(() => publishPost(prisma, a.id, owner, s.deps), 409, /paused/)
    await rejects(() => publishPost(prisma, b.id, owner, s.deps), 409, /Nothing goes out before then/)
    assert.deepStrictEqual(s.sent, [])
    assert.strictEqual(await statusOf(a.id), 'APPROVED')
    assert.strictEqual(await statusOf(b.id), 'APPROVED')
  })

  test('archiving keeps the campaign and its history, and withdraws what has not gone out', async () => {
    const { campaign, contentId } = await newCampaign()
    const approved = await newPost(contentId, { status: 'APPROVED' })
    const scheduled = await newPost(contentId, { status: 'SCHEDULED', scheduledFor: new Date(Date.now() + 3_600_000) })
    const out = await newPost(contentId, { status: 'PUBLISHED' })
    const dto = await archiveCampaign(prisma, campaign.id, owner.username)
    assert.strictEqual(dto.status, 'ARCHIVED')
    for (const id of [approved.id, scheduled.id]) {
      const row = await prisma.marketingPost.findUniqueOrThrow({ where: { id } })
      assert.strictEqual(row.status, 'CANCELLED')
      assert.match(row.error ?? '', /archived/)
    }
    assert.strictEqual(await statusOf(out.id), 'PUBLISHED')
    assert.strictEqual(await prisma.marketingContent.count({ where: { id: contentId, campaignId: campaign.id } }), 1)
  })
})

describe('AT-05: an unknown outcome is never retried blind (MM-09-AC1 to AC3)', () => {
  test('a broken connection makes the post uncertain; it cannot be retried and the run leaves it alone', async () => {
    const { contentId } = await newCampaign()
    const p = await newPost(contentId)
    const s = stub(new Error('socket hang up'))
    const r = await publishPost(prisma, p.id, owner, s.deps)
    assert.strictEqual(r.status, 'UNCERTAIN')
    assert.match(r.error ?? '', /It may already be on Facebook Page/)
    assert.deepStrictEqual(s.sent, [p.id])
    await rejects(() => publishPost(prisma, p.id, owner, s.deps), 409)
    await rejects(() => transitionPost(prisma, p.id, 'retry', owner), 409)
    await runDuePosts(prisma, new Date(), s.deps)
    assert.strictEqual(await statusOf(p.id), 'UNCERTAIN')
    assert.deepStrictEqual(s.sent, [p.id]) // sent once, never again
    // The owner checks: it did not go out, so Try again becomes possible.
    const checked = await transitionPost(prisma, p.id, 'confirm_not_published', owner)
    assert.strictEqual(checked.status, 'FAILED')
  })

  test('an answer without the post ID is uncertain; the owner confirms it with the link', async () => {
    const { contentId } = await newCampaign()
    const p = await newPost(contentId)
    const r = await publishPost(prisma, p.id, owner, stub({ ok: true, externalId: '', externalUrl: null }).deps)
    assert.strictEqual(r.status, 'UNCERTAIN')
    await rejects(() => transitionPost(prisma, p.id, 'confirm_published', owner, { externalUrl: 'not a link' }), 409, /Paste the link/)
    const done = await transitionPost(prisma, p.id, 'confirm_published', owner, { externalUrl: 'https://www.facebook.com/771124000_1' })
    assert.strictEqual(done.status, 'PUBLISHED')
    const row = await prisma.marketingPost.findUniqueOrThrow({ where: { id: p.id } })
    assert.strictEqual(row.externalUrl, 'https://www.facebook.com/771124000_1')
    assert.ok(row.publishedAt)
  })

  test('a platform that says it may have posted (timeout) is uncertain; a plain refusal is failed', async () => {
    const { contentId } = await newCampaign()
    const a = await newPost(contentId)
    const b = await newPost(contentId)
    assert.strictEqual((await publishPost(prisma, a.id, owner, stub({ ok: false, error: 'Timed out', retryable: true, uncertain: true }).deps)).status, 'UNCERTAIN')
    assert.strictEqual((await publishPost(prisma, b.id, owner, stub({ ok: false, error: 'Bad request', retryable: false }).deps)).status, 'FAILED')
  })

  test('a post left publishing past the lease becomes uncertain; a fresh one is left alone', async () => {
    const { contentId } = await newCampaign()
    const p = await newPost(contentId, { status: 'PUBLISHING', attempts: 1 })
    assert.ok(!(await markStalePublishing(prisma, new Date())).includes(p.id))
    assert.strictEqual(await statusOf(p.id), 'PUBLISHING')
    const marked = await markStalePublishing(prisma, new Date(Date.now() + PUBLISH_LEASE_MS + 60_000))
    assert.ok(marked.includes(p.id))
    const row = await prisma.marketingPost.findUniqueOrThrow({ where: { id: p.id } })
    assert.strictEqual(row.status, 'UNCERTAIN')
    assert.match(row.error ?? '', /stopped before Facebook Page answered/)
    assert.strictEqual(await prisma.marketingAuditLog.count({ where: { entity: 'post', entityId: p.id, action: 'post.uncertain' } }), 1)
  })
})
