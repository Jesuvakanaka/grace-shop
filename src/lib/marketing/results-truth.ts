// VYRA Marketing Manager (ZP-1119, MM-14): what the results numbers mean, and honest advice from them. Pure.
// - Reach from several platforms is "summed reported reach": the same person may be counted more than once (AC1).
// - A rate is only shown when top and bottom count the same kind of thing; no funnel leak is claimed (AC2).
// - A number nobody measured is "unknown", never 0; a rate over 0 is "not available" (AC3).
// - Takings minus marketing cost is never called profit; contribution needs cost-of-goods and fulfilment costs (AC4).
// - Return on ad spend uses credited takings over ad spend and says what credit means; cost per sale says its scope (AC5).
// - Every number links to its records; few records give "too early to tell", never a winner (AC6).
// - Advice looks at campaigns, stock, waiting customers and budget; accepting makes a draft only (AC7).
// - Advice may say the problem is not marketing, with the evidence; it never changes the shop by itself (AC8).

export type MetricState = 'KNOWN' | 'UNKNOWN' | 'NOT_AVAILABLE'
export interface Metric { value: number | null; state: MetricState; label: string; note?: string }

export const known = (value: number, label: string, note?: string): Metric => ({ value, state: 'KNOWN', label, ...(note ? { note } : {}) })
export const unknown = (label: string, note: string): Metric => ({ value: null, state: 'UNKNOWN', label, note })

/** A rate of two counts of the same population, or "not available" when the bottom is 0 or unknown. */
export function rate(top: Metric, bottom: Metric, label: string): Metric {
  if (top.state !== 'KNOWN' || bottom.state !== 'KNOWN') return { value: null, state: 'UNKNOWN', label, note: 'One of the two numbers is not measured.' }
  if (!bottom.value) return { value: null, state: 'NOT_AVAILABLE', label, note: 'Nothing to divide by yet.' }
  return { value: Math.round(((top.value ?? 0) / bottom.value) * 1000) / 10, state: 'KNOWN', label }
}

export const REACH_LABEL = 'Summed reported reach'
export const REACH_NOTE = 'Added up from each platform. The same person can be counted on more than one platform or post, so this is not the number of different people.'
export const ATTRIBUTION_LIMITS = 'Only sales you credited to a campaign count. Credit shows a link, not proof that the campaign caused the sale, and sales nobody credited are left out.'
export const DATE_BASIS = 'Dates are shop days in Harare. Platform numbers, visits and conversations count on the day they happened. Takings count on the day money came in or went out, so a payment or refund on a later day lands in that day. Sales are counted on the day of the sale.'
export const PROFIT_NOTE = 'Takings minus marketing cost is not profit. Profit also needs what the pieces cost you and what delivery and packing cost.'

/** How many records a judgement needs before it is more than a hint. */
export const SAMPLE = { sales: 5, visits: 100, taps: 20 } as const

export interface TruthInput {
  /** Platform numbers, with whether any platform reported them in the range. */
  platform: { reach: number; impressions: number; clicks: number; reported: boolean; platforms: string[] }
  website: { visits: number; taps: number; tracked: boolean }
  conversations: { ownerRecorded: number; providerObserved: number; won: number }
  sales: { allShopNetCents: number; allShopCount: number; creditedNetCents: number; creditedCount: number }
  costs: { adSpendCents: number; adSpendKnown: boolean; messageCostCents: number | null; messagesSent: number }
  /** Set when the numbers are for one campaign. Messages are not tied to a campaign, so their cost is left out. */
  campaignId?: number | null
  /** Cost of goods for the credited sales, when every sold piece has a unit cost. */
  goodsCostCents: number | null
  /** Delivery and packing cost: the shop does not record it yet. */
  fulfilmentCostCents: number | null
}

export interface TruthReport {
  reach: Metric
  impressions: Metric
  clicks: Metric
  visits: Metric
  taps: Metric
  tapRate: Metric
  conversations: { ownerRecorded: Metric; providerObserved: Metric; note: string }
  sales: { allShopNet: Metric; allShopCount: Metric; creditedNet: Metric; creditedCount: Metric }
  costs: { items: Metric[]; total: Metric; scope: string }
  roas: Metric
  costPerCreditedSale: Metric
  contribution: Metric & { missing: string[] }
  notes: string[]
}

const money = (cents: number) => cents / 100

