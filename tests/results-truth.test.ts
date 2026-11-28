// ZP-1119 (MM-14): what the results numbers mean and the advice from them. Pure: no database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { ATTRIBUTION_LIMITS, REACH_LABEL, SAMPLE, advice, rate, known, truthReport, type AdviceInput, type TruthInput } from '../src/lib/marketing/results-truth'

const base = (o: Partial<TruthInput> = {}): TruthInput => ({
  platform: { reach: 900, impressions: 2000, clicks: 40, reported: true, platforms: ['FACEBOOK_PAGE', 'INSTAGRAM'] },
  website: { visits: 200, taps: 20, tracked: true },
  conversations: { ownerRecorded: 12, providerObserved: 0, won: 3 },
  sales: { allShopNetCents: 50000, allShopCount: 10, creditedNetCents: 20000, creditedCount: 4 },
  costs: { adSpendCents: 5000, adSpendKnown: true, messageCostCents: 300, messagesSent: 100 },
  goodsCostCents: null,
  fulfilmentCostCents: null,
  ...o,
})

describe('MM-14-AC1: reach is summed reported reach, never unique people', () => {
  test('label and note say it may count the same person twice', () => {
    const r = truthReport(base())
    assert.strictEqual(r.reach.label, REACH_LABEL)
    assert.match(r.reach.note ?? '', /same person can be counted/)
    assert.doesNotMatch(JSON.stringify(r), /unique (people|users|reach)/i)
  })
})

describe('MM-14-AC2: rates only between compatible populations', () => {
  test('the only rate is taps over visits (both website visits); no click-to-visit or tap-to-conversation funnel', () => {
    const r = truthReport(base())
    assert.deepStrictEqual([r.tapRate.value, r.tapRate.state], [10, 'KNOWN'])
    const rates = Object.entries(r).filter(([k]) => /rate/i.test(k)).map(([k]) => k)
    assert.deepStrictEqual(rates, ['tapRate'])
    assert.match(r.conversations.note, /not proof that people dropped out/)
  })
})

describe('MM-14-AC3: unknown is not zero; nothing over zero', () => {
  test('no platform reports: reach, shown and clicks are unknown, not 0', () => {
    const r = truthReport(base({ platform: { reach: 0, impressions: 0, clicks: 0, reported: false, platforms: [] } }))
    for (const m of [r.reach, r.impressions, r.clicks]) assert.deepStrictEqual([m.value, m.state], [null, 'UNKNOWN'])
  })
  test('no visits: the tap rate is not available; untracked website is unknown', () => {
    assert.strictEqual(truthReport(base({ website: { visits: 0, taps: 0, tracked: true } })).tapRate.state, 'NOT_AVAILABLE')
    const r = truthReport(base({ website: { visits: 0, taps: 0, tracked: false } }))
    assert.deepStrictEqual([r.visits.state, r.taps.state, r.tapRate.state], ['UNKNOWN', 'UNKNOWN', 'UNKNOWN'])
    assert.deepStrictEqual(rate(known(1, 'a'), known(0, 'b'), 'x').state, 'NOT_AVAILABLE')
  })
  test('messages sent without a cost per message make the total unknown', () => {
    const r = truthReport(base({ costs: { adSpendCents: 5000, adSpendKnown: true, messageCostCents: null, messagesSent: 30 } }))
    assert.strictEqual(r.costs.items[1].state, 'UNKNOWN')
    assert.strictEqual(r.costs.total.state, 'UNKNOWN')
    assert.strictEqual(r.costPerCreditedSale.state, 'UNKNOWN')
  })
})

describe('MM-14-AC4: never profit; contribution needs every cost', () => {
  test('without cost of goods and fulfilment, contribution is not available and says what is missing', () => {
    const r = truthReport(base())
    assert.strictEqual(r.contribution.state, 'NOT_AVAILABLE')
    assert.deepStrictEqual(r.contribution.missing, ['what each sold piece cost you', 'delivery and packing costs'])
    const labels = JSON.stringify(r).match(/"label":"[^"]*"/g) ?? []
    assert.ok(labels.length > 10 && labels.every((l) => !/profit/i.test(l)), 'no figure is called profit')
  })
  test('with every input, contribution = credited takings - goods - fulfilment - marketing', () => {
    const r = truthReport(base({ goodsCostCents: 8000, fulfilmentCostCents: 1000 }))
    assert.deepStrictEqual([r.contribution.state, r.contribution.value], ['KNOWN', 200 - 80 - 10 - 53])
  })
})

