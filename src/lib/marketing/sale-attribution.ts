// VYRA Marketing Manager (ZP-1118, MM-13): which campaign a sale is credited to, and the sales report. Server only.
// - The sales ledger stays the one source of money (Sale, SaleRefund, debtor payments). This file never copies an
//   amount: it stores only the link, and the report reads the ledger every time.
// - One row per sale (unique saleId): linking the same sale again replaces the link and never adds money (AC1).
// - One primary campaign per sale; other touchpoints are notes only (AC2).
// - Evidence decides the source: TRACKED_LINK needs a real tracking tag of a post or ad in a campaign;
//   CUSTOMER_REPORTED needs the customer's own words. Evidence pointing at more than one campaign stays UNKNOWN
//   until the owner reviews it (AC2). Unknown sales are listed, never credited (AC3).
// - A link is association, not proof the campaign caused the sale. A sale after the campaign ended may still be
//   linked; it keeps its real date (AC4).
// - Payment evidence is separate from attribution: OWNER_RECORDED (the owner's own sale record) or
//   PAYMENT_CONFIRMED (something else confirms the money, for example a mobile money reference).
import type { MarketingSaleAttribution, Prisma } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { loadLedger } from '@/lib/sale-ledger-db'
import { ATTRIBUTION_SOURCES, fromCents, ledgerDay, salesReport, type AttributionSource, type MoneyTotals, type SalesReport } from '@/lib/sales-ledger'
import { writeAudit, type Db } from './audit'
import { CHANNEL_KINDS } from './channels'

export const PAYMENT_EVIDENCE = ['OWNER_RECORDED', 'PAYMENT_CONFIRMED'] as const
export type PaymentEvidence = (typeof PAYMENT_EVIDENCE)[number]

export const ATTRIBUTION_NOTE = 'A link shows the sale came after this campaign reached the customer. It does not prove the campaign caused it.'

export interface AttributionDto {
  saleId: number
  source: AttributionSource
  campaignId: number | null
  campaignName: string | null
  postId: number | null
  channelKind: string | null
  contactId: number | null
  evidence: string | null
  touchpoints: string[]
  candidateCampaignIds: number[]
  needsReview: boolean
  credited: boolean
  paymentEvidence: PaymentEvidence
  paymentNote: string | null
  /** The sale's own date, unchanged by the link. */
  saleDate: string
  /** True when the sale came after the campaign's end date (still allowed). */
  afterCampaignEnd: boolean
  reviewedBy: string | null
  reviewedAt: string | null
  updatedBy: string
  updatedAt: string
}

interface Stored {
  notes: string[]
  candidates: number[]
}
function readTouchpoints(raw: unknown): Stored {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const list = Array.isArray(raw) ? raw : Array.isArray(o.notes) ? o.notes : []
  return {
    notes: list.filter((x): x is string => typeof x === 'string'),
    candidates: Array.isArray(o.candidates) ? o.candidates.filter((x): x is number => Number.isInteger(x)) : [],
  }
}

function toDto(a: MarketingSaleAttribution, sale: { saleDate: Date }, campaign: { name: string; endsAt: Date | null } | null): AttributionDto {
  const t = readTouchpoints(a.touchpoints)
  const credited = Boolean(a.campaignId && a.source !== 'UNKNOWN' && !a.needsReview)
  return {
    saleId: a.saleId,
    source: a.source as AttributionSource,
    campaignId: a.campaignId,
    campaignName: campaign?.name ?? null,
    postId: a.postId,
    channelKind: a.channelKind,
    contactId: a.contactId,
    evidence: a.evidence,
    touchpoints: t.notes,
    candidateCampaignIds: t.candidates,
    needsReview: a.needsReview,
    credited,
    paymentEvidence: a.paymentEvidence as PaymentEvidence,
    paymentNote: a.paymentNote,
    saleDate: ledgerDay(sale.saleDate),
    afterCampaignEnd: Boolean(credited && campaign?.endsAt && sale.saleDate > campaign.endsAt),
    reviewedBy: a.reviewedBy,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    updatedBy: a.updatedBy,
    updatedAt: a.updatedAt.toISOString(),
  }
}

export async function getAttribution(db: Db, saleId: number): Promise<AttributionDto | null> {
  const a = await db.marketingSaleAttribution.findUnique({ where: { saleId }, include: { sale: { select: { saleDate: true } } } })
  if (!a) return null
  const c = a.campaignId ? await db.marketingCampaign.findUnique({ where: { id: a.campaignId }, select: { name: true, endsAt: true } }) : null
  return toDto(a, a.sale, c)
}

const LINK_KEYS = ['source', 'campaignId', 'trackingTag', 'channelKind', 'contactId', 'evidence', 'touchpoints', 'candidateCampaignIds', 'paymentEvidence', 'paymentNote'] as const

