// ZP-1106 (MM-01): the shop's truth and the product's truth. Pure: no database, no network.
// MM-01-AC2 unknown delivery/stock/returns never become claims; MM-01-AC3 who confirmed what and when;
// MM-01-AC4 withdrawn excluded, pre-orders keep their real dates; MM-01-AC5 retail and wholesale stay apart.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import Anthropic from '@anthropic-ai/sdk'
import { readConfirmations, setupState, TRUTH_FIELDS, type SiteFacts, type TruthSettings } from '../src/lib/marketing/shop-truth'
import {
  availabilityLine, availabilityOf, productBlockReason, shopTruth, truthFacts, truthLines, truthProblems, wholesaleOffer, wholesaleText, type TruthProduct,
} from '../src/lib/marketing/product-truth'
import { draftPosts, factsBlock, fillPlaceholders, softProblems, type DraftInput } from '../src/lib/marketing/ai/writer'

const site = (o: Partial<SiteFacts> = {}): SiteFacts => ({ whatsappNumber: '+263771234567', phone: null, email: null, address: null, openingHoursSet: false, paymentMethods: null, holdHours: null, ...o })
const settings = (o: Partial<TruthSettings> = {}): TruthSettings => ({
  shopDescription: null, brandVoice: null, audienceNotes: [], salesMode: null, market: null, currency: null, timeZone: null, contactRoute: null,
  policyDelivery: null, policyReturns: null, policyOrdering: null, monthlySpendCapCents: 0, confirmations: {}, ...o,
})
const conf = (by = 'mike', at = '2026-11-28T10:00:00.000Z') => ({ by, at })

const product = (o: Partial<TruthProduct> = {}): TruthProduct => ({
  id: 7, productName: 'Pink party dress', publicName: null, published: true, listingType: 'IN_STOCK', currentQuantity: 5,
  preorderShipFrom: null, preorderShipTo: null, wholesalePriceUsd: null, wholesaleMinQuantity: null, ...o,
})

describe('setup state (MM-01, MM-01-AC3)', () => {
  test('a new shop: every fact is asked, nothing is inferred (not the market from a +263 WhatsApp number)', () => {
    const s = setupState(settings(), site())
    assert.strictEqual(s.complete, false)
    assert.deepStrictEqual(s.toAsk, [...TRUTH_FIELDS])
    const market = s.items.find((i) => i.field === 'market')!
    assert.strictEqual(market.value, null)
    assert.strictEqual(market.status, 'missing')
    for (const f of ['currency', 'timeZone'] as const) assert.strictEqual(s.items.find((i) => i.field === f)!.value, null)
  })

  test('only what is missing or unconfirmed is asked; confirmed facts show who and when', () => {
    const s = setupState(settings({
      market: 'Harare', currency: 'USD', brandVoice: 'warm',
      confirmations: { market: conf(), currency: conf('ann', '2026-11-27T08:00:00.000Z') },
    }), site())
    const market = s.items.find((i) => i.field === 'market')!
    assert.deepStrictEqual([market.status, market.confirmedBy, market.confirmedAt, market.question], ['confirmed', 'mike', '2026-11-28T10:00:00.000Z', null])
    assert.strictEqual(s.items.find((i) => i.field === 'currency')!.confirmedBy, 'ann')
    const voice = s.items.find((i) => i.field === 'brandVoice')!
    assert.strictEqual(voice.status, 'unconfirmed')
    assert.ok(voice.question)
    assert.ok(!s.toAsk.includes('market') && !s.toAsk.includes('currency') && s.toAsk.includes('brandVoice'))
  })

  test('an empty policy the owner confirmed stays unknown and is no longer asked; an empty market cannot be "confirmed" away', () => {
    const s = setupState(settings({ confirmations: { policyReturns: conf(), market: conf() } }), site())
    assert.strictEqual(s.items.find((i) => i.field === 'policyReturns')!.status, 'unknown')
    assert.ok(!s.toAsk.includes('policyReturns'))
    assert.strictEqual(s.items.find((i) => i.field === 'market')!.status, 'missing')
  })

  test('the monthly ad budget of 0 still has to be confirmed once', () => {
    assert.strictEqual(setupState(settings(), site()).items.find((i) => i.field === 'monthlySpendCapCents')!.status, 'unconfirmed')
    assert.strictEqual(setupState(settings({ confirmations: { monthlySpendCapCents: conf() } }), site()).items.find((i) => i.field === 'monthlySpendCapCents')!.status, 'confirmed')
  })

  test('a contact route the website settings cannot back is a warning', () => {
    assert.match(setupState(settings({ contactRoute: 'WHATSAPP' }), site({ whatsappNumber: null })).warnings.join(' '), /no WhatsApp number/)
    assert.deepStrictEqual(setupState(settings({ contactRoute: 'WHATSAPP' }), site()).warnings, [])
    assert.match(setupState(settings({ contactRoute: 'EMAIL' }), site()).warnings.join(' '), /no email/)
  })

  test('complete when every fact is answered and confirmed', () => {
    const all = Object.fromEntries(TRUTH_FIELDS.map((f) => [f, conf()]))
    const s = setupState(settings({
      shopDescription: 'a kids boutique', brandVoice: 'warm', audienceNotes: ['parents'], salesMode: 'RETAIL', market: 'Harare', currency: 'USD', timeZone: 'Africa/Harare',
      contactRoute: 'WHATSAPP', policyDelivery: null, policyReturns: null, policyOrdering: 'WhatsApp us', confirmations: all,
    }), site())
    assert.strictEqual(s.complete, true)
    assert.deepStrictEqual(s.toAsk, [])
  })

  test('stored confirmations are read defensively', () => {
    assert.deepStrictEqual(readConfirmations({ market: { by: 'mike', at: 'not a date' }, currency: 'x', nope: conf(), timeZone: conf() }), { timeZone: conf() })
    assert.deepStrictEqual(readConfirmations(null), {})
  })
})

