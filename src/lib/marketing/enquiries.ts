// VYRA Marketing Manager (ZP-1116, MM-11): customer enquiries and reply help. Server only.
// - A tap on a "Message us" button is a tap, never a conversation (AC1). An enquiry is a conversation the owner
//   recorded, or one a connected inbox saw (PROVIDER_OBSERVED). Counts keep the three apart.
// - The same inbound event never makes two enquiries; an unsure contact match waits for the owner (AC2).
// - VYRA never sends a reply here. A suggestion is text the owner copies; copying is recorded as copied, never as
//   delivered (AC3). Someone who has not agreed to offers gets service facts only, with nothing promotional (AC4).
// - Winning needs a real recorded sale and creates no money of its own. Reopening keeps every event (AC5).
// - An enquiry never gives marketing permission (MM-12-AC2): consent is only written in consent-records.ts.
import { Prisma, type MarketingEnquiry, type MarketingEnquiryEvent } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { isOptedIn, normalizePhone, type ConsentChannel } from './consent'
import { availabilityLine, availabilityOf, type TruthProduct } from './product-truth'
import { asObject, date, idList, int, onlyKeys, oneOf, text } from './validate'

const SHOP = 'vyra'

export const ENQUIRY_CHANNELS = ['WHATSAPP', 'PHONE', 'INSTAGRAM', 'FACEBOOK', 'EMAIL', 'IN_SHOP', 'OTHER'] as const
export type EnquiryChannel = (typeof ENQUIRY_CHANNELS)[number]
export const ENQUIRY_STATUSES = ['NEW', 'CONTACTED', 'WAITING', 'WON', 'LOST'] as const
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number]
export const OPEN_STATUSES: readonly EnquiryStatus[] = ['NEW', 'CONTACTED', 'WAITING']
export const CONVERSATION_KINDS = ['OWNER_RECORDED', 'PROVIDER_OBSERVED'] as const

export const ENQUIRY_STATUS_LABEL: Record<EnquiryStatus, string> = { NEW: 'New', CONTACTED: 'Contacted', WAITING: 'Waiting on them', WON: 'Won', LOST: 'Lost' }
export const CONVERSATION_LABEL: Record<string, string> = { OWNER_RECORDED: 'Recorded by you', PROVIDER_OBSERVED: 'Seen in the connected inbox' }

/** The consent channel a reply on this enquiry channel would use, if any. */
const CONSENT_CHANNEL_OF: Partial<Record<EnquiryChannel, ConsentChannel>> = { WHATSAPP: 'WHATSAPP', EMAIL: 'EMAIL', PHONE: 'SMS' }

export type EnquiryDto = Omit<MarketingEnquiry, 'shopKey' | 'productIds' | 'contactCandidates'> & {
  productIds: number[]
  contactCandidates: number[]
  contactName: string | null
}
export type EnquiryEventDto = MarketingEnquiryEvent

const ids = (v: Prisma.JsonValue): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [])
const bad = (m: string, field?: string) => new WebsiteError(400, m, field ? { field } : undefined)

function toDto(e: MarketingEnquiry & { contact?: { name: string | null } | null }): EnquiryDto {
  const { shopKey: _s, productIds, contactCandidates, contact, ...rest } = e
  void _s
  return { ...rest, productIds: ids(productIds), contactCandidates: ids(contactCandidates), contactName: contact?.name ?? null }
}

async function event(db: Db, enquiryId: number, kind: string, actor: string, o: { fromStatus?: string | null; toStatus?: string | null; detail?: Prisma.InputJsonValue } = {}) {
  await db.marketingEnquiryEvent.create({ data: { enquiryId, kind, actor, fromStatus: o.fromStatus ?? null, toStatus: o.toStatus ?? null, detail: o.detail } })
}

async function load(db: Db, id: number) {
  const e = await db.marketingEnquiry.findUnique({ where: { id }, include: { contact: { select: { name: true } } } })
  if (!e || e.shopKey !== SHOP) throw new WebsiteError(404, 'Enquiry not found')
  return e
}

/**
 * Who this is. A phone number that matches one contact is certain. A name alone (or a phone that matches nobody,
 * with a name that matches someone) is a guess: it is not linked, and the owner reviews the candidates.
 */
