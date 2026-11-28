// VYRA Marketing Manager (ZP-1119, MM-14): load the numbers behind the results page and the advice. Server only.
// The rules are in results-truth.ts (pure). Every figure comes with the ids of the records behind it (AC6).
import { Prisma } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { harareDayIndex } from './budget'
import { createCampaign, type CampaignDto } from './campaigns'
import { enquiryCounts } from './enquiries'
import { marketingSalesReport } from './sale-attribution'
import { getSettings } from './settings'
import { advice, truthReport, type Advice, type TruthReport } from './results-truth'

const DAY_MS = 86_400_000
const dayDate = (s: string) => new Date(`${s}T00:00:00.000Z`)
const cents = (usd: number) => Math.round(usd * 100)

export interface TruthRecords {
  creditedSaleIds: number[]
  /** The credited sales themselves, so the owner can check them (AC6). */
  creditedSales: { id: number; saleDate: string; total: number; customerName: string | null }[]
  adIds: number[]
  postIds: number[]
  /** The posts behind the numbers, with the content page each one belongs to. */
  posts: { id: number; contentId: number; title: string }[]
  broadcastIds: number[]
}

export interface TruthDto {
  from: string
  to: string
  campaignId: number | null
  currency: 'USD'
  /** When the platform numbers were last brought in, or null when never. */
  syncedAt: string | null
  report: TruthReport
  records: TruthRecords
}