export function truthReport(i: TruthInput): TruthReport {
  const platformNote = i.platform.reported ? undefined : 'No connected platform has reported numbers for these days.'
  const reach = i.platform.reported ? known(i.platform.reach, REACH_LABEL, REACH_NOTE) : unknown(REACH_LABEL, platformNote!)
  const impressions = i.platform.reported ? known(i.platform.impressions, 'Times shown (reported)') : unknown('Times shown (reported)', platformNote!)
  const clicks = i.platform.reported ? known(i.platform.clicks, 'Clicks on the platform (reported)') : unknown('Clicks on the platform (reported)', platformNote!)
  const visits = i.website.tracked ? known(i.website.visits, 'Website visits') : unknown('Website visits', 'Website visits are not being counted.')
  const taps = i.website.tracked ? known(i.website.taps, 'Taps on "Message us"', 'A tap opens WhatsApp. It is not a conversation.') : unknown('Taps on "Message us"', 'Website taps are not being counted.')
  // AC2: taps and visits are both website visits, so the rate compares like with like. Platform clicks, website
  // visits and recorded conversations are different populations: no rate between them is shown.
  const tapRate = rate(taps, visits, 'Visits that tapped "Message us"')

  const ad = i.costs.adSpendKnown ? known(money(i.costs.adSpendCents), 'Ad spend (reported by Meta)') : unknown('Ad spend', 'No ad has reported its spend.')
  const msg: Metric = i.campaignId
    ? { value: null, state: 'NOT_AVAILABLE', label: 'Messages sent', note: 'Messages are not tied to a campaign, so their cost is not counted here.' }
    : i.costs.messageCostCents === null
    ? (i.costs.messagesSent > 0 ? unknown('Messages sent', `${i.costs.messagesSent} sent, but the cost per message is not set.`) : known(0, 'Messages sent', 'No messages were sent.'))
    : known(money(i.costs.messageCostCents), 'Messages sent (estimated)', `${i.costs.messagesSent} messages at the cost per message you set.`)
  const items = [ad, msg]
  // One campaign's cost is its ads only (messages belong to no campaign).
  const counted = i.campaignId ? [ad] : items
  const allKnown = counted.every((m) => m.state === 'KNOWN')
  const total = allKnown ? known(counted.reduce((s, m) => s + (m.value ?? 0), 0), 'Marketing cost') : unknown('Marketing cost', 'At least one cost is not known, so there is no total.')
  const scope = i.campaignId
    ? 'This campaign\'s ad spend only. Messages are not tied to a campaign. Your time, photos and samples are not included.'
    : 'Ad spend and message costs only. Your time, photos and samples are not included.'

  const creditedNet = known(money(i.sales.creditedNetCents), i.campaignId ? 'Takings credited to this campaign' : 'Takings credited to campaigns')
  const creditedCount = known(i.sales.creditedCount, i.campaignId ? 'Sales credited to this campaign' : 'Sales credited to campaigns')
  const roas = ad.state !== 'KNOWN'
    ? unknown('Credited takings per dollar of ads', 'Ad spend is not known.')
    : !ad.value
      ? { value: null, state: 'NOT_AVAILABLE' as const, label: 'Credited takings per dollar of ads', note: 'No ad spend in these days.' }
      : known(Math.round((money(i.sales.creditedNetCents) / ad.value) * 100) / 100, 'Credited takings per dollar of ads', ATTRIBUTION_LIMITS)
  const costPerCreditedSale = total.state !== 'KNOWN'
    ? unknown('Marketing cost per credited sale', 'The marketing cost is not known.')
    : !i.sales.creditedCount
      ? { value: null, state: 'NOT_AVAILABLE' as const, label: 'Marketing cost per credited sale', note: 'No credited sales in these days.' }
      : known(Math.round(((total.value ?? 0) / i.sales.creditedCount) * 100) / 100, 'Marketing cost per credited sale', `${scope} ${ATTRIBUTION_LIMITS}`)

  // AC4: contribution only with every input; otherwise say which are missing.
  const missing: string[] = []
  if (i.goodsCostCents === null) missing.push('what each sold piece cost you')
  if (i.fulfilmentCostCents === null) missing.push('delivery and packing costs')
  if (total.state !== 'KNOWN') missing.push('every marketing cost')
  const contribution = missing.length
    ? { value: null, state: 'NOT_AVAILABLE' as const, label: 'Contribution after costs', note: `Needs ${missing.join(', ')}.`, missing }
    : { ...known(money(i.sales.creditedNetCents - (i.goodsCostCents ?? 0) - (i.fulfilmentCostCents ?? 0)) - (total.value ?? 0), 'Contribution after costs'), missing }

  return {
    reach, impressions, clicks, visits, taps, tapRate,
    conversations: {
      ownerRecorded: known(i.conversations.ownerRecorded, 'Conversations you wrote down'),
      providerObserved: known(i.conversations.providerObserved, 'Conversations seen in a connected inbox'),
      note: 'Taps, clicks and conversations are counted separately. A gap between them is not proof that people dropped out: many conversations start without a tap, and not every tap is recorded.',
    },
    sales: {
      allShopNet: known(money(i.sales.allShopNetCents), 'All-shop takings'),
      allShopCount: known(i.sales.allShopCount, 'All-shop sales'),
      creditedNet, creditedCount,
    },
    costs: { items, total, scope },
    roas, costPerCreditedSale, contribution,
    notes: [DATE_BASIS, REACH_NOTE, PROFIT_NOTE, ATTRIBUTION_LIMITS],
  }
}

// ─── Advice ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AdviceInput {
  campaigns: { id: number; name: string; status: string; productIds: number[]; creditedSales: number; visits: number; taps: number }[]
  products: { id: number; name: string; published: boolean; inStock: boolean; priceUsd: number }[]
  openEnquiries: { id: number; status: string; createdAt: Date; nextFollowUpAt: Date | null }[]
  budget: { monthlyCapCents: number; spentThisMonthCents: number }
  shop: { deliveryPolicy: string | null }
  website: { visits: number; taps: number }
  now: Date
}

