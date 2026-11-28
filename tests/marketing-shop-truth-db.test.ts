// ZP-1106 (MM-01) against DATABASE_URL, with fake AI and a stub connector (no network).
// Only touches rows it creates (products "ZPTRUTH-*", content "ZPTRUTH ...", the channel with the test page id,
// audit rows of its own actor) and puts the settings row back as it found it.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1106-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { listCatalogue, productTruth } from '../src/lib/marketing/catalogue'
import { createCampaign, updateCampaign } from '../src/lib/marketing/campaigns'
import { createContent, updateContent } from '../src/lib/marketing/content'
import { publishPost, runDuePosts, type PublishDeps } from '../src/lib/marketing/publish'
import { transitionPost } from '../src/lib/marketing/posts'
import { confirmProfile, generateProfile, getProfile, saveProfile } from '../src/lib/marketing/selling-profile'
import { getSettings, getSetupState, updateSettings } from '../src/lib/marketing/settings'
import { encryptJson } from '../src/lib/marketing/secrets'
import { generateTrackingTag } from '../src/lib/marketing/tracking'
import { draftContentPosts } from '../src/lib/marketing/ai/draft'
import type { DraftInput, DraftResult } from '../src/lib/marketing/ai/writer'
import type { ProfileInput } from '../src/lib/marketing/ai/profile'
import type { Connector } from '../src/lib/marketing/connectors/types'
import { WebsiteError } from '../src/lib/website/http'

const owner = { username: 'zptruth-owner', role: 'OWNER' as const }
const PAGE = '771106000'
const savedEnv = process.env.GRACE_MARKETING_LIVE
const SETTINGS_KEYS = ['market', 'currency', 'timeZone', 'salesMode', 'contactRoute', 'audienceNotes', 'confirmations', 'policyDelivery', 'policyReturns', 'policyOrdering', 'brandVoice', 'liveEnabled'] as const
let savedSettings: Record<string, unknown> = {}
let channelId = 0
const productIds: number[] = []
const contentIds: number[] = []
const campaignIds: number[] = []

const rejects = (fn: () => Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))

async function newProduct(o: Record<string, unknown> = {}) {
  const n = productIds.length + 1
  const p = await prisma.product.create({
    data: { itemNumber: `ZPTRUTH-${Date.now()}-${n}`, productName: `ZPTRUTH Dress ${n}`, slug: `zptruth-${Date.now()}-${n}`, sellingPriceUsd: 40, priceDisplay: 'SHOW_PRICE', published: true, publishedAt: new Date(Date.now() - 90 * 86_400_000), currentQuantity: 4, ...o },
  })
  productIds.push(p.id)
  return p
}

function captureWriter() {
  const seen: DraftInput[] = []
  const write = async (i: DraftInput): Promise<DraftResult> => {
    seen.push(i)
    return { drafts: i.channels.map((c) => ({ channel: c, text: 'Twirl-ready cotton for party days.', template: 'Twirl-ready cotton for party days.', openings: [], notes: [] })), failures: [], costCents: 1, writer: 'claude' }
  }
  return { seen, write }
}

before(async () => {
  const s = await getSettings(prisma)
  savedSettings = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, (s as Record<string, unknown>)[k]]))
  await prisma.marketingSettings.update({ where: { id: 1 }, data: { market: null, currency: null, timeZone: null, salesMode: null, contactRoute: null, audienceNotes: [], confirmations: {}, policyDelivery: null, policyReturns: null } })
  const ch = await prisma.marketingChannel.create({
    data: { kind: 'FACEBOOK_PAGE', name: 'ZPTRUTH Page', status: 'CONNECTED', externalId: PAGE, credentialsEnc: encryptJson({ accessToken: 'EAAB-zp1106' }), connectedBy: owner.username, connectedAt: new Date() },
  })
  channelId = ch.id
})

after(async () => {
  await prisma.marketingContent.deleteMany({ where: { id: { in: contentIds } } })
  await prisma.marketingCampaign.deleteMany({ where: { id: { in: campaignIds } } })
  await prisma.marketingChannel.deleteMany({ where: { externalId: PAGE } })
  await prisma.marketingAuditLog.deleteMany({ where: { OR: [{ actor: owner.username }, { actor: 'zptruth-other' }, { entity: 'product', entityId: { in: productIds } }] } })
  await prisma.product.deleteMany({ where: { id: { in: productIds } } })
  await prisma.marketingSettings.update({ where: { id: 1 }, data: savedSettings as never })
  if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE
  else process.env.GRACE_MARKETING_LIVE = savedEnv
  await prisma.$disconnect()
})