const str = (v: unknown, field: string, max: number): string | null => {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') throw new WebsiteError(400, `${field} must be text.`, { field })
  const t = v.replace(/\s+/g, ' ').trim()
  if (t.length > max) throw new WebsiteError(400, `${field} is too long (at most ${max} characters).`, { field })
  return t || null
}
const id = (v: unknown, field: string): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw new WebsiteError(400, `${field} must be an id.`, { field })
  return n
}

interface Resolved {
  source: AttributionSource
  campaignId: number | null
  postId: number | null
  channelKind: string | null
  evidence: string | null
  candidates: number[]
  needsReview: boolean
}

/** The tracking tag of a post or ad: its campaign and channel. */
async function fromTag(db: Db, tag: string): Promise<{ campaignId: number | null; postId: number | null; channelKind: string; wentOutAt: Date | null; what: string }> {
  const post = await db.marketingPost.findUnique({ where: { trackingTag: tag }, select: { id: true, channelKind: true, publishedAt: true, content: { select: { campaignId: true } } } })
  if (post) return { campaignId: post.content.campaignId, postId: post.id, channelKind: post.channelKind, wentOutAt: post.publishedAt, what: 'post' }
  const ad = await db.marketingAd.findUnique({ where: { trackingTag: tag }, select: { campaignId: true, channelKind: true, activatedAt: true } })
  if (ad) return { campaignId: ad.campaignId, postId: null, channelKind: ad.channelKind, wentOutAt: ad.activatedAt, what: 'ad' }
  throw new WebsiteError(400, 'That tracking tag does not belong to any post or ad.', { field: 'trackingTag' })
}

/**
 * A campaign cannot be credited with a sale made before it began (its start date, or when it was created when it has
 * no start date). A sale after the campaign ended stays allowed (MM-13-AC4).
 */
async function assertCampaignBefore(db: Db, campaignId: number, saleDate: Date) {
  const c = await db.marketingCampaign.findUnique({ where: { id: campaignId }, select: { name: true, startsAt: true, createdAt: true } })
  if (!c) throw new WebsiteError(400, 'That campaign does not exist.', { field: 'campaignId' })
  const began = c.startsAt ?? c.createdAt
  if (began > saleDate) throw new WebsiteError(409, `The sale was made before "${c.name}" began, so it cannot be credited to it.`, { field: 'campaignId' })
}

async function resolve(db: Db, o: Record<string, unknown>, saleDate: Date): Promise<Resolved> {
  const source = (o.source ?? 'UNKNOWN') as AttributionSource
  if (!ATTRIBUTION_SOURCES.includes(source)) throw new WebsiteError(400, 'Choose where the sale came from: TRACKED_LINK, CUSTOMER_REPORTED or UNKNOWN.', { field: 'source' })
  const candidates = Array.isArray(o.candidateCampaignIds) ? [...new Set(o.candidateCampaignIds.map((c) => id(c, 'candidateCampaignIds')!))] : []
  if (o.candidateCampaignIds !== undefined && !Array.isArray(o.candidateCampaignIds)) throw new WebsiteError(400, 'candidateCampaignIds must be a list.', { field: 'candidateCampaignIds' })
  for (const c of candidates) if (!(await db.marketingCampaign.findUnique({ where: { id: c }, select: { id: true } }))) throw new WebsiteError(400, 'One of the campaigns does not exist.', { field: 'candidateCampaignIds' })
  let channelKind = str(o.channelKind, 'channelKind', 40)
  if (channelKind && !CHANNEL_KINDS.includes(channelKind)) throw new WebsiteError(400, 'That channel is not known.', { field: 'channelKind' })
  const evidence = str(o.evidence, 'evidence', 300)
  let campaignId = id(o.campaignId, 'campaignId')

  // Evidence that points at more than one campaign: not credited until the owner chooses (AC2).
  if (candidates.length > 1) {
    if (campaignId) throw new WebsiteError(400, 'Give one campaign, or a list of possible campaigns to review, not both.', { field: 'campaignId' })
    return { source: 'UNKNOWN', campaignId: null, postId: null, channelKind, evidence, candidates, needsReview: true }
  }
  if (candidates.length === 1 && !campaignId) campaignId = candidates[0]

  if (source === 'UNKNOWN') {
    if (campaignId) throw new WebsiteError(400, 'An unknown source has no campaign. Choose TRACKED_LINK or CUSTOMER_REPORTED to credit one.', { field: 'campaignId' })
    return { source, campaignId: null, postId: null, channelKind, evidence, candidates: [], needsReview: false }
  }
  if (source === 'TRACKED_LINK') {
    const tag = str(o.trackingTag, 'trackingTag', 40)
    if (!tag) throw new WebsiteError(400, 'A tracked link needs the tracking tag the customer came with.', { field: 'trackingTag' })
    const t = await fromTag(db, tag.toLowerCase())
    if (!t.campaignId) throw new WebsiteError(409, 'That post or ad is not part of a campaign, so there is no campaign to credit.', { field: 'trackingTag' })
    if (campaignId && campaignId !== t.campaignId) throw new WebsiteError(409, 'The tracking tag belongs to a different campaign.', { field: 'campaignId' })
    if (channelKind && channelKind !== t.channelKind) throw new WebsiteError(409, 'The tracking tag belongs to a different channel.', { field: 'channelKind' })
    if (!t.wentOutAt || t.wentOutAt > saleDate) throw new WebsiteError(409, `That ${t.what} had not gone out when the sale was made, so the sale cannot have come from its link.`, { field: 'trackingTag' })
    await assertCampaignBefore(db, t.campaignId, saleDate)
    return { source, campaignId: t.campaignId, postId: t.postId, channelKind: t.channelKind, evidence: tag.toLowerCase(), candidates: [], needsReview: false }
  }
  // CUSTOMER_REPORTED
  if (!campaignId) throw new WebsiteError(400, 'Choose the campaign the customer mentioned.', { field: 'campaignId' })
  if (!evidence) throw new WebsiteError(400, 'Write down what the customer said, so the link can be checked later.', { field: 'evidence' })
  await assertCampaignBefore(db, campaignId, saleDate)
  channelKind = channelKind ?? null
  return { source, campaignId, postId: null, channelKind, evidence, candidates: [], needsReview: false }
}

