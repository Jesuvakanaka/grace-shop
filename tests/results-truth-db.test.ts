// ZP-1119 (MM-14): results meaning, the records behind them, and accepting advice, against DATABASE_URL.
// Only touches rows it creates: products ZP1119-*, campaign/content/post/ad it makes, metrics of those, analytics
// rows tagged with its own tag, sales on 2034-05 dates.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import { resultsReport } from '../src/lib/marketing/results'
import { acceptAdvice, loadAdvice, loadTruth } from '../src/lib/marketing/results-truth-db'
import { WebsiteError } from '../src/lib/website/http'

const OWNER = 'zp1119-owner'
const range = { from: '2034-05-01', to: '2034-05-31' }
const at = (d: string) => new Date(`${d}T10:00:00.000Z`)
const tag = `zp1119${Date.now().toString(36)}`
const ids = { campaign: 0, content: 0, post: 0, ad: 0, sale: 0, products: [] as number[], extraCampaigns: [] as number[] }

before(async () => {
  ids.campaign = (await prisma.marketingCampaign.create({ data: { name: 'ZP1119 Linen', status: 'ACTIVE', startsAt: at('2034-04-01') } })).id
  for (const n of [1, 2]) {
    ids.products.push((await prisma.product.create({ data: { itemNumber: `ZP1119-${n}-${tag}`, productName: `ZP1119 piece ${n}`, sellingPriceUsd: 30, unitCostUsd: n === 1 ? 12 : 0, published: true, currentQuantity: 5 } })).id)
  }
  await prisma.marketingCampaignProduct.create({ data: { campaignId: ids.campaign, productId: ids.products[0] } })
  ids.content = (await prisma.marketingContent.create({ data: { title: 'ZP1119 content', campaignId: ids.campaign, createdBy: OWNER } })).id
  ids.post = (await prisma.marketingPost.create({ data: { contentId: ids.content, channelKind: 'INSTAGRAM', text: 'x', trackingTag: `${tag}p`, status: 'PUBLISHED', publishedAt: at('2034-04-20') } })).id
  const s = await prisma.sale.create({ data: { saleDate: at('2034-05-10'), paymentType: 'CASH', totalAmount: 30, cashAmount: 30, items: { create: [{ productId: ids.products[0], quantity: 1, unitPrice: 30, totalAmount: 30 }] } } })
  ids.sale = s.id
  await prisma.marketingSaleAttribution.create({ data: { saleId: s.id, source: 'CUSTOMER_REPORTED', campaignId: ids.campaign, evidence: 'Saw the reel', createdBy: OWNER, updatedBy: OWNER } })
  await prisma.analyticsDailySource.create({ data: { day: new Date('2034-05-10T00:00:00Z'), source: 'instagram', deviceClass: 'phone', campaign: `${tag}p`, visits: 40, enquiringVisits: 4 } })
})

after(async () => {
  await prisma.marketingSaleAttribution.deleteMany({ where: { saleId: ids.sale } })
  await prisma.saleItem.deleteMany({ where: { saleId: ids.sale } })
  await prisma.sale.deleteMany({ where: { id: ids.sale } })
  await prisma.marketingMetric.deleteMany({ where: { entity: 'POST', entityId: ids.post } })
  await prisma.analyticsDailySource.deleteMany({ where: { campaign: `${tag}p` } })
  await prisma.marketingPost.deleteMany({ where: { id: ids.post } })
  await prisma.marketingContent.deleteMany({ where: { id: ids.content } })
  await prisma.marketingCampaignProduct.deleteMany({ where: { campaignId: { in: [ids.campaign, ...ids.extraCampaigns] } } })
  await prisma.marketingCampaign.deleteMany({ where: { id: { in: [ids.campaign, ...ids.extraCampaigns] } } })
  await prisma.product.deleteMany({ where: { id: { in: ids.products } } })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: OWNER } })
  await prisma.$disconnect()
})