describe('MM-01-AC3: owner corrections persist, with who confirmed them and when', () => {
  test('a changed fact is confirmed by the owner now and survives a fresh read', async () => {
    const at = new Date('2026-11-28T12:00:00.000Z')
    await updateSettings(prisma, { market: 'Harare and Bulawayo', currency: 'usd', timeZone: 'Africa/Harare', salesMode: 'BOTH', audienceNotes: [' Parents of girls 2 to 8 ', 'Parents of girls 2 to 8'] }, owner.username, at)
    const s = await getSettings(prisma)
    assert.deepStrictEqual([s.market, s.currency, s.timeZone, s.salesMode, s.audienceNotes], ['Harare and Bulawayo', 'USD', 'Africa/Harare', 'BOTH', ['Parents of girls 2 to 8']])
    const setup = await getSetupState(prisma)
    for (const f of ['market', 'currency', 'timeZone', 'salesMode', 'audienceNotes'] as const) {
      const i = setup.items.find((x) => x.field === f)!
      assert.deepStrictEqual([i.status, i.confirmedBy, i.confirmedAt], ['confirmed', owner.username, at.toISOString()], f)
    }
    assert.ok(await prisma.marketingAuditLog.findFirst({ where: { actor: owner.username, action: 'settings.update' } }))
  })

  test('sending a fact back unchanged keeps its first confirmation; "this is right" confirms without changing', async () => {
    await updateSettings(prisma, { market: 'Harare and Bulawayo' }, 'zptruth-other', new Date('2026-11-29T09:00:00.000Z'))
    const market = (await getSetupState(prisma)).items.find((x) => x.field === 'market')!
    assert.strictEqual(market.confirmedBy, owner.username)
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { brandVoice: 'warm, plain words' } })
    assert.strictEqual((await getSetupState(prisma)).items.find((x) => x.field === 'brandVoice')!.status, 'unconfirmed')
    await updateSettings(prisma, { confirm: ['brandVoice', 'policyReturns'] }, owner.username)
    const after = await getSetupState(prisma)
    assert.strictEqual(after.items.find((x) => x.field === 'brandVoice')!.status, 'confirmed')
    assert.strictEqual(after.items.find((x) => x.field === 'policyReturns')!.status, 'unknown')
    assert.strictEqual((await getSettings(prisma)).brandVoice, 'warm, plain words')
  })

  test('v1 refuses other currencies and time zones plainly, and unknown confirm fields', async () => {
    await rejects(() => updateSettings(prisma, { currency: 'ZWG' }, owner.username), 400, /US dollars/)
    await rejects(() => updateSettings(prisma, { timeZone: 'Europe/London' }, owner.username), 400, /Harare/)
    await rejects(() => updateSettings(prisma, { salesMode: 'SOMETIMES' }, owner.username), 400)
    await rejects(() => updateSettings(prisma, { confirm: ['liveEnabled'] }, owner.username), 400)
    assert.strictEqual((await getSettings(prisma)).currency, 'USD')
  })

  test('a selling profile the owner saves is confirmed by them; an AI rewrite is not until they confirm it', async () => {
    const p = await newProduct()
    const PROFILE = { buyers: [{ who: 'A parent', moment: 'a party next week' }], reasons: [{ reason: 'Twirls', fact: 'Full skirt' }], doubts: [], occasions: ['Parties'] }
    const saved = await saveProfile(prisma, p.id, PROFILE, owner.username)
    assert.strictEqual(saved.confirmedBy, owner.username)
    assert.ok(saved.confirmedAt)
    const ai = await generateProfile(prisma, p.id, owner.username, { write: async (_i: ProfileInput) => ({ profile: PROFILE, costCents: 1, writer: 'claude' }) })
    assert.deepStrictEqual([ai.confirmedBy, ai.confirmedAt], [null, null])
    const ok = await confirmProfile(prisma, p.id, owner.username)
    assert.strictEqual(ok.confirmedBy, owner.username)
    assert.strictEqual((await getProfile(prisma, p.id))?.confirmedBy, owner.username)
    const bare = await newProduct()
    await rejects(() => confirmProfile(prisma, bare.id, owner.username), 404)
  })
})

