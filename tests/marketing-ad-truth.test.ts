// ZP-1106 (MM-01-AC2): AI ad copy and weekly advice prompts name the shop from settings, and ad copy is
// checked against the product's truth. Pure: no database, no model.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { adSystemPrompt, adTruthLines, adTruthProblems, validateAdCopy } from '../src/lib/marketing/ai/ad-copy'
import { recommendSystemPrompt } from '../src/lib/marketing/ai/recommend'
import { shopIdentity } from '../src/lib/marketing/ai/shop'
import { shopTruth, truthFacts, type TruthProduct } from '../src/lib/marketing/product-truth'
import { splitAdCopy } from '../src/lib/marketing/connectors/google-ads'
import { WebsiteError } from '../src/lib/website/http'

const base: TruthProduct = {
  id: 1, productName: 'Pink Dress', published: true, listingType: 'IN_STOCK', currentQuantity: 3,
  preorderShipFrom: null, preorderShipTo: null, wholesalePriceUsd: null, wholesaleMinQuantity: null,
}
const unknown = { delivery: null, returns: null, salesMode: 'RETAIL' }

describe('prompts name the shop from settings, never a hardcoded town', () => {
  test('ad copy: description from settings, market only when set', () => {
    const shop = shopIdentity({ shopDescription: 'a family clothing shop.' })
    const p = adSystemPrompt(shop, null)
    assert.match(p, /for VYRA, a family clothing shop, in warm British English/)
    assert.doesNotMatch(p, /Harare|luxury/)
    assert.match(adSystemPrompt(shop, 'Bulawayo'), /a family clothing shop in Bulawayo,/)
    assert.match(adSystemPrompt(shop, '  '), /a family clothing shop, in warm/)
  })
  test('weekly advice: the same rule', () => {
    const shop = shopIdentity(null)
    const p = recommendSystemPrompt(shop, null)
    assert.match(p, new RegExp(`owner of VYRA, ${shop.description}, understand`))
    assert.doesNotMatch(p, /Harare/)
    assert.match(recommendSystemPrompt(shop, 'Harare'), /in Harare, understand/)
  })
  test('Google Ads filler lines claim no town, visit or delivery', () => {
    const out = splitAdCopy({ headline: 'Pink dress', primaryText: 'Soft.', description: null })
    const all = [...out.headlines, ...out.descriptions].join(' ')
    assert.doesNotMatch(all, /Harare|in store|deliver/i)
  })
})

describe('ad truth lines carry no numbers and say what is unknown', () => {
  test('unknown policies and no wholesale become never-mention lines', () => {
    const lines = adTruthLines(truthFacts(base, unknown), unknown)
    assert.ok(lines.includes('Delivery: NOT KNOWN. Never mention delivery, shipping or couriers.'))
    assert.ok(lines.includes('Returns: NOT KNOWN. Never mention returns, exchanges or refunds.'))
    assert.ok(lines.some((l) => /^Wholesale: NOT OFFERED/.test(l)))
    assert.ok(lines.every((l) => !/\d|price/i.test(l)), 'no figures, no price words')
  })
  test('a pre-order is said without a date; known policies are the owner\'s words', () => {
    const p = { ...base, listingType: 'PRE_ORDER', currentQuantity: 0, preorderShipFrom: new Date('2026-12-01T00:00:00Z'), preorderShipTo: new Date('2026-12-15T00:00:00Z') }
    const shop = { delivery: 'We deliver in town.', returns: null, salesMode: 'BOTH' }
    const lines = adTruthLines(truthFacts(p, shop), shop)
    assert.ok(lines.some((l) => /on pre-order, not in stock yet.*never give a date/.test(l)))
    assert.ok(lines.includes("Delivery (the shop's own words): We deliver in town."))
    assert.ok(lines.every((l) => !/\d/.test(l)))
  })
  test('with no product only the shop policies apply', () => {
    const lines = adTruthLines(shopTruth(unknown).facts, unknown)
    assert.ok(!lines.some((l) => /^Availability/.test(l)))
  })
})

describe('adTruthProblems checks headline, text and description', () => {
  const facts = truthFacts(base, unknown)
  const ad = (headline: string, primaryText = 'Our pink dress.', description: string | null = null) => ({ headline, primaryText, description })
  test('each unknown claim is found, wherever it is', () => {
    assert.match(adTruthProblems(ad('Free delivery'), facts).join(' '), /delivery/)
    assert.match(adTruthProblems(ad('Pink', 'Easy exchanges.'), facts).join(' '), /returns/)
    assert.match(adTruthProblems(ad('Pink', 'Soft.', 'Bulk orders welcome'), facts).join(' '), /wholesale/)
    assert.deepStrictEqual(adTruthProblems(ad('Pink perfection', 'Message us on WhatsApp.'), facts), [])
  })
  test('in-stock words on a pre-order are refused', () => {
    const p = truthFacts({ ...base, listingType: 'PRE_ORDER', currentQuantity: 0 }, unknown)
    assert.match(adTruthProblems(ad('Pink', 'In stock now.'), p).join(' '), /pre-order/)
  })
  test('words the owner wrote are not faults', () => {
    assert.deepStrictEqual(adTruthProblems(ad('Free delivery'), facts, 'Brief: free delivery this week'), [])
  })
  test('a placeholder is never left in an ad', () => {
    assert.throws(() => validateAdCopy(ad('Pink', 'Buy at {wholesale}')), (e: unknown) => e instanceof WebsiteError && /placeholder/.test(e.message))
  })
})