export interface Advice {
  /** Stable key: the same situation gives the same key, so accepting can be checked against fresh numbers. */
  key: string
  kind: 'MARKETING' | 'NOT_MARKETING' | 'TOO_EARLY'
  title: string
  evidence: string[]
  /** A campaign draft accepting this would create, or null when the advice is for the owner to act on. */
  draft: { name: string; productIds: number[] } | null
}

const HOUR = 3_600_000
const MAX_DRAFT_PRODUCTS = 6

export function advice(i: AdviceInput): Advice[] {
  const out: Advice[] = []
  const active = i.campaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'SCHEDULED')

  // AC8: problems that are not marketing, each with its evidence. Advice only: nothing is changed.
  const slow = i.openEnquiries.filter((e) => e.status === 'NEW' && i.now.getTime() - e.createdAt.getTime() > 24 * HOUR)
  if (slow.length) out.push({ key: 'slow-replies', kind: 'NOT_MARKETING', title: 'Reply to waiting customers first', evidence: [`${slow.length} ${slow.length === 1 ? 'enquiry has' : 'enquiries have'} waited more than a day without a reply (enquiry ${slow.slice(0, 5).map((e) => e.id).join(', ')}).`], draft: null })
  const due = i.openEnquiries.filter((e) => e.nextFollowUpAt && e.nextFollowUpAt.getTime() <= i.now.getTime())
  if (due.length) out.push({ key: 'follow-ups-due', kind: 'NOT_MARKETING', title: 'Follow-ups are due', evidence: [`${due.length} follow-up${due.length === 1 ? ' is' : 's are'} due now.`], draft: null })
  const noPrice = i.products.filter((p) => p.published && p.priceUsd <= 0)
  if (noPrice.length) out.push({ key: 'hidden-price', kind: 'NOT_MARKETING', title: 'Some pieces on the website show no price', evidence: [`${noPrice.length} published ${noPrice.length === 1 ? 'piece has' : 'pieces have'} no price: ${noPrice.slice(0, 5).map((p) => p.name).join(', ')}.`], draft: null })
  if (!i.shop.deliveryPolicy?.trim()) out.push({ key: 'no-delivery-policy', kind: 'NOT_MARKETING', title: 'Say how delivery works', evidence: ['The shop has no delivery policy, so posts and replies cannot mention delivery.'], draft: null })
  if (i.website.visits >= SAMPLE.visits && i.website.taps === 0) out.push({ key: 'views-no-taps', kind: 'NOT_MARKETING', title: 'People visit but nobody taps "Message us"', evidence: [`${i.website.visits} visits and no taps in these days. Check the button and the prices on the product pages.`], draft: null })

  // AC6: a judgement on a campaign needs enough records.
  for (const c of active) {
    if (c.creditedSales < SAMPLE.sales && c.visits < SAMPLE.visits) {
      out.push({ key: `too-early-${c.id}`, kind: 'TOO_EARLY', title: `Too early to judge "${c.name}"`, evidence: [`${c.creditedSales} credited ${c.creditedSales === 1 ? 'sale' : 'sales'} and ${c.visits} visits so far. Keep it running and look again when there are at least ${SAMPLE.sales} sales or ${SAMPLE.visits} visits.`], draft: null })
    }
  }

  // AC7: pieces in stock that no live campaign covers, if there is budget or the campaign can be posts only.
  const covered = new Set(active.flatMap((c) => c.productIds))
  const idle = i.products.filter((p) => p.published && p.inStock && p.priceUsd > 0 && !covered.has(p.id))
  if (idle.length) {
    const left = Math.max(0, i.budget.monthlyCapCents - i.budget.spentThisMonthCents)
    const pick = idle.slice(0, MAX_DRAFT_PRODUCTS)
    out.push({
      key: `idle-stock-${pick.map((p) => p.id).join('-')}`, kind: 'MARKETING', title: 'Show pieces that are in stock but in no campaign',
      evidence: [
        `${idle.length} published ${idle.length === 1 ? 'piece is' : 'pieces are'} in stock and not in any live campaign: ${pick.map((p) => p.name).join(', ')}.`,
        left > 0 ? `US$${(left / 100).toFixed(2)} of this month's ad budget is left.` : 'No ad budget is left this month, so this would be posts only.',
        'This is a test, not a proven winner: compare it with your other campaigns after two weeks.',
      ],
      draft: { name: `Test: in-stock pieces (${pick.length})`, productIds: pick.map((p) => p.id) },
    })
  }
  // A live campaign showing sold-out pieces wastes attention.
  for (const c of active) {
    const gone = c.productIds.filter((id) => i.products.find((p) => p.id === id && !p.inStock))
    if (gone.length) out.push({ key: `sold-out-in-${c.id}`, kind: 'MARKETING', title: `"${c.name}" shows sold-out pieces`, evidence: [`${gone.length} of its pieces ${gone.length === 1 ? 'is' : 'are'} sold out. Restock, or take them out of the campaign.`], draft: null })
  }
  return out
}