export async function matchContact(db: Db, who: { phone?: string | null; name?: string | null }): Promise<{ contactId: number | null; candidates: number[] }> {
  const phone = normalizePhone(who.phone)
  if (phone) {
    const byPhone = await db.marketingContact.findMany({ where: { shopKey: SHOP, phone }, select: { id: true } })
    if (byPhone.length === 1) return { contactId: byPhone[0].id, candidates: [] }
    if (byPhone.length > 1) return { contactId: null, candidates: byPhone.map((c) => c.id) }
  }
  const name = who.name?.trim()
  if (!name) return { contactId: null, candidates: [] }
  const byName = await db.marketingContact.findMany({ where: { shopKey: SHOP, name: { equals: name, mode: 'insensitive' } }, select: { id: true }, take: 10 })
  return { contactId: null, candidates: byName.map((c) => c.id) }
}

async function campaignOfTag(db: Db, tag: string): Promise<number | null> {
  const post = await db.marketingPost.findUnique({ where: { trackingTag: tag }, select: { content: { select: { campaignId: true } } } })
  if (post) return post.content?.campaignId ?? null
  const ad = await db.marketingAd.findFirst({ where: { trackingTag: tag }, select: { campaignId: true } })
  if (ad) return ad.campaignId ?? null
  throw bad('No post or ad has that tracking tag.', 'trackingTag')
}

async function checkProducts(db: Db, productIds: number[]) {
  if (productIds.length === 0) return
  const found = await db.product.count({ where: { id: { in: productIds } } })
  if (found !== productIds.length) throw bad('One of the products does not exist.', 'productIds')
}

const CREATE_KEYS = ['contactId', 'customerName', 'customerPhone', 'channelKind', 'sourceEvidence', 'trackingTag', 'campaignId', 'productIds', 'message', 'assignedTo', 'nextFollowUpAt'] as const

/** MM-11: the owner writes down an enquiry (a conversation they had). */
export async function createEnquiry(db: Db, body: unknown, actor: string): Promise<EnquiryDto> {
  const o = asObject(body)
  onlyKeys(o, CREATE_KEYS)
  const channelKind = oneOf(o.channelKind, 'channelKind', ENQUIRY_CHANNELS)
  const customerName = text(o.customerName, 'customerName', 200)
  const customerPhone = text(o.customerPhone, 'customerPhone', 40)
  const productIds = o.productIds === undefined ? [] : idList(o.productIds, 'productIds', 20)
  await checkProducts(db, productIds)
  const trackingTag = text(o.trackingTag, 'trackingTag', 64)
  let campaignId = o.campaignId === undefined || o.campaignId === null ? null : int(o.campaignId, 'campaignId', 1, 2 ** 31 - 1)
  if (trackingTag) {
    const fromTag = await campaignOfTag(db, trackingTag)
    if (campaignId && fromTag && campaignId !== fromTag) throw bad('That tracking tag belongs to another campaign.', 'campaignId')
    campaignId = fromTag ?? campaignId
  }
  if (campaignId && !(await db.marketingCampaign.findUnique({ where: { id: campaignId }, select: { id: true } }))) throw bad('Campaign not found.', 'campaignId')

  let contactId: number | null = null
  let candidates: number[] = []
  if (o.contactId !== undefined && o.contactId !== null) {
    contactId = int(o.contactId, 'contactId', 1, 2 ** 31 - 1)
    const c = await db.marketingContact.findUnique({ where: { id: contactId }, select: { shopKey: true } })
    if (!c || c.shopKey !== SHOP) throw bad('Contact not found.', 'contactId')
  } else {
    ;({ contactId, candidates } = await matchContact(db, { phone: customerPhone, name: customerName }))
  }
  if (!contactId && !customerName && !customerPhone) throw bad('Say who asked: choose a contact, or write a name or phone number.', 'customerName')

  const e = await db.marketingEnquiry.create({
    data: {
      shopKey: SHOP, contactId, customerName, customerPhone, channelKind, conversation: 'OWNER_RECORDED',
      sourceEvidence: text(o.sourceEvidence, 'sourceEvidence', 500), trackingTag, campaignId, productIds,
      message: text(o.message, 'message', 4000), assignedTo: text(o.assignedTo, 'assignedTo', 100) ?? actor,
      nextFollowUpAt: o.nextFollowUpAt === undefined ? null : date(o.nextFollowUpAt, 'nextFollowUpAt'),
      needsContactReview: candidates.length > 0, contactCandidates: candidates, createdBy: actor,
    },
  })
  await event(db, e.id, 'CREATED', actor, { toStatus: 'NEW', detail: { conversation: 'OWNER_RECORDED', channelKind, ...(candidates.length ? { contactCandidates: candidates } : {}) } })
  await writeAudit(db, { actor, action: 'enquiry.create', entity: 'enquiry', entityId: e.id, detail: { channelKind, contactId, campaignId } })
  return toDto(await load(db, e.id))
}

