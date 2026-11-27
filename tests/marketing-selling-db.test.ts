// The selling profile, the structured brief and brief-led drafting against DATABASE_URL, with fake AI.
// Only touches rows it creates (product "ZPSELL-*", content titled "ZPSELL ...", audit rows of its own actor).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { createContent, updateContent } from '../src/lib/marketing/content'
import { updatePost } from '../src/lib/marketing/posts'
import { generateProfile, getProfile, saveProfile } from '../src/lib/marketing/selling-profile'
import { getSettings, updateSettings } from '../src/lib/marketing/settings'
import { draftContentPosts } from '../src/lib/marketing/ai/draft'
import type { DraftInput, DraftResult } from '../src/lib/marketing/ai/writer'
import type { ProfileInput } from '../src/lib/marketing/ai/profile'
import { WebsiteError } from '../src/lib/website/http'
import * as profileRoute from '../src/app/api/marketing/products/[id]/profile/route'
import { createToken } from '../src/lib/auth'

const owner = { username: 'zpsell-owner' }
let ownerToken = ''
let staffToken = ''
let productId = 0
const contentIds: number[] = []
let savedSettings: { shopDescription: string | null; policyDelivery: string | null; policyReturns: string | null; policyOrdering: string | null }
const savedHub = process.env.GRACE_MARKETING_HUB