/** The results with their meaning, for the whole shop or one campaign, over Harare days from..to. */
export async function loadTruth(db: Db, range: { from: string; to: string }, opts: { campaignId?: number | null } = {}): Promise<TruthDto> {
  const campaignId = opts.campaignId ?? null
  if (campaignId && !(await db.marketingCampaign.findUnique({ where: { id: campaignId }, select: { id: true } }))) throw new WebsiteError(404, 'Campaign not found')
  const day = { gte: dayDate(range.from), lte: dayDate(range.to) }
  const posts = await db.marketingPost.findMany({ where: campaignId ? { content: { campaignId } } : {}, select: { id: true, channelKind: true, trackingTag: true } })
  const ads = await db.marketingAd.findMany({ where: campaignId ? { campaignId } : {}, select: { id: true, channelKind: true, trackingTag: true } })
  const postIds = posts.map((p) => p.id)
  const adIds = ads.map((a) => a.id)
  const metrics = await db.marketingMetric.findMany({ where: { day, OR: [{ entity: 'POST', entityId: { in: postIds } }, { entity: 'AD', entityId: { in: adIds } }] } })
  const reported = metrics.filter((m) => m.raw !== null)
  const kindOf = new Map<string, string>([...posts.map((p) => [`POST:${p.id}`, p.channelKind] as const), ...ads.map((a) => [`AD:${a.id}`, a.channelKind] as const)])
  const platforms = [...new Set(reported.map((m) => kindOf.get(`${m.entity}:${m.entityId}`) ?? m.entity))].sort()
  const sum = (rows: typeof metrics, k: 'reach' | 'impressions' | 'clicks' | 'spendCents') => rows.reduce((s, m) => s + m[k], 0)
  const adRows = metrics.filter((m) => m.entity === 'AD')
  const adSpendKnown = adIds.length === 0 || adRows.some((m) => m.raw !== null)

  // Website numbers: the whole shop from the rollup; one campaign from its tracking tags.
  const tags = [...posts.map((p) => p.trackingTag), ...ads.map((a) => a.trackingTag)].filter((t): t is string => Boolean(t))
  const web = await db.analyticsDailySource.aggregate({ where: { day, ...(campaignId ? { campaign: { in: tags } } : {}) }, _sum: { visits: true, enquiringVisits: true } })
  const tracked = (await db.analyticsDailySource.count()) > 0

  const sales = await marketingSalesReport(db, range)
  const credited = campaignId ? sales.campaigns.filter((c) => c.campaignId === campaignId) : sales.campaigns
  const creditedNetCents = credited.reduce((s, c) => s + cents(c.net), 0)
  const creditedCount = credited.reduce((s, c) => s + c.salesCount, 0)
  const attrs = await db.marketingSaleAttribution.findMany({ where: { campaignId: campaignId ?? { not: null }, needsReview: false }, select: { saleId: true } })
  const creditedSales = await db.sale.findMany({
    where: { id: { in: attrs.map((a) => a.saleId) }, status: { not: 'CANCELLED' }, saleDate: { gte: new Date(`${range.from}T00:00:00`), lte: new Date(`${range.to}T23:59:59.999`) } },
    select: { id: true, saleDate: true, totalAmount: true, customerName: true, items: { select: { quantity: true, product: { select: { unitCostUsd: true } } } } },
  })
  // Cost of goods only when every sold piece has a cost on file (an imported sale has no pieces, so it is unknown).
  let goodsCostCents: number | null = 0
  for (const s of creditedSales) {
    if (s.items.length === 0 || s.items.some((it) => !(it.product.unitCostUsd > 0))) { goodsCostCents = null; break }
    goodsCostCents += s.items.reduce((t, it) => t + cents(it.product.unitCostUsd) * it.quantity, 0)
  }

  // Messages: what was handed to a provider in these days, at the cost per message the owner set.
  const settings = await getSettings(db)
  // Messages belong to no campaign, so a campaign's costs are its ads only.
  const sent = campaignId ? [] : await db.marketingBroadcastRecipient.findMany({
    where: { status: 'SENT', sentAt: { gte: new Date(`${range.from}T00:00:00`), lte: new Date(`${range.to}T23:59:59.999`) } },
    select: { broadcast: { select: { id: true, channelKind: true } } },
  })
  const unit = (settings.messageCostCents ?? {}) as Record<string, unknown>
  let messageCostCents: number | null = 0
  for (const r of sent) {
    const u = unit[r.broadcast.channelKind]
    if (typeof u !== 'number') { messageCostCents = null; break }
    messageCostCents += u
  }
  if (messageCostCents !== null) messageCostCents = Math.round(messageCostCents)

  const conv = campaignId
    ? await db.marketingEnquiry.groupBy({ by: ['conversation'], where: { campaignId, createdAt: { gte: new Date(`${range.from}T00:00:00`), lte: new Date(`${range.to}T23:59:59.999`) } }, _count: { _all: true } })
      .then((rows) => ({ ownerRecorded: rows.find((r) => r.conversation === 'OWNER_RECORDED')?._count._all ?? 0, providerObserved: rows.find((r) => r.conversation === 'PROVIDER_OBSERVED')?._count._all ?? 0, won: 0 }))
    : await enquiryCounts(db, { from: new Date(`${range.from}T00:00:00`), to: new Date(`${range.to}T23:59:59.999`) })

  const report = truthReport({
    platform: { reach: sum(metrics, 'reach'), impressions: sum(metrics, 'impressions'), clicks: sum(metrics, 'clicks'), reported: reported.length > 0, platforms },
    website: { visits: web._sum.visits ?? 0, taps: web._sum.enquiringVisits ?? 0, tracked },
    conversations: { ownerRecorded: conv.ownerRecorded, providerObserved: conv.providerObserved, won: conv.won },
    sales: { allShopNetCents: cents(sales.allShop.net), allShopCount: sales.allShop.salesCount, creditedNetCents, creditedCount },
    costs: { adSpendCents: sum(adRows, 'spendCents'), adSpendKnown, messageCostCents, messagesSent: sent.length },
    campaignId,
    goodsCostCents: creditedSales.length ? goodsCostCents : 0,
    fulfilmentCostCents: null,
  })
  const postIdsWithNumbers = [...new Set(metrics.filter((m) => m.entity === 'POST').map((m) => m.entityId))].sort((a, b) => a - b)
  const postRows = await db.marketingPost.findMany({ where: { id: { in: postIdsWithNumbers } }, select: { id: true, contentId: true, content: { select: { title: true } } }, orderBy: { id: 'asc' } })
  const last = await db.marketingMetric.findFirst({ where: { NOT: { raw: { equals: Prisma.AnyNull } } }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } })
  return {
    from: range.from, to: range.to, campaignId, currency: 'USD',
    syncedAt: last?.updatedAt.toISOString() ?? null,
    report,
    records: {
      creditedSaleIds: creditedSales.map((s) => s.id).sort((a, b) => a - b),
      creditedSales: creditedSales.map((s) => ({ id: s.id, saleDate: s.saleDate.toISOString(), total: s.totalAmount, customerName: s.customerName })).sort((a, b) => a.id - b.id),
      adIds: [...new Set(adRows.filter((m) => m.spendCents > 0).map((m) => m.entityId))].sort((a, b) => a - b),
      postIds: postIdsWithNumbers,
      posts: postRows.map((p) => ({ id: p.id, contentId: p.contentId, title: p.content.title })),
      broadcastIds: [...new Set(sent.map((r) => r.broadcast.id))].sort((a, b) => a - b),
    },
  }
}