export interface InboundEvent {
  /** The provider's own id for this message. Required: it is what stops duplicates. */
  externalEventId: string
  channelKind: EnquiryChannel
  from: { phone?: string | null; name?: string | null }
  text?: string | null
  trackingTag?: string | null
}

/**
 * MM-11-AC2: a message a connected inbox saw. The same event id never makes a second enquiry, even when two
 * deliveries race. No inbox connector is switched on yet (connecting a real account is the owner's decision).
 */
export async function ingestInbound(db: Db, ev: InboundEvent, provider: string): Promise<{ enquiry: EnquiryDto; duplicate: boolean }> {
  const externalEventId = typeof ev.externalEventId === 'string' ? ev.externalEventId.trim().slice(0, 200) : ''
  if (!externalEventId) throw bad('An inbound event needs the provider event id.', 'externalEventId')
  if (!(ENQUIRY_CHANNELS as readonly string[]).includes(ev.channelKind)) throw bad('Unknown channel.', 'channelKind')
  const key = `${provider}:${externalEventId}`
  const seen = await db.marketingEnquiry.findUnique({ where: { externalEventId: key }, include: { contact: { select: { name: true } } } })
  if (seen) return { enquiry: toDto(seen), duplicate: true }
  const { contactId, candidates } = await matchContact(db, ev.from)
  let campaignId: number | null = null
  const tag = ev.trackingTag?.trim() || null
  if (tag) campaignId = await campaignOfTag(db, tag).catch(() => null)
  const actor = `provider:${provider}`
  try {
    const e = await db.marketingEnquiry.create({
      data: {
        shopKey: SHOP, contactId, customerName: ev.from.name?.trim().slice(0, 200) || null, customerPhone: normalizePhone(ev.from.phone) ?? ev.from.phone ?? null,
        channelKind: ev.channelKind, conversation: 'PROVIDER_OBSERVED', externalEventId: key, trackingTag: tag, campaignId,
        sourceEvidence: tag ? `Message carried the tag ${tag}` : null, message: ev.text?.slice(0, 4000) ?? null,
        needsContactReview: candidates.length > 0, contactCandidates: candidates, createdBy: actor,
      },
    })
    await event(db, e.id, 'CREATED', actor, { toStatus: 'NEW', detail: { conversation: 'PROVIDER_OBSERVED', externalEventId: key } })
    return { enquiry: toDto(await load(db, e.id)), duplicate: false }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const again = await db.marketingEnquiry.findUnique({ where: { externalEventId: key }, include: { contact: { select: { name: true } } } })
      if (again) return { enquiry: toDto(again), duplicate: true }
    }
    throw err
  }
}

/** MM-11-AC2: the owner settles an unsure match (or links a contact later). */
export async function setEnquiryContact(db: Db, id: number, body: unknown, actor: string): Promise<EnquiryDto> {
  const o = asObject(body)
  onlyKeys(o, ['contactId'])
  const e = await load(db, id)
  const contactId = o.contactId === null ? null : int(o.contactId, 'contactId', 1, 2 ** 31 - 1)
  if (contactId) {
    const c = await db.marketingContact.findUnique({ where: { id: contactId }, select: { shopKey: true } })
    if (!c || c.shopKey !== SHOP) throw bad('Contact not found.', 'contactId')
  }
  await db.marketingEnquiry.update({ where: { id }, data: { contactId, needsContactReview: false } })
  await event(db, id, 'CONTACT_SET', actor, { detail: { from: e.contactId, to: contactId, candidates: ids(e.contactCandidates) } })
  return toDto(await load(db, id))
}