const req = (url: string, method = 'GET', body?: unknown, token = ownerToken) =>
  new Request(`http://localhost${url}`, { method, headers: { cookie: `auth-token=${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })
const status = async (p: Promise<unknown>) => { try { await p; return 200 } catch (e) { return e instanceof WebsiteError ? e.status : 500 } }

const PROFILE = {
  buyers: [{ who: 'A parent', moment: 'a family wedding in three weeks' }],
  reasons: [{ reason: 'She can play all day', fact: 'Soft cotton lining' }],
  doubts: [{ doubt: 'Will it fit?', answer: null }],
  occasions: ['Weddings'],
}

before(async () => {
  process.env.GRACE_MARKETING_HUB = '1'
  ownerToken = await createToken(900301, owner.username, 'OWNER')
  staffToken = await createToken(900302, 'zpsell-staff', 'STAFF')
  const p = await prisma.product.create({
    data: { itemNumber: `ZPSELL-${Date.now()}`, productName: 'ZPSELL Dress', slug: `zpsell-dress-${Date.now()}`, sellingPriceUsd: 45, priceDisplay: 'SHOW_PRICE', sizes: '2-8 years', published: true, publishedAt: new Date(Date.now() - 90 * 86_400_000), currentQuantity: 2 },
  })
  productId = p.id
  const s = await getSettings(prisma)
  savedSettings = { shopDescription: s.shopDescription, policyDelivery: s.policyDelivery, policyReturns: s.policyReturns, policyOrdering: s.policyOrdering }
})

after(async () => {
  await prisma.marketingContent.deleteMany({ where: { id: { in: contentIds } } })
  await prisma.marketingSettings.update({ where: { id: 1 }, data: savedSettings })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: owner.username } })
  await prisma.product.deleteMany({ where: { id: productId } })
  if (savedHub === undefined) delete process.env.GRACE_MARKETING_HUB
  else process.env.GRACE_MARKETING_HUB = savedHub
  await prisma.$disconnect()
})

describe('selling profile', () => {
  test('the AI is given the shop line, the policies and the product facts; the answer is saved on the product', async () => {
    await updateSettings(prisma, { shopDescription: 'a test boutique', policyDelivery: 'Harare in two days' }, owner.username)
    let seen: ProfileInput | null = null
    const p = await generateProfile(prisma, productId, owner.username, { write: async (i) => { seen = i; return { profile: PROFILE, costCents: 3, writer: 'claude' } } })
    const input = seen as unknown as ProfileInput
    assert.deepStrictEqual(input.shop, { name: 'VYRA', description: 'a test boutique' })
    assert.strictEqual(input.policies?.delivery, 'Harare in two days')
    assert.strictEqual(input.product.productName, 'ZPSELL Dress')
    assert.deepStrictEqual(p.buyers, PROFILE.buyers)
    assert.strictEqual(p.aiGenerated, true)
    assert.strictEqual((await prisma.marketingSellingProfile.findUnique({ where: { productId } }))?.aiCostCents, 3)
    assert.strictEqual(await status(generateProfile(prisma, 999_999_999, owner.username, { write: async () => ({ profile: PROFILE, costCents: 0, writer: 'claude' }) })), 404)
  })

  test('the owner can correct it; half-filled rows and prices are refused, not silently dropped', async () => {
    const edited = { ...PROFILE, doubts: [{ doubt: 'Will it fit?', answer: 'We swap sizes within a week.' }] }
    const p = await saveProfile(prisma, productId, edited, owner.username)
    assert.strictEqual(p.doubts[0].answer, 'We swap sizes within a week.')
    assert.strictEqual(p.aiGenerated, false)
    assert.strictEqual(await status(saveProfile(prisma, productId, { ...PROFILE, buyers: [{ who: 'A parent', moment: '' }] }, owner.username)), 400)
    assert.strictEqual(await status(saveProfile(prisma, productId, { ...PROFILE, doubts: [{ doubt: 'Delivery?', answer: 'It costs $5.' }] }, owner.username)), 400)
    assert.strictEqual(await status(saveProfile(prisma, productId, { buyers: [] }, owner.username)), 400)
    assert.strictEqual((await getProfile(prisma, productId))?.doubts[0].answer, 'We swap sizes within a week.')
  })

  test('the route is owner only, returns the profile and only the true reasons to act now', async () => {
    assert.strictEqual((await profileRoute.GET(req(`/api/marketing/products/${productId}/profile`, 'GET', undefined, staffToken), ctx(productId))).status, 403)
    assert.strictEqual((await profileRoute.GET(req('/api/marketing/products/999999999/profile'), ctx(999_999_999))).status, 404)
    const res = await profileRoute.GET(req(`/api/marketing/products/${productId}/profile`), ctx(productId))
    assert.strictEqual(res.status, 200)
    const d = (await res.json()) as { profile: { buyers: unknown[] }; urgency: { kind: string; text: string | null }[]; policiesOnFile: boolean }
    assert.strictEqual(d.profile.buyers.length, 1)
    assert.deepStrictEqual(d.urgency.map((u) => u.kind), ['NONE', 'FEW_LEFT', 'OWN'])
    assert.strictEqual(d.urgency[1].text, 'Only 2 left in stock.')
    assert.strictEqual(d.policiesOnFile, true)
    const put = await profileRoute.PUT(req(`/api/marketing/products/${productId}/profile`, 'PUT', PROFILE), ctx(productId))
    assert.strictEqual(put.status, 200)
  })
})

describe('the brief on content', () => {
  test('is saved and validated; "my own reason" needs its words; other reasons never keep typed text', async () => {
    const c = await createContent(prisma, { title: 'ZPSELL brief', productId, channels: ['FACEBOOK_PAGE'], job: 'OFFER_CLOSE', reader: 'A parent, a wedding soon', message: 'She can play all day', proof: 'Soft cotton lining', urgencyKind: 'FEW_LEFT', urgencyText: 'ignored', action: 'Message us to order' }, owner.username)
    contentIds.push(c.id)
    assert.strictEqual(c.job, 'OFFER_CLOSE')
    assert.strictEqual(c.urgencyKind, 'FEW_LEFT')
    assert.strictEqual(c.urgencyText, null)
    assert.strictEqual(await status(createContent(prisma, { title: 'ZPSELL bad', job: 'SELL_HARD' }, owner.username)), 400)
    assert.strictEqual(await status(createContent(prisma, { title: 'ZPSELL bad', job: 'KEEP', urgencyKind: 'OWN' }, owner.username)), 400)
    assert.strictEqual(await status(updateContent(prisma, c.id, { urgencyKind: 'OWN', urgencyText: '' }, owner.username)), 400)
    const u = await updateContent(prisma, c.id, { urgencyKind: 'OWN', urgencyText: 'Order by Friday for the concert' }, owner.username)
    assert.strictEqual(u.urgencyText, 'Order by Friday for the concert')
    assert.strictEqual((await updateContent(prisma, c.id, { urgencyKind: 'FEW_LEFT' }, owner.username)).urgencyText, null)
  })

  test('the writer gets the brief with the reason worked out from live stock; openings and notes are kept on the post', async () => {
    const c = await createContent(prisma, { title: 'ZPSELL write', productId, channels: ['FACEBOOK_PAGE'], job: 'OFFER_CLOSE', reader: 'A parent, a wedding soon', message: 'She can play all day', proof: 'Soft cotton lining', urgencyKind: 'FEW_LEFT', action: 'Message us to order', brief: 'Mention the bows' }, owner.username)
    contentIds.push(c.id)
    let seen: DraftInput | null = null
    const write = async (i: DraftInput): Promise<DraftResult> => {
      seen = i
      return { drafts: [{ channel: 'FACEBOOK_PAGE', text: 'The words.', template: 'The words.', openings: ['Another way in.'], notes: ['Name the lining.'] }], failures: [], costCents: 4, writer: 'claude' }
    }
    const out = await draftContentPosts(prisma, c.id, { actor: owner.username, write })
    const input = seen as unknown as DraftInput
    assert.deepStrictEqual(input.plan, { job: 'OFFER_CLOSE', reader: 'A parent, a wedding soon', message: 'She can play all day', proof: 'Soft cotton lining', urgency: 'Only 2 left in stock.', action: 'Message us to order' })
    assert.strictEqual(input.brief, 'Mention the bows')
    assert.strictEqual(input.shop?.description, 'a test boutique')
    assert.deepStrictEqual(out.warnings, [])
    assert.deepStrictEqual(out.posts[0].aiOpenings, ['Another way in.'])
    assert.deepStrictEqual(out.posts[0].aiNotes, ['Name the lining.'])
    // The notes were about the AI's words: once the owner rewrites the post they are cleared.
    const edited = await updatePost(prisma, out.posts[0].id, { text: 'My own words now.' }, owner.username)
    assert.deepStrictEqual(edited.aiNotes, [])
    assert.deepStrictEqual(edited.aiOpenings, ['Another way in.'])
  })

  test('a reason that is no longer true is left out and the owner is told', async () => {
    const c = await createContent(prisma, { title: 'ZPSELL stale', productId, channels: ['TELEGRAM'], job: 'OFFER_CLOSE', urgencyKind: 'FEW_LEFT' }, owner.username)
    contentIds.push(c.id)
    await prisma.product.update({ where: { id: productId }, data: { currentQuantity: 40 } })
    try {
      let seen: DraftInput | null = null
      const out = await draftContentPosts(prisma, c.id, { actor: owner.username, write: async (i) => { seen = i; return { drafts: [], failures: [], costCents: 0, writer: 'claude' } } })
      const input = seen as unknown as DraftInput
      assert.strictEqual(input.plan?.urgency, null)
      assert.match(out.warnings[0], /no longer true/)
      // With no reader or message chosen, the selling profile fills them in.
      assert.strictEqual(input.plan?.reader, 'A parent, a family wedding in three weeks')
      assert.strictEqual(input.plan?.message, 'She can play all day')
    } finally {
      await prisma.product.update({ where: { id: productId }, data: { currentQuantity: 2 } })
    }
  })

  test('content made before the brief still writes: an offer, with the old words as the message', async () => {
    const c = await createContent(prisma, { title: 'ZPSELL old', brief: 'New dresses are in', productId, channels: ['TELEGRAM'] }, owner.username)
    contentIds.push(c.id)
    let seen: DraftInput | null = null
    await draftContentPosts(prisma, c.id, { actor: owner.username, write: async (i) => { seen = i; return { drafts: [], failures: [], costCents: 0, writer: 'claude' } } })
    const input = seen as unknown as DraftInput
    assert.strictEqual(input.plan?.job, 'OFFER_CLOSE')
    assert.strictEqual(input.plan?.message, 'New dresses are in')
    assert.strictEqual(input.brief, null)
    assert.strictEqual(input.plan?.urgency, null)
  })
})
