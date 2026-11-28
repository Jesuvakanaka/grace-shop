// ZP-1118 (MM-13): the money of the existing sales ledger, as dated events. Pure (no database).
// - Collected money is the cash part of a sale on its sale date, plus debtor payments on their payment date.
//   Debtor payments are recorded per customer, not per sale, so they are allocated to that customer's debts
//   oldest first (an opening balance with no sale comes first). Money that pays no sale stays "not a sale".
// - A refund paid in cash takes money away on its refund date; voiding it later puts it back on the void date.
//   A refund taken off what the customer owes (CREDIT) reduces that sale's debt and is never collected money.
// - A cancelled sale counts nowhere (it was never paid: see cancelSale). An unpaid credit sale collects nothing.

export const HARARE_OFFSET_MS = 2 * 60 * 60 * 1000

/** The Harare calendar day of an instant, as YYYY-MM-DD (Harare is UTC+2 all year). */
export function harareDay(d: Date): string {
  return new Date(d.getTime() + HARARE_OFFSET_MS).toISOString().slice(0, 10)
}

/** Money as cents, so sums of Float columns do not drift. */
export const toCents = (v: number) => Math.round(v * 100)
export const fromCents = (c: number) => c / 100

export interface LedgerSale {
  id: number
  saleDate: Date
  status: string
  totalAmount: number
  cashAmount: number
  creditAmount: number
}

export interface LedgerRefund {
  id: number
  saleId: number
  refundDate: Date
  amount: number
  /** CASH | CREDIT */
  method: string
  voidedAt: Date | null
}

/** A debt of one customer: a credit sale (saleId) or money owed from before the system (saleId null). */
export interface LedgerDebt {
  saleId: number | null
  date: Date
  /** Cents still owed for it before payments (credit refunds already taken off). */
  cents: number
}

export interface LedgerPayment {
  id: number
  date: Date
  cents: number
}

export type MoneyKind = 'CASH_SALE' | 'DEBTOR_PAYMENT' | 'REFUND' | 'REFUND_VOIDED'

/** One dated movement of collected money. Refunds are negative. saleId null: money that pays no sale. */
export interface MoneyEvent {
  saleId: number | null
  day: string
  kind: MoneyKind
  cents: number
  ref: string
}

/**
 * Allocate one customer's payments to their debts, oldest debt first. Each payment keeps its own date.
 * Anything paid beyond all debts is returned with saleId null. Pure and stable: the same rows give the same split.
 */
export function allocatePayments(debts: LedgerDebt[], payments: LedgerPayment[]): MoneyEvent[] {
  const queue = [...debts]
    .filter((d) => d.cents > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || (a.saleId === null ? -1 : b.saleId === null ? 1 : a.saleId - b.saleId))
    .map((d) => ({ ...d, left: d.cents }))
  const out: MoneyEvent[] = []
  const sorted = [...payments].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id - b.id)
  let i = 0
  for (const p of sorted) {
    let left = p.cents
    while (left > 0 && i < queue.length) {
      const d = queue[i]
      const take = Math.min(left, d.left)
      if (take > 0) out.push({ saleId: d.saleId, day: harareDay(p.date), kind: 'DEBTOR_PAYMENT', cents: take, ref: `payment:${p.id}` })
      d.left -= take
      left -= take
      if (d.left === 0) i++
    }
    if (left > 0) out.push({ saleId: null, day: harareDay(p.date), kind: 'DEBTOR_PAYMENT', cents: left, ref: `payment:${p.id}` })
  }
  return out
}