/** Assign, set the next follow-up, or add a note. Every change is an event. */
export async function updateEnquiry(db: Db, id: number, body: unknown, actor: string): Promise<EnquiryDto> {
  const o = asObject(body)
  onlyKeys(o, ['assignedTo', 'nextFollowUpAt', 'note', 'productIds'])
  const e = await load(db, id)
  const data: Prisma.MarketingEnquiryUpdateInput = {}
  if (o.assignedTo !== undefined) {
    const to = text(o.assignedTo, 'assignedTo', 100)
    data.assignedTo = to
    await event(db, id, 'ASSIGNED', actor, { detail: { from: e.assignedTo, to } })
  }
  if (o.nextFollowUpAt !== undefined) {
    const at = date(o.nextFollowUpAt, 'nextFollowUpAt')
    data.nextFollowUpAt = at
    await event(db, id, 'FOLLOW_UP', actor, { detail: { from: e.nextFollowUpAt?.toISOString() ?? null, to: at?.toISOString() ?? null } })
  }
  if (o.productIds !== undefined) {
    const p = idList(o.productIds, 'productIds', 20)
    await checkProducts(db, p)
    data.productIds = p
    await event(db, id, 'NOTE', actor, { detail: { products: p } })
  }
  if (o.note !== undefined) {
    const note = text(o.note, 'note', 2000)
    if (!note) throw bad('Write the note.', 'note')
    await event(db, id, 'NOTE', actor, { detail: { note } })
  }
  if (Object.keys(data).length) await db.marketingEnquiry.update({ where: { id }, data })
  return toDto(await load(db, id))
}

/**
 * MM-11-AC5: move the enquiry. WON needs a real recorded sale (not cancelled, not linked to another enquiry) and
 * adds no money: the sale already counts. Moving away from WON unlinks the sale; every step stays in the history.
 */
export async function setEnquiryStatus(db: Db, id: number, body: unknown, actor: string): Promise<EnquiryDto> {
  const o = asObject(body)
  onlyKeys(o, ['status', 'saleId', 'lostReason'])
  const status = oneOf(o.status, 'status', ENQUIRY_STATUSES)
  const e = await load(db, id)
  if (e.status === status) throw new WebsiteError(409, `This enquiry is already ${ENQUIRY_STATUS_LABEL[status].toLowerCase()}.`)
  const data: Prisma.MarketingEnquiryUncheckedUpdateInput = { status, lostReason: null }
  if (status === 'WON') {
    if (o.saleId === undefined || o.saleId === null) throw bad('Choose the recorded sale this enquiry became. Winning never adds money by itself.', 'saleId')
    const saleId = int(o.saleId, 'saleId', 1, 2 ** 31 - 1)
    const sale = await db.sale.findUnique({ where: { id: saleId }, select: { id: true, status: true, saleDate: true } })
    if (!sale) throw bad('That sale is not recorded.', 'saleId')
    if (sale.status === 'CANCELLED') throw new WebsiteError(409, 'That sale was cancelled, so it cannot be the result of this enquiry.', { field: 'saleId' })
    const other = await db.marketingEnquiry.findUnique({ where: { saleId }, select: { id: true } })
    if (other && other.id !== id) throw new WebsiteError(409, `That sale is already the result of enquiry ${other.id}.`, { field: 'saleId' })
    data.saleId = saleId
    data.nextFollowUpAt = null
  } else {
    if (o.saleId !== undefined && o.saleId !== null) throw bad('Only a won enquiry has a sale.', 'saleId')
    data.saleId = null
    if (status === 'LOST') {
      data.lostReason = text(o.lostReason, 'lostReason', 500)
      data.nextFollowUpAt = null
    }
  }
  try {
    await db.marketingEnquiry.update({ where: { id }, data })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new WebsiteError(409, 'That sale is already the result of another enquiry.', { field: 'saleId' })
    throw err
  }
  if (e.saleId && data.saleId !== e.saleId) await event(db, id, 'SALE_UNLINKED', actor, { detail: { saleId: e.saleId } })
  await event(db, id, 'STATUS', actor, { fromStatus: e.status, toStatus: status, detail: { ...(data.lostReason ? { lostReason: data.lostReason as string } : {}), ...(e.status === 'WON' || e.status === 'LOST' ? { reopened: OPEN_STATUSES.includes(status) } : {}) } })
  if (status === 'WON') await event(db, id, 'SALE_LINKED', actor, { detail: { saleId: data.saleId as number } })
  await writeAudit(db, { actor, action: 'enquiry.status', entity: 'enquiry', entityId: id, detail: { from: e.status, to: status, saleId: (data.saleId as number | null) ?? null } })
  return toDto(await load(db, id))
}