describe('MM-01-AC1: the catalogue is the existing products, by id', () => {
  test('listing the catalogue creates nothing and returns the products\' own ids', async () => {
    const a = await newProduct()
    const hidden = await newProduct({ published: false })
    const before = await prisma.product.count()
    const rows = await listCatalogue(prisma, { includeWithdrawn: true, limit: 500 })
    assert.strictEqual(await prisma.product.count(), before)
    const row = rows.find((r) => r.productId === a.id)!
    assert.strictEqual(row.name, a.productName)
    assert.strictEqual(row.excluded, null)
    assert.match(rows.find((r) => r.productId === hidden.id)?.excluded ?? '', /not on the website/)
    assert.ok(!(await listCatalogue(prisma, { limit: 500 })).some((r) => r.productId === hidden.id))
  })
})

describe('MM-01-AC4: withdrawn pieces are excluded; pre-orders keep their dates', () => {
  test('new content or campaign products must be on the website and not sold out', async () => {
    const gone = await newProduct({ published: false })
    const soldOut = await newProduct({ currentQuantity: 0 })
    const pre = await newProduct({ listingType: 'PRE_ORDER', currentQuantity: 0, preorderShipFrom: new Date('2027-01-05T00:00:00Z') })
    await rejects(() => createContent(prisma, { title: 'ZPTRUTH gone', productId: gone.id }, owner.username), 400, /not on the website/)
    await rejects(() => createContent(prisma, { title: 'ZPTRUTH sold out', productId: soldOut.id }, owner.username), 400, /sold out/)
    const ok = await createContent(prisma, { title: 'ZPTRUTH pre-order', productId: pre.id }, owner.username)
    contentIds.push(ok.id)
    await rejects(() => updateContent(prisma, ok.id, { productId: gone.id }, owner.username), 400, /not on the website/)
    await rejects(() => createCampaign(prisma, { name: 'ZPTRUTH c', productIds: [gone.id] }, owner.username), 400, /not on the website/)
    const c = await createCampaign(prisma, { name: 'ZPTRUTH c2', productIds: [pre.id] }, owner.username)
    campaignIds.push(c.id)
    // A product chosen earlier and withdrawn later stays listed: saving the campaign still works.
    await prisma.product.update({ where: { id: pre.id }, data: { published: false } })
    assert.deepStrictEqual((await updateCampaign(prisma, c.id, { productIds: [pre.id], notes: 'x' }, owner.username)).productIds, [pre.id])
  })

  test('a post whose product was withdrawn after approval is never sent or scheduled (AT-06)', async () => {
    process.env.GRACE_MARKETING_LIVE = 'true'
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: true } })
    const p = await newProduct()
    const content = await createContent(prisma, { title: 'ZPTRUTH post', productId: p.id }, owner.username)
    contentIds.push(content.id)
    const mkPost = (status: string, scheduledFor: Date | null = null, kind = 'FACEBOOK_PAGE') => prisma.marketingPost.create({
      data: { contentId: content.id, channelKind: kind, channelId: kind === 'FACEBOOK_PAGE' ? channelId : null, format: 'POST', text: 'ZPTRUTH hello', imageKeys: [], trackingTag: generateTrackingTag(), status, approvedBy: owner.username, approvedAt: new Date(), scheduledFor, createdBy: owner.username },
    })
    const now = await mkPost('APPROVED')
    const later = await mkPost('APPROVED')
    const due = await mkPost('SCHEDULED', new Date(Date.now() - 60_000))
    const manual = await mkPost('APPROVED', null, 'WHATSAPP_STATUS')
    await prisma.product.update({ where: { id: p.id }, data: { published: false } })
    const sent: number[] = []
    const connector: Connector = { kind: 'FACEBOOK_PAGE', verify: async () => ({ ok: true, externalId: PAGE, name: 'x' }), publish: async (x) => { sent.push(x.id); return { ok: true, externalId: 'fb1', externalUrl: null } } }
    const deps: PublishDeps = { fetch: async () => { throw new Error('stub only') }, baseUrl: 'https://vyra.example', getConnector: () => connector }
    await rejects(() => publishPost(prisma, now.id, owner, deps), 409, /not on the website/)
    await rejects(() => transitionPost(prisma, later.id, 'schedule', owner, { scheduledFor: new Date(Date.now() + 3_600_000) }), 409, /not on the website/)
    await rejects(() => transitionPost(prisma, manual.id, 'share', owner), 409, /not on the website/)
    const r = await runDuePosts(prisma, new Date(), deps)
    assert.ok(r.blocked.some((b) => b.postId === due.id && /not on the website/.test(b.reason)))
    assert.deepStrictEqual(sent, [])
    for (const id of [now.id, later.id, due.id, manual.id]) {
      const row = await prisma.marketingPost.findUniqueOrThrow({ where: { id } })
      assert.ok(['APPROVED', 'SCHEDULED'].includes(row.status), row.status)
    }
  })

  test('the writer is refused for a sold-out piece and given a pre-order\'s real dates', async () => {
    const soldOut = await newProduct()
    const a = await createContent(prisma, { title: 'ZPTRUTH write', productId: soldOut.id, channels: ['X'] }, owner.username)
    contentIds.push(a.id)
    await prisma.product.update({ where: { id: soldOut.id }, data: { currentQuantity: 0 } })
    const w = captureWriter()
    await rejects(() => draftContentPosts(prisma, a.id, { actor: owner.username, write: w.write }), 409, /sold out/)
    assert.strictEqual(w.seen.length, 0)

    const pre = await newProduct({ listingType: 'PRE_ORDER', currentQuantity: 0, preorderShipFrom: new Date('2027-01-05T00:00:00Z'), preorderShipTo: new Date('2027-01-20T00:00:00Z') })
    const b = await createContent(prisma, { title: 'ZPTRUTH pre', productId: pre.id, channels: ['X'] }, owner.username)
    contentIds.push(b.id)
    await draftContentPosts(prisma, b.id, { actor: owner.username, write: w.write })
    const lines = w.seen[0].truth?.lines.join('\n') ?? ''
    assert.match(lines, /ships between 5 January 2027 and 20 January 2027\. Not in stock yet\./)
    assert.strictEqual(w.seen[0].truth?.facts.availability?.kind, 'PRE_ORDER')
  })
})

