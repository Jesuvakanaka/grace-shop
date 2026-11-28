// ZP-1116 (MM-11) and ZP-1117 (MM-12-AC2): enquiries, reply help and the line between service and promotion.
// Against DATABASE_URL. Only touches rows it creates: contacts and enquiries named "ZP1116 *", products ZP1116-*,
// a campaign, content and post it makes, sales on 2033-01 dates, analytics rows on 2033-01 days.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import {
  createEnquiry, enquiryCounts, getEnquiry, ingestInbound, listEnquiries, looksPromotional, productReplyLine, recordReply,
  replySuggestions, setEnquiryContact, setEnquiryStatus, suggestReplies, updateEnquiry,
} from '../src/lib/marketing/enquiries'
import { createContact, recordConsent } from '../src/lib/marketing/contacts'
import { isOptedIn } from '../src/lib/marketing/consent'
import { WebsiteError } from '../src/lib/website/http'

const OWNER = 'zp1116-owner'
const at = (day: string) => new Date(`${day}T10:00:00.000Z`)
const rejects = async (fn: () => Promise<unknown>, status: number, re?: RegExp) => {
  await assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))
}
const tag = `zp1116${Date.now().toString(36)}`
const phone = (n: number) => `+26377${String(Date.now() % 1000000).padStart(6, '0')}${n}`

const contactIds: number[] = []
const productIds: number[] = []
const saleIds: number[] = []
let campaignId = 0
let contentId = 0
let postId = 0
const ctx = { yes: 0, no: 0, yesPhone: '', noPhone: '', inStock: 0, soldOut: 0, preorder: 0 }

before(async () => {
  campaignId = (await prisma.marketingCampaign.create({ data: { name: 'ZP1116 campaign', status: 'ACTIVE' } })).id
  contentId = (await prisma.marketingContent.create({ data: { title: 'ZP1116 content', campaignId, createdBy: OWNER } })).id
  postId = (await prisma.marketingPost.create({ data: { contentId, channelKind: 'INSTAGRAM', text: 'x', trackingTag: `${tag}p`, status: 'PUBLISHED', publishedAt: at('2033-01-01') } })).id
  ctx.yesPhone = phone(1); ctx.noPhone = phone(2)
  const yes = await createContact(prisma, { name: 'ZP1116 Tendai', phone: ctx.yesPhone }, OWNER)
  const no = await createContact(prisma, { name: 'ZP1116 Rudo', phone: ctx.noPhone }, OWNER)
  ctx.yes = yes.id; ctx.no = no.id
  contactIds.push(yes.id, no.id)
  await recordConsent(prisma, yes.id, { channel: 'WHATSAPP', status: 'OPTED_IN', method: 'said yes on WhatsApp', evidence: 'chat 1 Jan' }, OWNER)
  await recordConsent(prisma, no.id, { channel: 'WHATSAPP', status: 'OPTED_IN', method: 'said yes on WhatsApp', evidence: 'chat 1 Jan' }, OWNER)
  await recordConsent(prisma, no.id, { channel: 'WHATSAPP', status: 'OPTED_OUT', method: 'replied STOP' }, OWNER)
  const mk = async (n: number, o: Record<string, unknown>) => {
    const p = await prisma.product.create({ data: { itemNumber: `ZP1116-${n}`, productName: `ZP1116 dress ${n}`, sellingPriceUsd: 25, published: true, currentQuantity: 3, ...o } })
    productIds.push(p.id)
    return p.id
  }
  ctx.inStock = await mk(1, {})
  ctx.soldOut = await mk(2, { currentQuantity: 0 })
  ctx.preorder = await mk(3, { listingType: 'PRE_ORDER', currentQuantity: 0, preorderShipFrom: new Date('2033-02-01T00:00:00Z'), preorderShipTo: new Date('2033-02-10T00:00:00Z') })
})

after(async () => {
  await prisma.marketingEnquiry.deleteMany({ where: { OR: [{ contactId: { in: contactIds } }, { customerName: { startsWith: 'ZP1116' } }, { createdBy: OWNER }, { externalEventId: { startsWith: 'zp1116' } }] } })
  await prisma.marketingConsent.deleteMany({ where: { contactId: { in: contactIds } } })
  await prisma.marketingContact.deleteMany({ where: { id: { in: contactIds } } })
  await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } })
  await prisma.sale.deleteMany({ where: { id: { in: saleIds } } })
  await prisma.marketingPost.deleteMany({ where: { id: postId } })
  await prisma.marketingContent.deleteMany({ where: { id: contentId } })
  await prisma.marketingCampaign.deleteMany({ where: { id: campaignId } })
  await prisma.product.deleteMany({ where: { id: { in: productIds } } })
  await prisma.analyticsDailySource.deleteMany({ where: { campaign: tag } })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: OWNER } })
  await prisma.$disconnect()
})