export interface EnquiryFilter { status?: string; due?: boolean; q?: string }

export async function listEnquiries(db: Db, f: EnquiryFilter = {}, now = new Date()): Promise<EnquiryDto[]> {
  const where: Prisma.MarketingEnquiryWhereInput = { shopKey: SHOP }
  if (f.status === 'OPEN') where.status = { in: [...OPEN_STATUSES] }
  else if (f.status) where.status = oneOf(f.status, 'status', ENQUIRY_STATUSES)
  if (f.due) { where.nextFollowUpAt = { lte: now }; where.status = { in: [...OPEN_STATUSES] } }
  if (f.q?.trim()) where.OR = [{ customerName: { contains: f.q.trim(), mode: 'insensitive' } }, { customerPhone: { contains: f.q.trim() } }, { contact: { name: { contains: f.q.trim(), mode: 'insensitive' } } }]
  const rows = await db.marketingEnquiry.findMany({ where, include: { contact: { select: { name: true } } }, orderBy: [{ createdAt: 'desc' }], take: 200 })
  return rows.map(toDto)
}

export async function getEnquiry(db: Db, id: number): Promise<{ enquiry: EnquiryDto; events: EnquiryEventDto[] }> {
  const e = await load(db, id)
  const events = await db.marketingEnquiryEvent.findMany({ where: { enquiryId: id }, orderBy: { id: 'asc' } })
  return { enquiry: toDto(e), events }
}

// ─── Reply help ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReplySuggestion {
  kind: 'SERVICE' | 'WITH_OFFER'
  text: string
  /** Why this suggestion is or is not offered. */
  note: string
}

export interface ReplyFacts {
  customerName: string | null
  products: (TruthProduct & { priceUsd: number })[]
  /** The customer agreed to offers on the channel of this enquiry. */
  promotionAllowed: boolean
  delivery: string | null
}

const usd = (n: number) => `US$${n.toFixed(2).replace(/\.00$/, '')}`
const productName = (p: TruthProduct) => p.publicName?.trim() || p.productName

/** What may be said about one product right now, in a reply. Never invents stock, a date or a price. */
export function productReplyLine(p: TruthProduct & { priceUsd: number }): string {
  const a = availabilityOf(p)
  const name = productName(p)
  if (a.kind === 'WITHDRAWN') return `${name} is not available at the moment.`
  if (a.kind === 'SOLD_OUT') return `${name} is sold out at the moment.`
  const price = p.priceUsd > 0 ? ` It is ${usd(p.priceUsd)}.` : ''
  if (a.kind === 'IN_STOCK') return `${name} is in stock.${price}`
  return `${name}: ${availabilityLine(a).replace(/ Never give one\.| Not in stock yet\./g, '').trim()}${price}`
}

/**
 * MM-11-AC3/AC4: reply suggestions from current facts. The service reply answers what they asked and nothing more.
 * A second reply with an offer is only suggested when the customer agreed to offers on this channel.
 */
export function suggestReplies(f: ReplyFacts): ReplySuggestion[] {
  const hello = f.customerName ? `Hi ${f.customerName.split(/\s+/)[0]}, thank you for your message.` : 'Hi, thank you for your message.'
  const lines = f.products.map(productReplyLine)
  const delivery = f.delivery?.trim() ? `Delivery: ${f.delivery.trim()}` : null
  const service = [hello, ...lines, ...(delivery ? [delivery] : []), lines.length ? 'Would you like me to keep one for you?' : 'How can I help?'].join(' ')
  const out: ReplySuggestion[] = [{ kind: 'SERVICE', text: service, note: 'Answers their question only. Fine to send to anyone who asked.' }]
  if (f.promotionAllowed) {
    out.push({ kind: 'WITH_OFFER', text: `${service} We also add new pieces every week: I can send you a message when something new comes in.`, note: 'They agreed to offers on this channel, so a mention of new pieces is allowed.' })
  }
  return out
}