describe('product truth (MM-01-AC4)', () => {
  test('withdrawn and sold-out pieces are excluded with a plain reason; in stock and pre-order are not', () => {
    assert.match(productBlockReason(product({ published: false })) ?? '', /not on the website/)
    assert.match(productBlockReason(product({ currentQuantity: 0 })) ?? '', /sold out/)
    assert.strictEqual(productBlockReason(product()), null)
    assert.strictEqual(productBlockReason(product({ listingType: 'PRE_ORDER', currentQuantity: 0 })), null)
  })

  test('a pre-order keeps its real ship window, printed on the stored calendar day', () => {
    const a = availabilityOf(product({ listingType: 'PRE_ORDER', currentQuantity: 0, preorderShipFrom: new Date('2027-01-05T00:00:00Z'), preorderShipTo: new Date('2027-01-20T00:00:00Z') }))
    assert.strictEqual(a.kind, 'PRE_ORDER')
    assert.strictEqual(availabilityLine(a), 'On pre-order: ships between 5 January 2027 and 20 January 2027. Not in stock yet.')
    assert.match(availabilityLine(availabilityOf(product({ listingType: 'PRE_ORDER' }))), /ship date is not known yet: never give one/)
  })
})

describe('retail and wholesale stay separate (MM-01-AC5)', () => {
  const terms = { wholesalePriceUsd: 12, wholesaleMinQuantity: 6 }
  test('a wholesale price is only offered when the shop sells wholesale and both terms are on file', () => {
    assert.deepStrictEqual(wholesaleOffer(terms, 'BOTH'), { ok: true, priceUsd: 12, minQuantity: 6 })
    assert.deepStrictEqual(wholesaleOffer(terms, 'WHOLESALE'), { ok: true, priceUsd: 12, minQuantity: 6 })
    assert.match((wholesaleOffer(terms, 'RETAIL') as { reason: string }).reason, /not said it sells wholesale/)
    assert.match((wholesaleOffer(terms, null) as { reason: string }).reason, /not said/)
    assert.match((wholesaleOffer({ wholesalePriceUsd: 12, wholesaleMinQuantity: null }, 'BOTH') as { reason: string }).reason, /minimum/)
    assert.match((wholesaleOffer({ wholesalePriceUsd: null, wholesaleMinQuantity: 6 }, 'BOTH') as { reason: string }).reason, /no wholesale price/)
    assert.match((wholesaleOffer({ wholesalePriceUsd: 0, wholesaleMinQuantity: 6 }, 'BOTH') as { reason: string }).reason, /no wholesale price/)
    assert.strictEqual(wholesaleText({ priceUsd: 12.5, minQuantity: 6 }), '$12.50 each when you buy 6 or more')
  })

  test('code fills {wholesale}; without terms the sentence is removed', () => {
    assert.strictEqual(fillPlaceholders('Pink dress. For shops: {wholesale}.', { productName: 'x', sellingPriceUsd: 40, priceDisplay: 'SHOW_PRICE', wholesaleText: '$12 each when you buy 6 or more' }), 'Pink dress. For shops: $12 each when you buy 6 or more.')
    assert.strictEqual(fillPlaceholders('Pink dress. For shops: {wholesale}.', { productName: 'x', sellingPriceUsd: 40, priceDisplay: 'SHOW_PRICE' }), 'Pink dress.')
  })
})