const recordedSale = async (o: { status?: string } = {}) => {
  const s = await prisma.sale.create({ data: { saleDate: at('2033-01-05'), paymentType: 'CASH', totalAmount: 25, cashAmount: 25, status: o.status ?? 'COMPLETED' } })
  saleIds.push(s.id)
  return s.id
}

describe('reply suggestions (pure)', () => {
  const base = { id: 1, productName: 'Linen dress', publicName: null, published: true, listingType: 'IN_STOCK', currentQuantity: 2, preorderShipFrom: null, preorderShipTo: null, priceUsd: 25 }
  test('product lines say only what is true now', () => {
    assert.strictEqual(productReplyLine(base), 'Linen dress is in stock. It is US$25.')
    assert.strictEqual(productReplyLine({ ...base, currentQuantity: 0 }), 'Linen dress is sold out at the moment.')
    assert.strictEqual(productReplyLine({ ...base, published: false }), 'Linen dress is not available at the moment.')
    assert.match(productReplyLine({ ...base, listingType: 'PRE_ORDER', currentQuantity: 0, preorderShipFrom: new Date('2033-02-01T00:00:00Z'), preorderShipTo: null }), /pre-order: ships from 1 February 2033/)
    assert.doesNotMatch(productReplyLine({ ...base, listingType: 'PRE_ORDER', currentQuantity: 0 }), /ships (from|between)/, 'no invented date')
  })
  test('MM-11-AC4: without consent to offers, only a service reply, with nothing promotional', () => {
    const s = suggestReplies({ customerName: 'Rudo Moyo', products: [base], promotionAllowed: false, delivery: null })
    assert.deepStrictEqual(s.map((x) => x.kind), ['SERVICE'])
    assert.ok(!looksPromotional(s[0].text), s[0].text)
    assert.match(s[0].text, /^Hi Rudo,/)
    assert.doesNotMatch(s[0].text, /deliver/i, 'unknown delivery policy is never said')
  })
  test('with consent to offers there is a second suggestion; the service one stays clean', () => {
    const s = suggestReplies({ customerName: null, products: [], promotionAllowed: true, delivery: 'Harare CBD, US$3' })
    assert.deepStrictEqual(s.map((x) => x.kind), ['SERVICE', 'WITH_OFFER'])
    assert.ok(!looksPromotional(s[0].text))
    assert.ok(looksPromotional(s[1].text))
    assert.match(s[0].text, /Delivery: Harare CBD, US\$3/)
  })
})

describe('MM-11-AC1: a tap is a tap; recorded and inbox conversations are told apart', () => {
  test('counts keep taps, owner-recorded and provider-observed apart', async () => {
    const day = new Date('2033-01-03T00:00:00')
    const range = { from: new Date('2033-01-01T00:00:00'), to: new Date('2033-01-31T23:59:59') }
    const before = await enquiryCounts(prisma, range)
    await prisma.analyticsDailySource.create({ data: { day, source: 'instagram', deviceClass: 'phone', campaign: tag, visits: 10, enquiringVisits: 4 } })
    const e = await createEnquiry(prisma, { customerName: 'ZP1116 Walk-in', channelKind: 'IN_SHOP' }, OWNER)
    await prisma.marketingEnquiry.update({ where: { id: e.id }, data: { createdAt: at('2033-01-03') } })
    const r = await ingestInbound(prisma, { externalEventId: 'wamid.1', channelKind: 'WHATSAPP', from: { phone: ctx.yesPhone }, text: 'Is the dress available?' }, 'zp1116')
    await prisma.marketingEnquiry.update({ where: { id: r.enquiry.id }, data: { createdAt: at('2033-01-03') } })
    const after = await enquiryCounts(prisma, range)
    assert.strictEqual(after.taps - before.taps, 4, 'taps come from the website rollup')
    assert.strictEqual(after.ownerRecorded - before.ownerRecorded, 1)
    assert.strictEqual(after.providerObserved - before.providerObserved, 1)
    assert.strictEqual(e.conversation, 'OWNER_RECORDED')
    assert.strictEqual(r.enquiry.conversation, 'PROVIDER_OBSERVED')
  })
})