describe('MM-14 against the real ledger', () => {
  test('AC3: platform numbers never reported are unknown; website and sales numbers are known for the campaign', async () => {
    const t = await loadTruth(prisma, range, { campaignId: ids.campaign })
    assert.strictEqual(t.report.reach.state, 'UNKNOWN')
    assert.strictEqual(t.report.clicks.state, 'UNKNOWN')
    assert.deepStrictEqual([t.report.visits.value, t.report.taps.value, t.report.tapRate.value], [40, 4, 10])
    assert.deepStrictEqual([t.report.sales.creditedCount.value, t.report.sales.creditedNet.value], [1, 30])
    assert.strictEqual(t.currency, 'USD')
  })

  test('AC1 and AC3 on the tables: a row with only website numbers has no reported platform days, so the page shows Unknown, not 0', async () => {
    // The analytics rollup writes visits onto the post's daily row with no platform payload (raw stays null).
    await prisma.marketingMetric.create({ data: { entity: 'POST', entityId: ids.post, day: new Date('2034-05-10T00:00:00Z'), visits: 40, enquiries: 4 } })
    const r = await resultsReport(prisma, range)
    const row = r.perPost.find((p) => p.postId === ids.post)!
    assert.deepStrictEqual([row.visits, row.reportedDays, row.reach, row.impressions, row.clicks], [40, 0, 0, 0, 0])
    const campaignRow = r.perCampaign.find((c) => c.key === String(ids.campaign))!
    assert.strictEqual(campaignRow.reportedDays, 0)
    // The panel for the same campaign agrees: unknown.
    assert.strictEqual((await loadTruth(prisma, range, { campaignId: ids.campaign })).report.reach.state, 'UNKNOWN')
  })

  test('one campaign: messages are not tied to it, so its cost is its ad spend only; posts link to their content', async () => {
    const t = await loadTruth(prisma, range, { campaignId: ids.campaign })
    const msg = t.report.costs.items.find((m) => m.label === 'Messages sent')!
    assert.strictEqual(msg.state, 'NOT_AVAILABLE')
    assert.match(msg.note ?? '', /not tied to a campaign/)
    assert.doesNotMatch(JSON.stringify(t.report.costs), /No messages were sent/)
    assert.deepStrictEqual([t.report.costs.total.state, t.report.costs.total.value], ['KNOWN', 0])
    assert.deepStrictEqual(t.records.posts, [{ id: ids.post, contentId: ids.content, title: 'ZP1119 content' }])
    assert.ok(t.report.notes.some((n) => /day money came in/.test(n)))
  })

  test('AC1 and AC6: once a platform reports, reach is summed reported reach; the records behind the numbers are listed', async () => {
    await prisma.marketingMetric.create({ data: { entity: 'POST', entityId: ids.post, day: new Date('2034-05-11T00:00:00Z'), reach: 300, impressions: 500, clicks: 9, raw: { lifetime: { reach: 300 } } } })
    const t = await loadTruth(prisma, range, { campaignId: ids.campaign })
    assert.deepStrictEqual([t.report.reach.state, t.report.reach.value, t.report.reach.label], ['KNOWN', 300, 'Summed reported reach'])
    assert.deepStrictEqual(t.records.creditedSaleIds, [ids.sale])
    assert.deepStrictEqual(t.records.postIds, [ids.post])
    assert.ok(t.syncedAt)
    // The tables now count that reported day, and show the same reach as the panel.
    const row = (await resultsReport(prisma, range)).perPost.find((p) => p.postId === ids.post)!
    assert.deepStrictEqual([row.reportedDays, row.reach, row.impressions, row.clicks], [1, 300, 500, 9])
  })

  test('AC4: a sold piece with no cost on file keeps contribution unavailable; fulfilment is never on file', async () => {
    const t = await loadTruth(prisma, range, { campaignId: ids.campaign })
    assert.strictEqual(t.report.contribution.state, 'NOT_AVAILABLE')
    assert.deepStrictEqual(t.report.contribution.missing, ['delivery and packing costs'], 'piece 1 has a cost, so only fulfilment is missing')
  })

  test('AC5: no ads in the campaign: ad spend is known 0 and return on ads is not available', async () => {
    const t = await loadTruth(prisma, range, { campaignId: ids.campaign })
    assert.deepStrictEqual([t.report.costs.items[0].state, t.report.costs.items[0].value], ['KNOWN', 0])
    assert.strictEqual(t.report.roas.state, 'NOT_AVAILABLE')
  })

  test('AC7: accepting advice creates a draft campaign and changes nothing else; stale advice is refused', async () => {
    const advice = await loadAdvice(prisma, range, at('2034-05-20'))
    const idle = advice.find((a) => a.key.startsWith('idle-stock') && a.draft?.productIds.includes(ids.products[1]))
    assert.ok(idle, 'piece 2 is in stock and in no live campaign')
    const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: ids.products[1] } })).currentQuantity
    const c = await acceptAdvice(prisma, range, idle!.key, OWNER, at('2034-05-20'))
    ids.extraCampaigns.push(c.id)
    assert.strictEqual(c.status, 'DRAFT')
    assert.ok(c.productIds.includes(ids.products[1]))
    // Nothing hangs off the draft and stock is untouched. Counted for this campaign only, because other test files
    // running at the same time add and remove their own posts and ads.
    assert.deepStrictEqual({
      content: await prisma.marketingContent.count({ where: { campaignId: c.id } }),
      ads: await prisma.marketingAd.count({ where: { campaignId: c.id } }),
      stock: (await prisma.product.findUniqueOrThrow({ where: { id: ids.products[1] } })).currentQuantity,
    }, { content: 0, ads: 0, stock: stockBefore })
    await assert.rejects(() => acceptAdvice(prisma, range, 'idle-stock-0', OWNER), (e: unknown) => e instanceof WebsiteError && e.status === 409)
    const forOwner = advice.find((a) => a.draft === null)
    if (forOwner) await assert.rejects(() => acceptAdvice(prisma, range, forOwner.key, OWNER, at('2034-05-20')), (e: unknown) => e instanceof WebsiteError && e.status === 409)
  })

  test('AC6: a live campaign with one sale is "too early to judge"', async () => {
    const advice = await loadAdvice(prisma, range, at('2034-05-20'))
    const early = advice.find((a) => a.key === `too-early-${ids.campaign}`)
    assert.ok(early)
    assert.match(early!.evidence[0], /1 credited sale and 40 visits/)
  })
})