/** The cash part of each counted sale, and every cash refund and its void, as events. */
export function saleAndRefundEvents(sales: LedgerSale[], refunds: LedgerRefund[]): MoneyEvent[] {
  const counted = new Set(sales.filter((s) => s.status !== 'CANCELLED').map((s) => s.id))
  const out: MoneyEvent[] = []
  for (const s of sales) {
    if (!counted.has(s.id) || toCents(s.cashAmount) <= 0) continue
    out.push({ saleId: s.id, day: harareDay(s.saleDate), kind: 'CASH_SALE', cents: toCents(s.cashAmount), ref: `sale:${s.id}` })
  }
  for (const r of refunds) {
    if (r.method !== 'CASH' || !counted.has(r.saleId)) continue
    out.push({ saleId: r.saleId, day: harareDay(r.refundDate), kind: 'REFUND', cents: -toCents(r.amount), ref: `refund:${r.id}` })
    if (r.voidedAt) out.push({ saleId: r.saleId, day: harareDay(r.voidedAt), kind: 'REFUND_VOIDED', cents: toCents(r.amount), ref: `refund:${r.id}:void` })
  }
  return out
}

/** Credit refunds still standing, per sale, in cents. */
export function creditRefundCents(refunds: LedgerRefund[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const r of refunds) if (r.method === 'CREDIT' && !r.voidedAt) m.set(r.saleId, (m.get(r.saleId) ?? 0) + toCents(r.amount))
  return m
}

export interface SaleMoney {
  /** Cents collected for the sale (cash part plus allocated payments), before refunds. */
  collectedCents: number
  /** Cash refunds still standing. */
  cashRefundedCents: number
  /** Credit refunds still standing. */
  creditRefundedCents: number
  /** What the customer still owes for it. */
  outstandingCents: number
}

/** The money of one sale from all its events (any date). */
export function saleMoney(sale: LedgerSale, events: MoneyEvent[], refunds: LedgerRefund[]): SaleMoney {
  const mine = events.filter((e) => e.saleId === sale.id)
  const collectedCents = mine.filter((e) => e.kind === 'CASH_SALE' || e.kind === 'DEBTOR_PAYMENT').reduce((a, e) => a + e.cents, 0)
  const standing = refunds.filter((r) => r.saleId === sale.id && !r.voidedAt)
  const cashRefundedCents = standing.filter((r) => r.method === 'CASH').reduce((a, r) => a + toCents(r.amount), 0)
  const creditRefundedCents = standing.filter((r) => r.method === 'CREDIT').reduce((a, r) => a + toCents(r.amount), 0)
  const paidOnCredit = mine.filter((e) => e.kind === 'DEBTOR_PAYMENT').reduce((a, e) => a + e.cents, 0)
  const outstandingCents = sale.status === 'CANCELLED' ? 0 : Math.max(0, toCents(sale.creditAmount) - creditRefundedCents - paidOnCredit)
  return { collectedCents, cashRefundedCents, creditRefundedCents, outstandingCents }
}

// ───────────────────────── the report ─────────────────────────

export const ATTRIBUTION_SOURCES = ['TRACKED_LINK', 'CUSTOMER_REPORTED', 'UNKNOWN'] as const
export type AttributionSource = (typeof ATTRIBUTION_SOURCES)[number]

/** What the report needs of a sale's attribution. Only a credited one names a campaign. */
export interface ReportAttribution {
  saleId: number
  source: string
  campaignId: number | null
  channelKind: string | null
  needsReview: boolean
}

/** Credited means: a campaign, a known source, and no open review. Anything else is unknown (MM-13-AC2/AC3). */
export function isCredited(a: ReportAttribution | undefined): a is ReportAttribution & { campaignId: number } {
  return Boolean(a && a.campaignId && a.source !== 'UNKNOWN' && !a.needsReview)
}

export interface MoneyTotals {
  collectedCents: number
  refundedCents: number
  netCents: number
}
const zero = (): MoneyTotals => ({ collectedCents: 0, refundedCents: 0, netCents: 0 })
const add = (t: MoneyTotals, e: MoneyEvent) => {
  if (e.kind === 'CASH_SALE' || e.kind === 'DEBTOR_PAYMENT') t.collectedCents += e.cents
  else t.refundedCents -= e.cents // a refund is negative, its void positive
  t.netCents += e.cents
}