describe('MM-11-AC2: duplicates and unsure matches', () => {
  test('the same inbound event twice makes one enquiry, also when two arrive at once', async () => {
    const ev = { externalEventId: 'wamid.dup', channelKind: 'WHATSAPP' as const, from: { phone: ctx.yesPhone }, text: 'Hello' }
    const [a, b] = await Promise.all([ingestInbound(prisma, ev, 'zp1116'), ingestInbound(prisma, ev, 'zp1116')])
    const c = await ingestInbound(prisma, ev, 'zp1116')
    assert.strictEqual(a.enquiry.id, b.enquiry.id)
    assert.strictEqual(c.enquiry.id, a.enquiry.id)
    assert.strictEqual(c.duplicate, true)
    assert.strictEqual(await prisma.marketingEnquiry.count({ where: { externalEventId: 'zp1116:wamid.dup' } }), 1)
    assert.strictEqual(a.enquiry.contactId, ctx.yes, 'a phone that matches one contact is certain')
    await rejects(() => ingestInbound(prisma, { ...ev, externalEventId: '' }, 'zp1116'), 400, /event id/)
  })
  test('a name alone is a guess: not linked, waits for review, and the owner settles it', async () => {
    const e = await createEnquiry(prisma, { customerName: 'zp1116 tendai', channelKind: 'INSTAGRAM' }, OWNER)
    assert.strictEqual(e.contactId, null)
    assert.strictEqual(e.needsContactReview, true)
    assert.deepStrictEqual(e.contactCandidates, [ctx.yes])
    const settled = await setEnquiryContact(prisma, e.id, { contactId: ctx.yes }, OWNER)
    assert.strictEqual(settled.contactId, ctx.yes)
    assert.strictEqual(settled.needsContactReview, false)
    const { events } = await getEnquiry(prisma, e.id)
    assert.deepStrictEqual(events.map((x) => x.kind), ['CREATED', 'CONTACT_SET'])
  })
  test('an enquiry needs to say who asked; a fake tag, a missing product or campaign is refused', async () => {
    await rejects(() => createEnquiry(prisma, { channelKind: 'WHATSAPP' }, OWNER), 400, /Say who asked/)
    await rejects(() => createEnquiry(prisma, { customerName: 'ZP1116 X', channelKind: 'WHATSAPP', trackingTag: 'nope-nope' }, OWNER), 400, /tracking tag/)
    await rejects(() => createEnquiry(prisma, { customerName: 'ZP1116 X', channelKind: 'WHATSAPP', productIds: [987654321] }, OWNER), 400, /products/)
    const e = await createEnquiry(prisma, { customerName: 'ZP1116 Tagged', channelKind: 'INSTAGRAM', trackingTag: `${tag}p`, sourceEvidence: 'Sent the reel' }, OWNER)
    assert.strictEqual(e.campaignId, campaignId, 'the campaign comes from the tag')
  })
})

describe('MM-11-AC3/AC4: replies are copied, never sent; opted-out people get service facts only', () => {
  test('suggestions use the current stock and price; copying records "copied", never delivered', async () => {
    const e = await createEnquiry(prisma, { contactId: ctx.no, channelKind: 'WHATSAPP', productIds: [ctx.inStock, ctx.soldOut, ctx.preorder], message: 'Do you have these?' }, OWNER)
    const s = await replySuggestions(prisma, e.id)
    assert.deepStrictEqual(s.map((x) => x.kind), ['SERVICE'], 'opted out: service only')
    assert.match(s[0].text, /ZP1116 dress 1 is in stock\. It is US\$25\./)
    assert.match(s[0].text, /ZP1116 dress 2 is sold out/)
    assert.match(s[0].text, /ZP1116 dress 3: On pre-order: ships between 1 February 2033 and 10 February 2033/)
    const after = await recordReply(prisma, e.id, { text: s[0].text, action: 'COPIED' }, OWNER)
    assert.strictEqual(after.status, 'CONTACTED')
    const { events } = await getEnquiry(prisma, e.id)
    const copied = events.find((x) => x.kind === 'REPLY_COPIED')
    assert.deepStrictEqual((copied?.detail as { delivered: string }).delivered, 'unknown')
    assert.ok(!events.some((x) => /DELIVERED|SENT$/.test(x.kind)), 'nothing claims delivery')
    await rejects(() => recordReply(prisma, e.id, { text: `${s[0].text} New arrivals every week, 10% off!`, action: 'SENT_BY_OWNER' }, OWNER), 409, /not agreed to offers/)
  })
  test('someone who agreed to offers gets the extra suggestion, and may be sent it', async () => {
    const e = await createEnquiry(prisma, { contactId: ctx.yes, channelKind: 'WHATSAPP', productIds: [ctx.inStock] }, OWNER)
    const s = await replySuggestions(prisma, e.id)
    assert.deepStrictEqual(s.map((x) => x.kind), ['SERVICE', 'WITH_OFFER'])
    await recordReply(prisma, e.id, { text: s[1].text, action: 'SENT_BY_OWNER' }, OWNER)
    const { events } = await getEnquiry(prisma, e.id)
    assert.ok(events.some((x) => x.kind === 'REPLY_SENT_BY_OWNER'))
  })
})