describe('unknown facts never become claims (MM-01-AC2)', () => {
  const none = truthFacts(product(), {})
  test('the writer is told what is not known, and the known policies in the owner\'s words', () => {
    const lines = truthLines(product(), { delivery: null, returns: 'Exchange within 7 days with the tag on.', salesMode: 'RETAIL' }).join('\n')
    assert.match(lines, /Availability: In stock\./)
    assert.match(lines, /Delivery: NOT KNOWN\. Never mention delivery/)
    assert.match(lines, /Returns \(the shop's own words\): Exchange within 7 days/)
    assert.match(lines, /Wholesale: NOT OFFERED/)
    assert.match(shopTruth({}).lines.join('\n'), /Delivery: NOT KNOWN/)
  })

  test('delivery, returns and wholesale words are caught when not known', () => {
    assert.match(truthProblems('Free delivery anywhere in Harare!', none).join(' '), /delivery policy is not known/)
    assert.match(truthProblems('We ship today.', none).join(' '), /delivery/)
    assert.match(truthProblems('Easy exchanges if it does not fit.', none).join(' '), /returns policy is not known/)
    assert.match(truthProblems('Ask about bulk prices for your shop.', none).join(' '), /wholesale/)
    assert.deepStrictEqual(truthProblems('Twirl-ready cotton for party days.', none), [])
  })

  test('known policies may be mentioned; the owner\'s own words in the brief are not a fault', () => {
    const known = truthFacts(product(), { delivery: 'We deliver in Harare in 2 days.', returns: 'Exchanges within 7 days.' })
    assert.deepStrictEqual(truthProblems('Delivered to your door in Harare. Easy exchanges.', known), [])
    assert.deepStrictEqual(truthProblems('Free delivery this week.', none, 'Owner note: free delivery this week'), [])
  })

  test('a pre-order is never "in stock" or "ready to ship"; its shipping words are allowed', () => {
    const pre = truthFacts(product({ listingType: 'PRE_ORDER', currentQuantity: 0, preorderShipFrom: new Date('2027-01-05T00:00:00Z') }), {})
    assert.match(truthProblems('In stock now, grab it!', pre).join(' '), /pre-order and not in stock/)
    assert.match(truthProblems('Ready to ship.', pre).join(' '), /pre-order/)
    assert.deepStrictEqual(truthProblems('On pre-order now, it ships from 5 January.', pre), [])
  })

  test('the writer\'s code check uses the truth, and the prompt carries the lines', () => {
    const facts = truthFacts(product(), {})
    const p = softProblems({ text: 'Free delivery today.', headline: null, description: null, subject: null }, { urgency: null, allowed: 'Delivery: NOT KNOWN. Never mention delivery', names: [], truth: facts, truthAllowed: '' })
    assert.match(p.truth.join(' '), /delivery policy is not known/)
    const input: DraftInput = { product: { productName: 'Pink dress', sellingPriceUsd: 40, priceDisplay: 'SHOW_PRICE' }, channels: ['X'], truth: { facts, lines: truthLines(product(), {}) } }
    assert.match(factsBlock(input), /Delivery: NOT KNOWN/)
    assert.match(factsBlock({ ...input, truth: null }), /never mention them/)
  })

  test('a draft that still promises delivery after the rewrite is thrown away, never shown', async () => {
    const facts = truthFacts(product(), {})
    const client = {
      messages: {
        create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ posts: [{ channel: 'X', text: 'Party days need twirl. Free delivery in Harare.', headline: null, description: null, subject: null, hashtags: [], openings: [] }] }) }], usage: { input_tokens: 10, output_tokens: 10 } }),
      },
    } as unknown as Pick<Anthropic, 'messages'>
    const r = await draftPosts({ product: { productName: 'Pink dress', sellingPriceUsd: 40, priceDisplay: 'SHOW_PRICE' }, channels: ['X'], check: false, truth: { facts, lines: truthLines(product(), {}) } }, { client })
    assert.strictEqual(r.drafts.length, 0)
    assert.match(r.failures[0].reason, /delivery policy is not known/)
  })
})