describe('MM-14-AC5: return on ads and cost per sale say their limits and scope', () => {
  test('credited takings over ad spend, with the attribution limits', () => {
    const r = truthReport(base())
    assert.deepStrictEqual([r.roas.value, r.roas.note], [4, ATTRIBUTION_LIMITS])
    assert.strictEqual(r.costPerCreditedSale.value, 13.25)
    assert.match(r.costPerCreditedSale.note ?? '', /Ad spend and message costs only/)
    assert.match(r.costs.scope, /not included/)
  })
  test('no ad spend: not available; unknown spend: unknown', () => {
    assert.strictEqual(truthReport(base({ costs: { adSpendCents: 0, adSpendKnown: true, messageCostCents: 0, messagesSent: 0 } })).roas.state, 'NOT_AVAILABLE')
    assert.strictEqual(truthReport(base({ costs: { adSpendCents: 0, adSpendKnown: false, messageCostCents: 0, messagesSent: 0 } })).roas.state, 'UNKNOWN')
    assert.strictEqual(truthReport(base({ sales: { allShopNetCents: 0, allShopCount: 0, creditedNetCents: 0, creditedCount: 0 } })).costPerCreditedSale.state, 'NOT_AVAILABLE')
  })
})

const now = new Date('2033-03-10T10:00:00Z')
const adv = (o: Partial<AdviceInput> = {}): AdviceInput => ({
  campaigns: [], products: [], openEnquiries: [], budget: { monthlyCapCents: 0, spentThisMonthCents: 0 },
  shop: { deliveryPolicy: 'Harare CBD US$3' }, website: { visits: 10, taps: 1 }, now, ...o,
})

describe('MM-14-AC6: few records give "too early", never a winner', () => {
  test('a live campaign under the sample sizes is too early to judge', () => {
    const a = advice(adv({ campaigns: [{ id: 1, name: 'Linen', status: 'ACTIVE', productIds: [], creditedSales: SAMPLE.sales - 1, visits: 10, taps: 1 }] }))
    assert.deepStrictEqual(a.map((x) => [x.kind, x.key]), [['TOO_EARLY', 'too-early-1']])
    assert.doesNotMatch(JSON.stringify(a), /\b(winner|best|works best)\b/i)
  })
  test('enough sales: no "too early"', () => {
    assert.deepStrictEqual(advice(adv({ campaigns: [{ id: 1, name: 'Linen', status: 'ACTIVE', productIds: [], creditedSales: SAMPLE.sales, visits: 0, taps: 0 }] })), [])
  })
})

describe('MM-14-AC7: advice uses campaigns, stock, waiting customers and budget; drafts only', () => {
  test('in-stock pieces in no live campaign become a draft suggestion; budget is mentioned', () => {
    const a = advice(adv({
      campaigns: [{ id: 1, name: 'Linen', status: 'ACTIVE', productIds: [10], creditedSales: 9, visits: 500, taps: 40 }],
      products: [{ id: 10, name: 'A', published: true, inStock: true, priceUsd: 20 }, { id: 11, name: 'B', published: true, inStock: true, priceUsd: 25 }, { id: 12, name: 'C', published: true, inStock: false, priceUsd: 25 }],
      budget: { monthlyCapCents: 5000, spentThisMonthCents: 2000 },
    }))
    const idle = a.find((x) => x.key.startsWith('idle-stock'))!
    assert.deepStrictEqual(idle.draft, { name: 'Test: in-stock pieces (1)', productIds: [11] })
    assert.ok(idle.evidence.some((e) => /US\$30\.00 of this month's ad budget is left/.test(e)))
    assert.ok(idle.evidence.some((e) => /not a proven winner/.test(e)))
  })
  test('a live campaign with sold-out pieces is flagged, with no draft', () => {
    const a = advice(adv({ campaigns: [{ id: 2, name: 'Skirts', status: 'ACTIVE', productIds: [12], creditedSales: 9, visits: 500, taps: 40 }], products: [{ id: 12, name: 'C', published: true, inStock: false, priceUsd: 25 }] }))
    assert.deepStrictEqual(a.map((x) => [x.key, x.draft]), [['sold-out-in-2', null]])
  })
})

describe('MM-14-AC8: the problem may not be marketing; advice changes nothing', () => {
  test('slow replies, due follow-ups, missing prices, no delivery policy and visits without taps, each with evidence and no draft', () => {
    const a = advice(adv({
      openEnquiries: [{ id: 5, status: 'NEW', createdAt: new Date(now.getTime() - 30 * 3_600_000), nextFollowUpAt: new Date(now.getTime() - 60_000) }],
      products: [{ id: 1, name: 'Wrap dress', published: true, inStock: false, priceUsd: 0 }],
      shop: { deliveryPolicy: null },
      website: { visits: SAMPLE.visits, taps: 0 },
    }))
    assert.deepStrictEqual(a.map((x) => x.key), ['slow-replies', 'follow-ups-due', 'hidden-price', 'no-delivery-policy', 'views-no-taps'])
    assert.ok(a.every((x) => x.kind === 'NOT_MARKETING' && x.draft === null && x.evidence.length > 0))
    assert.match(a[0].evidence[0], /enquiry 5/)
  })
})