/**
 * Link one sale to its campaign (or record it as unknown). Replaces any earlier link of that sale: there is only
 * ever one row, so linking twice never counts twice. Replacing a link that was waiting for review records the review.
 */
export async function linkSale(db: Db, saleId: number, body: unknown, actor: string, now = new Date()): Promise<{ attribution: AttributionDto; changed: boolean }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new WebsiteError(400, 'Send the link as an object.')
  const o = body as Record<string, unknown>
  const extra = Object.keys(o).filter((k) => !(LINK_KEYS as readonly string[]).includes(k))
  if (extra.length) throw new WebsiteError(400, `Unknown field: ${extra[0]}`, { field: extra[0] })
  const sale = await db.sale.findUnique({ where: { id: saleId }, select: { id: true, saleDate: true, status: true } })
  if (!sale) throw new WebsiteError(404, 'Sale not found')
  if (sale.status === 'CANCELLED') throw new WebsiteError(409, 'This sale was cancelled, so it is not linked to any campaign.')
  const r = await resolve(db, o, sale.saleDate)
  const contactId = id(o.contactId, 'contactId')
  if (contactId && !(await db.marketingContact.findUnique({ where: { id: contactId }, select: { id: true } }))) throw new WebsiteError(400, 'That customer does not exist.', { field: 'contactId' })
  const notes = Array.isArray(o.touchpoints) ? o.touchpoints.map((t, i) => str(t, `touchpoints[${i}]`, 200)).filter((t): t is string => Boolean(t)).slice(0, 10) : []
  if (o.touchpoints !== undefined && !Array.isArray(o.touchpoints)) throw new WebsiteError(400, 'touchpoints must be a list of notes.', { field: 'touchpoints' })
  const paymentEvidence = (o.paymentEvidence ?? 'OWNER_RECORDED') as PaymentEvidence
  if (!PAYMENT_EVIDENCE.includes(paymentEvidence)) throw new WebsiteError(400, 'Payment evidence is OWNER_RECORDED or PAYMENT_CONFIRMED.', { field: 'paymentEvidence' })
  const paymentNote = str(o.paymentNote, 'paymentNote', 200)
  if (paymentEvidence === 'PAYMENT_CONFIRMED' && !paymentNote) throw new WebsiteError(400, 'Say what confirms the payment (for example the EcoCash reference).', { field: 'paymentNote' })

  const before = await db.marketingSaleAttribution.findUnique({ where: { saleId } })
  const data = {
    source: r.source, campaignId: r.campaignId, postId: r.postId, channelKind: r.channelKind, contactId,
    evidence: r.evidence, touchpoints: { notes, candidates: r.candidates } as Prisma.InputJsonValue, needsReview: r.needsReview,
    paymentEvidence, paymentNote,
  }
  const same = before && before.source === data.source && before.campaignId === data.campaignId && before.postId === data.postId
    && before.channelKind === data.channelKind && before.contactId === data.contactId && before.evidence === data.evidence
    && before.needsReview === data.needsReview && before.paymentEvidence === data.paymentEvidence && before.paymentNote === data.paymentNote
    && JSON.stringify(readTouchpoints(before.touchpoints)) === JSON.stringify({ notes, candidates: r.candidates })
  if (same) return { attribution: (await getAttribution(db, saleId))!, changed: false }
  const review = before?.needsReview && !r.needsReview ? { reviewedBy: actor, reviewedAt: now } : {}
  const row = before
    ? await db.marketingSaleAttribution.update({ where: { saleId }, data: { ...data, ...review, updatedBy: actor } })
    : await db.marketingSaleAttribution.create({ data: { saleId, ...data, createdBy: actor, updatedBy: actor } })
  await writeAudit(db, {
    actor, action: before ? 'sale.attribution_change' : 'sale.attribution_link', entity: 'sale', entityId: saleId,
    detail: {
      before: before ? { source: before.source, campaignId: before.campaignId, needsReview: before.needsReview, paymentEvidence: before.paymentEvidence } : null,
      after: { source: row.source, campaignId: row.campaignId, needsReview: row.needsReview, paymentEvidence: row.paymentEvidence },
      reviewed: Boolean(review.reviewedBy),
    },
  })
  return { attribution: (await getAttribution(db, saleId))!, changed: true }
}