export interface SalesReport {
  from: string
  to: string
  /** Everything in the ledger in the period: reconciles to the cash position (cash sales + debtor payments - refunds). */
  allShop: MoneyTotals & { salesCount: number; billedCents: number; cancelledCount: number }
  /** Per credited campaign. Sales stay on their real dates, even after the campaign ended (MM-13-AC4). */
  campaigns: Array<MoneyTotals & { campaignId: number; salesCount: number }>
  /** Per channel of credited sales. */
  channels: Array<MoneyTotals & { channelKind: string; salesCount: number }>
  /** Sales with no credited campaign (no attribution, unknown, or waiting for review). Never in campaign revenue. */
  uncredited: MoneyTotals & { salesCount: number; saleIds: number[] }
  /** Debtor payments for opening balances or overpayments: real money, but no sale. */
  notASale: MoneyTotals
  /** True when campaigns + uncredited + notASale add up to all-shop, and so do channels. */
  reconciles: boolean
}

/**
 * Sum the events of a period (Harare days, inclusive) by campaign, channel and uncredited.
 * The same events and the same date filter feed every breakdown, so they always add up (MM-13-AC6).
 */
export function salesReport(input: { from: string; to: string; sales: LedgerSale[]; events: MoneyEvent[]; attributions: ReportAttribution[] }): SalesReport {
  const { from, to } = input
  const inRange = (day: string) => day >= from && day <= to
  const attr = new Map(input.attributions.map((a) => [a.saleId, a]))
  const allShop = { ...zero(), salesCount: 0, billedCents: 0, cancelledCount: 0 }
  const campaigns = new Map<number, MoneyTotals & { campaignId: number; salesCount: number }>()
  const channels = new Map<string, MoneyTotals & { channelKind: string; salesCount: number }>()
  const uncredited = { ...zero(), salesCount: 0, saleIds: [] as number[] }
  const notASale = zero()
  const campaignOf = (id: number) => campaigns.get(id) ?? (campaigns.set(id, { ...zero(), campaignId: id, salesCount: 0 }), campaigns.get(id)!)
  const channelOf = (k: string) => channels.get(k) ?? (channels.set(k, { ...zero(), channelKind: k, salesCount: 0 }), channels.get(k)!)

  // Sale counts and billed amounts: by sale date, the same filter as the money.
  for (const s of input.sales) {
    if (!inRange(harareDay(s.saleDate))) continue
    if (s.status === 'CANCELLED') { allShop.cancelledCount++; continue }
    allShop.salesCount++
    allShop.billedCents += toCents(s.totalAmount)
    const a = attr.get(s.id)
    if (isCredited(a)) {
      campaignOf(a.campaignId).salesCount++
      channelOf(a.channelKind ?? 'UNKNOWN').salesCount++
    } else {
      uncredited.salesCount++
      uncredited.saleIds.push(s.id)
    }
  }
  for (const e of input.events) {
    if (!inRange(e.day)) continue
    add(allShop, e)
    if (e.saleId === null) { add(notASale, e); continue }
    const a = attr.get(e.saleId)
    if (isCredited(a)) {
      add(campaignOf(a.campaignId), e)
      add(channelOf(a.channelKind ?? 'UNKNOWN'), e)
    } else add(uncredited, e)
  }
  const sum = (rows: MoneyTotals[]) => rows.reduce((a, r) => a + r.netCents, 0)
  const credited = sum([...campaigns.values()])
  const reconciles = credited + uncredited.netCents + notASale.netCents === allShop.netCents
    && sum([...channels.values()]) === credited
  return {
    from, to, allShop,
    campaigns: [...campaigns.values()].sort((a, b) => b.netCents - a.netCents || a.campaignId - b.campaignId),
    channels: [...channels.values()].sort((a, b) => b.netCents - a.netCents || a.channelKind.localeCompare(b.channelKind)),
    uncredited, notASale, reconciles,
  }
}