/** Whether this text carries promotion (used to keep service replies clean). */
export function looksPromotional(t: string): boolean {
  return /\b(new (pieces|arrivals|stock)|sale|discount|% off|offer|promo|special price|limited time|follow us|subscribe)\b/i.test(t)
}

export async function replySuggestions(db: Db, id: number): Promise<ReplySuggestion[]> {
  const e = await load(db, id)
  const productIds = ids(e.productIds)
  const products = productIds.length
    ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, productName: true, publicName: true, published: true, listingType: true, currentQuantity: true, preorderShipFrom: true, preorderShipTo: true, sellingPriceUsd: true } })
    : []
  const settings = await db.marketingSettings.findUnique({ where: { id: 1 }, select: { policyDelivery: true } })
  const channel = CONSENT_CHANNEL_OF[e.channelKind as EnquiryChannel]
  let promotionAllowed = false
  if (e.contactId && channel) {
    const rows = await db.marketingConsent.findMany({ where: { contactId: e.contactId, channel } })
    promotionAllowed = isOptedIn(rows, channel, 'PROMOTION')
  }
  return suggestReplies({
    customerName: e.contact?.name ?? e.customerName,
    products: products.map((p) => ({ ...p, listingType: String(p.listingType), priceUsd: p.sellingPriceUsd })),
    promotionAllowed,
    delivery: settings?.policyDelivery ?? null,
  })
}

/**
 * MM-11-AC3: the owner used a reply. COPIED means it was copied to send by hand (VYRA did not send it and does
 * not know if it arrived). SENT_BY_OWNER means the owner says they sent it themselves. Neither is a delivery.
 * A reply with an offer is refused when the customer has not agreed to offers (AC4).
 */
export async function recordReply(db: Db, id: number, body: unknown, actor: string): Promise<EnquiryDto> {
  const o = asObject(body)
  onlyKeys(o, ['text', 'action'])
  const action = oneOf(o.action, 'action', ['COPIED', 'SENT_BY_OWNER'] as const)
  const replyText = text(o.text, 'text', 4000)
  if (!replyText) throw bad('The reply is empty.', 'text')
  const e = await load(db, id)
  if (looksPromotional(replyText)) {
    const allowed = (await replySuggestions(db, id)).some((s) => s.kind === 'WITH_OFFER')
    if (!allowed) throw new WebsiteError(409, 'This person has not agreed to offers on this channel. Send a service reply only: answer what they asked, with no offers or news.', { field: 'text' })
  }
  await event(db, id, action === 'COPIED' ? 'REPLY_COPIED' : 'REPLY_SENT_BY_OWNER', actor, { detail: { text: replyText, delivered: 'unknown' } })
  if (e.status === 'NEW') {
    await db.marketingEnquiry.update({ where: { id }, data: { status: 'CONTACTED' } })
    await event(db, id, 'STATUS', actor, { fromStatus: 'NEW', toStatus: 'CONTACTED', detail: { because: action } })
  }
  return toDto(await load(db, id))
}

// ─── Counts ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EnquiryCounts {
  /** Taps on "Message us" buttons on the website. A tap opens WhatsApp; it is not a conversation. */
  taps: number
  ownerRecorded: number
  providerObserved: number
  won: number
}

/** MM-11-AC1: taps, recorded conversations and inbox conversations, never added together. */
export async function enquiryCounts(db: Db, range: { from: Date; to: Date }): Promise<EnquiryCounts> {
  const taps = await db.analyticsDailySource.aggregate({ where: { day: { gte: range.from, lte: range.to } }, _sum: { enquiringVisits: true } })
  const rows = await db.marketingEnquiry.groupBy({ by: ['conversation'], where: { shopKey: SHOP, createdAt: { gte: range.from, lte: range.to } }, _count: { _all: true } })
  const won = await db.marketingEnquiry.count({ where: { shopKey: SHOP, status: 'WON', createdAt: { gte: range.from, lte: range.to } } })
  const of = (k: string) => rows.find((r) => r.conversation === k)?._count._all ?? 0
  return { taps: taps._sum.enquiringVisits ?? 0, ownerRecorded: of('OWNER_RECORDED'), providerObserved: of('PROVIDER_OBSERVED'), won }
}