// ───────────────────────── report ─────────────────────────

const money = (t: MoneyTotals) => ({ collected: fromCents(t.collectedCents), refunded: fromCents(t.refundedCents), corrected: fromCents(t.correctedCents), net: fromCents(t.netCents) })

export interface SalesReportDto {
  from: string
  to: string
  note: string
  allShop: ReturnType<typeof money> & { salesCount: number; billed: number; cancelledCount: number }
  campaigns: Array<ReturnType<typeof money> & { campaignId: number; name: string; salesCount: number }>
  channels: Array<ReturnType<typeof money> & { channelKind: string; salesCount: number }>
  uncredited: ReturnType<typeof money> & { salesCount: number; sales: Array<{ saleId: number; saleDate: string; total: number; customerName: string | null; needsReview: boolean; source: string }> }
  notASale: ReturnType<typeof money>
  needsReview: number
  paymentConfirmed: { salesCount: number }
  reconciles: boolean
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** All-shop, per campaign, per channel and uncredited money for a period of ledger days (inclusive; see ledgerDay). */
export async function marketingSalesReport(db: Db, range: { from: string; to: string }): Promise<SalesReportDto> {
  if (!DAY.test(range.from) || !DAY.test(range.to) || range.from > range.to) throw new WebsiteError(400, 'Give a period as from and to dates (YYYY-MM-DD), from first.')
  const ledger = await loadLedger(db)
  const attrs = await db.marketingSaleAttribution.findMany({ select: { saleId: true, source: true, campaignId: true, channelKind: true, needsReview: true, paymentEvidence: true } })
  const report: SalesReport = salesReport({ from: range.from, to: range.to, sales: ledger.sales, events: ledger.events, attributions: attrs })
  const names = new Map((await db.marketingCampaign.findMany({ where: { id: { in: report.campaigns.map((c) => c.campaignId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]))
  const uncreditedRows = await db.sale.findMany({ where: { id: { in: report.uncredited.saleIds } }, select: { id: true, saleDate: true, totalAmount: true, customerName: true }, orderBy: { saleDate: 'desc' } })
  const attrBySale = new Map(attrs.map((a) => [a.saleId, a]))
  const inRange = new Set(ledger.sales.filter((s) => s.status !== 'CANCELLED' && ledgerDay(s.saleDate) >= range.from && ledgerDay(s.saleDate) <= range.to).map((s) => s.id))
  return {
    from: report.from,
    to: report.to,
    note: ATTRIBUTION_NOTE,
    allShop: { ...money(report.allShop), salesCount: report.allShop.salesCount, billed: fromCents(report.allShop.billedCents), cancelledCount: report.allShop.cancelledCount },
    campaigns: report.campaigns.map((c) => ({ ...money(c), campaignId: c.campaignId, name: names.get(c.campaignId) ?? `Campaign ${c.campaignId}`, salesCount: c.salesCount })),
    channels: report.channels.map((c) => ({ ...money(c), channelKind: c.channelKind, salesCount: c.salesCount })),
    uncredited: {
      ...money(report.uncredited),
      salesCount: report.uncredited.salesCount,
      sales: uncreditedRows.map((s) => ({ saleId: s.id, saleDate: ledgerDay(s.saleDate), total: s.totalAmount, customerName: s.customerName, needsReview: attrBySale.get(s.id)?.needsReview ?? false, source: attrBySale.get(s.id)?.source ?? 'UNKNOWN' })),
    },
    notASale: money(report.notASale),
    needsReview: attrs.filter((a) => a.needsReview && inRange.has(a.saleId)).length,
    paymentConfirmed: { salesCount: attrs.filter((a) => a.paymentEvidence === 'PAYMENT_CONFIRMED' && inRange.has(a.saleId)).length },
    reconciles: report.reconciles,
  }
}