describe('MM-11-AC5: winning needs a real sale and adds no money; reopening keeps history', () => {
  test('won with a recorded sale, then reopened, then lost: every step stays', async () => {
    const e = await createEnquiry(prisma, { contactId: ctx.yes, channelKind: 'WHATSAPP', nextFollowUpAt: at('2033-01-06').toISOString() }, OWNER)
    await rejects(() => setEnquiryStatus(prisma, e.id, { status: 'WON' }, OWNER), 400, /recorded sale/)
    await rejects(() => setEnquiryStatus(prisma, e.id, { status: 'WON', saleId: 987654321 }, OWNER), 400, /not recorded/)
    const cancelled = await recordedSale({ status: 'CANCELLED' })
    await rejects(() => setEnquiryStatus(prisma, e.id, { status: 'WON', saleId: cancelled }, OWNER), 409, /cancelled/)
    const saleId = await recordedSale()
    const salesBefore = await prisma.sale.aggregate({ _sum: { totalAmount: true }, _count: true })
    const won = await setEnquiryStatus(prisma, e.id, { status: 'WON', saleId }, OWNER)
    assert.strictEqual(won.saleId, saleId)
    assert.strictEqual(won.nextFollowUpAt, null)
    const salesAfter = await prisma.sale.aggregate({ _sum: { totalAmount: true }, _count: true })
    assert.deepStrictEqual(salesAfter, salesBefore, 'winning creates no sale and no money')
    const other = await createEnquiry(prisma, { contactId: ctx.yes, channelKind: 'PHONE' }, OWNER)
    await rejects(() => setEnquiryStatus(prisma, other.id, { status: 'WON', saleId }, OWNER), 409, /already the result/)
    const reopened = await setEnquiryStatus(prisma, e.id, { status: 'CONTACTED' }, OWNER)
    assert.strictEqual(reopened.saleId, null)
    const lost = await setEnquiryStatus(prisma, e.id, { status: 'LOST', lostReason: 'Bought elsewhere' }, OWNER)
    assert.strictEqual(lost.lostReason, 'Bought elsewhere')
    const { events } = await getEnquiry(prisma, e.id)
    assert.deepStrictEqual(events.map((x) => [x.kind, x.fromStatus, x.toStatus]), [
      ['CREATED', null, 'NEW'], ['STATUS', 'NEW', 'WON'], ['SALE_LINKED', null, null],
      ['SALE_UNLINKED', null, null], ['STATUS', 'WON', 'CONTACTED'], ['STATUS', 'CONTACTED', 'LOST'],
    ])
    assert.strictEqual((events[4].detail as { reopened: boolean }).reopened, true)
    await rejects(() => setEnquiryStatus(prisma, e.id, { status: 'LOST' }, OWNER), 409, /already lost/)
  })
  test('follow-ups, assignment and notes are events; due follow-ups are listed', async () => {
    const e = await createEnquiry(prisma, { customerName: 'ZP1116 Due', channelKind: 'PHONE' }, OWNER)
    await updateEnquiry(prisma, e.id, { assignedTo: 'grace', nextFollowUpAt: at('2033-01-02').toISOString(), note: 'Call after 5' }, OWNER)
    const due = await listEnquiries(prisma, { due: true, q: 'ZP1116 Due' }, at('2033-01-03'))
    assert.deepStrictEqual(due.map((x) => x.id), [e.id])
    const notYet = await listEnquiries(prisma, { due: true, q: 'ZP1116 Due' }, at('2033-01-01'))
    assert.deepStrictEqual(notYet, [])
    const { events } = await getEnquiry(prisma, e.id)
    assert.deepStrictEqual(events.map((x) => x.kind), ['CREATED', 'ASSIGNED', 'FOLLOW_UP', 'NOTE'])
  })
})

describe('MM-12-AC2: an enquiry or a purchase never gives permission for offers', () => {
  test('a new contact who enquired and bought has no promotional consent', async () => {
    const c = await createContact(prisma, { name: 'ZP1116 Buyer', phone: phone(3) }, OWNER, 'ENQUIRY')
    contactIds.push(c.id)
    const e = await createEnquiry(prisma, { contactId: c.id, channelKind: 'WHATSAPP' }, OWNER)
    await setEnquiryStatus(prisma, e.id, { status: 'WON', saleId: await recordedSale() }, OWNER)
    const rows = await prisma.marketingConsent.findMany({ where: { contactId: c.id } })
    assert.deepStrictEqual(rows, [])
    assert.strictEqual(isOptedIn(rows, 'WHATSAPP'), false)
    assert.deepStrictEqual((await replySuggestions(prisma, e.id)).map((x) => x.kind), ['SERVICE'])
  })
})