describe('MM-01-AC2 and AC5: unknown policies and wholesale terms reach the writer as rules', () => {
  test('unknown delivery and returns are "never mention"; the wholesale price only with the shop\'s mode and both terms', async () => {
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { policyDelivery: null, policyReturns: 'Exchanges within 7 days.', salesMode: 'RETAIL' } })
    const p = await newProduct({ wholesalePriceUsd: 12, wholesaleMinQuantity: 6 })
    const c = await createContent(prisma, { title: 'ZPTRUTH wholesale', productId: p.id, channels: ['X'] }, owner.username)
    contentIds.push(c.id)
    const w = captureWriter()
    await draftContentPosts(prisma, c.id, { actor: owner.username, write: w.write })
    const retail = w.seen[0]
    assert.match(retail.truth?.lines.join('\n') ?? '', /Delivery: NOT KNOWN/)
    assert.match(retail.truth?.lines.join('\n') ?? '', /Returns \(the shop's own words\): Exchanges within 7 days\./)
    assert.strictEqual(retail.product.wholesaleText, null)
    assert.strictEqual(retail.truth?.facts.wholesale.ok, false)

    await prisma.marketingSettings.update({ where: { id: 1 }, data: { salesMode: 'BOTH' } })
    await draftContentPosts(prisma, c.id, { actor: owner.username, write: w.write })
    assert.strictEqual(w.seen[1].product.wholesaleText, '$12 each when you buy 6 or more')

    await prisma.product.update({ where: { id: p.id }, data: { wholesaleMinQuantity: null } })
    const t = await productTruth(prisma, p.id)
    assert.strictEqual(t?.wholesaleText, null)
    assert.match(t?.lines.join('\n') ?? '', /Wholesale: NOT OFFERED/)
  })
})