/** Advice from the current campaigns, stock, waiting customers and budget (AC7/AC8). */
export async function loadAdvice(db: Db, range: { from: string; to: string }, now = new Date()): Promise<Advice[]> {
  const day = { gte: dayDate(range.from), lte: dayDate(range.to) }
  const campaigns = await db.marketingCampaign.findMany({ where: { shopKey: 'vyra', status: { in: ['ACTIVE', 'SCHEDULED'] } }, include: { products: { select: { productId: true } } } })
  const sales = await marketingSalesReport(db, range)
  const perCampaign = await Promise.all(campaigns.map(async (c) => {
    const posts = await db.marketingPost.findMany({ where: { content: { campaignId: c.id } }, select: { trackingTag: true } })
    const ads = await db.marketingAd.findMany({ where: { campaignId: c.id }, select: { trackingTag: true } })
    const tags = [...posts, ...ads].map((x) => x.trackingTag).filter((t): t is string => Boolean(t))
    const web = tags.length ? await db.analyticsDailySource.aggregate({ where: { day, campaign: { in: tags } }, _sum: { visits: true, enquiringVisits: true } }) : { _sum: { visits: 0, enquiringVisits: 0 } }
    return {
      id: c.id, name: c.name, status: c.status, productIds: c.products.map((p) => p.productId),
      creditedSales: sales.campaigns.find((x) => x.campaignId === c.id)?.salesCount ?? 0,
      visits: web._sum.visits ?? 0, taps: web._sum.enquiringVisits ?? 0,
    }
  }))
  const products = await db.product.findMany({ where: { published: true }, select: { id: true, productName: true, publicName: true, published: true, currentQuantity: true, listingType: true, sellingPriceUsd: true }, orderBy: { id: 'asc' }, take: 500 })
  const openEnquiries = await db.marketingEnquiry.findMany({ where: { shopKey: 'vyra', status: { in: ['NEW', 'CONTACTED', 'WAITING'] } }, select: { id: true, status: true, createdAt: true, nextFollowUpAt: true }, orderBy: { id: 'asc' } })
  const settings = await getSettings(db)
  const monthStart = new Date(harareDayIndex(now) * DAY_MS)
  monthStart.setUTCDate(1)
  const spent = await db.marketingMetric.aggregate({ where: { entity: 'AD', day: { gte: monthStart } }, _sum: { spendCents: true } })
  const web = await db.analyticsDailySource.aggregate({ where: { day }, _sum: { visits: true, enquiringVisits: true } })
  return advice({
    campaigns: perCampaign,
    products: products.map((p) => ({ id: p.id, name: p.publicName?.trim() || p.productName, published: p.published, inStock: p.currentQuantity > 0 || String(p.listingType) === 'PRE_ORDER', priceUsd: p.sellingPriceUsd })),
    openEnquiries,
    budget: { monthlyCapCents: settings.monthlySpendCapCents, spentThisMonthCents: spent._sum.spendCents ?? 0 },
    shop: { deliveryPolicy: settings.policyDelivery },
    website: { visits: web._sum.visits ?? 0, taps: web._sum.enquiringVisits ?? 0 },
    now,
  })
}

/**
 * AC7: accepting advice creates a DRAFT campaign and nothing else: no post, no ad, no spend, no change to products.
 * The advice is worked out again now, so only advice that still holds can be accepted.
 */
export async function acceptAdvice(db: Db, range: { from: string; to: string }, key: unknown, actor: string, now = new Date()): Promise<CampaignDto> {
  if (typeof key !== 'string' || !key) throw new WebsiteError(400, 'Which advice?', { field: 'key' })
  const found = (await loadAdvice(db, range, now)).find((a) => a.key === key)
  if (!found) throw new WebsiteError(409, 'That advice no longer applies. Reload to see the current advice.')
  if (!found.draft) throw new WebsiteError(409, 'This advice is for you to act on. It does not make a campaign.')
  const campaign = await createCampaign(db, { name: found.draft.name, status: 'DRAFT', productIds: found.draft.productIds, notes: `From advice: ${found.title}. ${found.evidence.join(' ')}`.slice(0, 1000) }, actor)
  await writeAudit(db, { actor, action: 'results.advice_accepted', entity: 'campaign', entityId: campaign.id, detail: { key, title: found.title } })
  return campaign
}
