// VYRA Marketing hub (ZP-1200): results. Server only.
// Daily MarketingMetric rows for posts (entity 'POST'): visits and enquiries from the analytics rollup where
// campaign = the post's tracking tag, impressions / reach / clicks from the connector's fetchInsights (read only,
// so no go-live gate: it needs saved credentials only). Ads reuse syncAd (entity 'AD'). The report adds it all up.
import type { MarketingChannel, MarketingPost, Prisma } from '@prisma/client'
import { syncAd, type AdDeps } from './ads'
import { writeAudit, type Db } from './audit'
import { harareDayIndex } from './budget'
import { getConnector } from './connectors'
import type { Connector, FetchLike } from './connectors/types'
import { decryptJson } from './secrets'
import type { Actor } from './state'
import { WebsiteError } from '@/lib/website/http'

const DAY_MS = 86_400_000
export const MAX_REPORT_DAYS = 366

export const ymd = (d: Date) => d.toISOString().slice(0, 10)
const dayDate = (s: string) => new Date(`${s}T00:00:00.000Z`)
/** The Harare calendar day of an instant, as YYYY-MM-DD. */
export const hararedayString = (d: Date) => ymd(new Date(harareDayIndex(d) * DAY_MS))

export interface Totals {
  impressions: number
  reach: number
  clicks: number
  visits: number
  enquiries: number
  spendCents: number
  /** Daily rows a platform actually reported (raw is set). 0 means reach, times shown and clicks are unknown, not 0. */
  reportedDays: number
}
export const zeroTotals = (): Totals => ({ impressions: 0, reach: 0, clicks: 0, visits: 0, enquiries: 0, spendCents: 0, reportedDays: 0 })
const addTo = (t: Totals, m: Partial<Totals>) => {
  t.impressions += m.impressions ?? 0
  t.reach += m.reach ?? 0
  t.clicks += m.clicks ?? 0
  t.visits += m.visits ?? 0
  t.enquiries += m.enquiries ?? 0
  t.spendCents += m.spendCents ?? 0
  t.reportedDays += m.reportedDays ?? 0
}

export interface ResultsDeps {
  fetch: FetchLike
  now?: Date
  getConnector?: (kind: string) => Connector | undefined
}

// ───────────────────────── sync ─────────────────────────

export interface PostSyncOutcome { postId: number; insights: 'ok' | 'skipped' | 'failed'; error?: string }

async function channelOf(db: Db, post: Pick<MarketingPost, 'channelId' | 'channelKind'>): Promise<MarketingChannel | null> {
  const c = post.channelId
    ? await db.marketingChannel.findUnique({ where: { id: post.channelId } })
    : await db.marketingChannel.findFirst({ where: { kind: post.channelKind, status: 'CONNECTED' } })
  return c && c.status === 'CONNECTED' && c.credentialsEnc ? c : null
}

/** Sync one post: analytics (visits, enquiries) for its tag, plus platform insights when the channel is connected. */
export async function syncPostResults(db: Db, postId: number, deps: ResultsDeps): Promise<PostSyncOutcome> {
  const now = deps.now ?? new Date()
  const post = await db.marketingPost.findUnique({ where: { id: postId } })
  if (!post) throw new WebsiteError(404, 'Post not found')
  const today = hararedayString(now)

  // Visits and enquiries per day from the analytics rollup.
  const from = post.publishedAt ? dayDate(hararedayString(post.publishedAt)) : dayDate(hararedayString(new Date(now.getTime() - 60 * DAY_MS)))
  const rows = await db.analyticsDailySource.findMany({ where: { campaign: post.trackingTag, day: { gte: from } } })
  const perDay = new Map<string, { visits: number; enquiries: number }>()
  for (const r of rows) {
    const k = ymd(r.day)
    const cur = perDay.get(k) ?? { visits: 0, enquiries: 0 }
    cur.visits += r.visits
    cur.enquiries += r.enquiringVisits
    perDay.set(k, cur)
  }
  for (const [k, v] of perDay) {
    const key = { entity_entityId_day: { entity: 'POST', entityId: postId, day: dayDate(k) } }
    await db.marketingMetric.upsert({
      where: key,
      update: { visits: v.visits, enquiries: v.enquiries },
      create: { entity: 'POST', entityId: postId, day: dayDate(k), visits: v.visits, enquiries: v.enquiries },
    })
  }

  // Platform insights (read only). They are lifetime totals, so today's row gets the difference from earlier days.
  let outcome: PostSyncOutcome = { postId, insights: 'skipped' }
  const connector = (deps.getConnector ?? getConnector)(post.channelKind)
  if (post.status === 'PUBLISHED' && post.externalId && connector?.fetchInsights) {
    const channel = await channelOf(db, post)
    if (channel?.credentialsEnc) {
      const res = await connector.fetchInsights(post.externalId, {
        credentials: decryptJson<Record<string, string>>(channel.credentialsEnc),
        externalId: channel.externalId,
        config: (channel.config ?? null) as Record<string, unknown> | null,
        fetch: deps.fetch,
      })
      if (!res.ok) outcome = { postId, insights: 'failed', error: res.error }
      else {
        const before = await db.marketingMetric.aggregate({
          where: { entity: 'POST', entityId: postId, day: { lt: dayDate(today) } },
          _sum: { impressions: true, reach: true, clicks: true },
        })
        const delta = (life: number | undefined, prev: number | null | undefined) => (typeof life === 'number' ? Math.max(0, Math.round(life) - (prev ?? 0)) : undefined)
        const data: Prisma.MarketingMetricUncheckedUpdateInput = {}
        const i = delta(res.metrics.impressions, before._sum.impressions)
        const r = delta(res.metrics.reach, before._sum.reach)
        const c = delta(res.metrics.clicks, before._sum.clicks)
        if (i !== undefined) data.impressions = i
        if (r !== undefined) data.reach = r
        if (c !== undefined) data.clicks = c
        data.raw = { lifetime: res.metrics } as Prisma.InputJsonValue
        const key = { entity_entityId_day: { entity: 'POST', entityId: postId, day: dayDate(today) } }
        await db.marketingMetric.upsert({ where: key, update: data, create: { entity: 'POST', entityId: postId, day: dayDate(today), ...(data as object) } })
        outcome = { postId, insights: 'ok' }
      }
    }
  }
  return outcome
}

export interface SyncSummary {
  posts: number
  postInsightsFailed: { postId: number; error: string }[]
  ads: number
  adsFailed: { adId: number; error: string }[]
}

/** Sync every post that went out in the last 60 days and every ad that is on Meta. One failure never stops the rest. */
export async function syncAllResults(db: Db, actorIn: Actor | string, deps: ResultsDeps): Promise<SyncSummary> {
  const actor: Actor = typeof actorIn === 'string' ? { username: actorIn, role: 'OWNER' } : actorIn
  const now = deps.now ?? new Date()
  const since = new Date(now.getTime() - 60 * DAY_MS)
  const posts = await db.marketingPost.findMany({
    where: { status: { in: ['PUBLISHED', 'SHARED'] }, OR: [{ publishedAt: { gte: since } }, { publishedAt: null }] },
    select: { id: true }, orderBy: { id: 'asc' }, take: 500,
  })
  const summary: SyncSummary = { posts: 0, postInsightsFailed: [], ads: 0, adsFailed: [] }
  for (const p of posts) {
    try {
      const o = await syncPostResults(db, p.id, deps)
      summary.posts++
      if (o.insights === 'failed') summary.postInsightsFailed.push({ postId: p.id, error: o.error ?? 'failed' })
    } catch (e) {
      summary.postInsightsFailed.push({ postId: p.id, error: e instanceof Error ? e.message : 'failed' })
    }
  }
  const ads = await db.marketingAd.findMany({ where: { externalAdId: { not: null }, status: { in: ['ACTIVE', 'PAUSED_ON_PLATFORM'] } }, select: { id: true }, orderBy: { id: 'asc' } })
  const adDeps: AdDeps = { fetch: deps.fetch, now }
  for (const a of ads) {
    try {
      await syncAd(db, a.id, actor, adDeps)
      summary.ads++
    } catch (e) {
      summary.adsFailed.push({ adId: a.id, error: e instanceof Error ? e.message : 'failed' })
    }
  }
  await writeAudit(db, { actor: actor.username, action: 'results.sync', entity: 'results', detail: { posts: summary.posts, ads: summary.ads, failed: summary.postInsightsFailed.length + summary.adsFailed.length } })
  return summary
}

// ───────────────────────── report ─────────────────────────

export interface ResultRow extends Totals {
  key: string
  label: string
  posts: number
  ads: number
}

export interface ResultsReport {
  from: string
  to: string
  totals: Totals
  perPost: (ResultRow & { postId: number; channelKind: string; status: string; publishedAt: string | null; trackingTag: string })[]
  perChannel: ResultRow[]
  perCampaign: ResultRow[]
  perProduct: ResultRow[]
  perAd: (ResultRow & { adId: number; status: string })[]
  spendCents: number
}

/** Parse ?from=&to= (YYYY-MM-DD). Defaults to the last 30 Harare days. */
export function parseRange(from: string | null | undefined, to: string | null | undefined, now: Date = new Date()): { from: string; to: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/
  const valid = (s: string) => re.test(s) && !Number.isNaN(dayDate(s).getTime()) && ymd(dayDate(s)) === s
  const end = to ? to : hararedayString(now)
  if (!valid(end)) throw new WebsiteError(400, 'The end date is not a date (use YYYY-MM-DD).', { field: 'to' })
  const start = from ? from : ymd(new Date(dayDate(end).getTime() - 29 * DAY_MS))
  if (!valid(start)) throw new WebsiteError(400, 'The start date is not a date (use YYYY-MM-DD).', { field: 'from' })
  if (start > end) throw new WebsiteError(400, 'The start date must not be after the end date.', { field: 'from' })
  if ((dayDate(end).getTime() - dayDate(start).getTime()) / DAY_MS + 1 > MAX_REPORT_DAYS) throw new WebsiteError(400, 'Choose a range of at most a year.', { field: 'from' })
  return { from: start, to: end }
}

type Acc = Map<string, ResultRow>
function bump(map: Acc, key: string, label: string, m: Partial<Totals>, kind: 'post' | 'ad') {
  const row = map.get(key) ?? { key, label, posts: 0, ads: 0, ...zeroTotals() }
  addTo(row, m)
  map.set(key, row)
  return row
}
const sumMetrics = (rows: { entityId: number; impressions: number; reach: number; clicks: number; spendCents: number; enquiries: number; visits: number; raw: unknown }[]) => {
  const m = new Map<number, Totals>()
  for (const r of rows) {
    const t = m.get(r.entityId) ?? zeroTotals()
    addTo(t, { ...r, reportedDays: r.raw !== null ? 1 : 0 })
    m.set(r.entityId, t)
  }
  return m
}

/** Totals per post, channel, campaign and product for a date range, plus spend from ads. Pure maths over stored rows. */
export async function resultsReport(db: Db, range: { from: string; to: string }): Promise<ResultsReport> {
  const dayWhere = { gte: dayDate(range.from), lte: dayDate(range.to) }
  const [postMetrics, adMetrics] = await Promise.all([
    db.marketingMetric.findMany({ where: { entity: 'POST', day: dayWhere } }),
    db.marketingMetric.findMany({ where: { entity: 'AD', day: dayWhere } }),
  ])
  const postTotals = sumMetrics(postMetrics)
  const adTotals = sumMetrics(adMetrics)
  const posts = await db.marketingPost.findMany({
    where: { id: { in: [...postTotals.keys()] } },
    include: { content: { select: { id: true, title: true, campaignId: true, productId: true } } },
  })
  const ads = await db.marketingAd.findMany({
    where: { id: { in: [...adTotals.keys()] } },
    include: { content: { select: { id: true, title: true, productId: true } } },
  })
  const campaignIds = new Set<number>()
  const productIds = new Set<number>()
  for (const p of posts) { if (p.content.campaignId) campaignIds.add(p.content.campaignId); if (p.content.productId) productIds.add(p.content.productId) }
  for (const a of ads) { if (a.campaignId) campaignIds.add(a.campaignId); if (a.content?.productId) productIds.add(a.content.productId) }
  const [campaigns, products] = await Promise.all([
    db.marketingCampaign.findMany({ where: { id: { in: [...campaignIds] } }, select: { id: true, name: true } }),
    db.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, productName: true, publicName: true } }),
  ])
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]))
  const productName = new Map(products.map((p) => [p.id, p.publicName?.trim() || p.productName]))

  const channels: Acc = new Map()
  const campaigns2: Acc = new Map()
  const products2: Acc = new Map()
  const totals = zeroTotals()
  const perPost: ResultsReport['perPost'] = []
  const perAd: ResultsReport['perAd'] = []

  const place = (m: Totals, kind: 'post' | 'ad', channelKind: string, campaignId: number | null, productId: number | null) => {
    const bumpOne = (map: Acc, key: string, label: string) => { const r = bump(map, key, label, m, kind); if (kind === 'post') r.posts++; else r.ads++ }
    bumpOne(channels, channelKind, channelKind)
    bumpOne(campaigns2, campaignId ? String(campaignId) : 'none', campaignId ? campaignName.get(campaignId) ?? `Campaign ${campaignId}` : 'No campaign')
    bumpOne(products2, productId ? String(productId) : 'none', productId ? productName.get(productId) ?? `Product ${productId}` : 'No product')
    addTo(totals, m)
  }
  for (const p of posts) {
    const m = postTotals.get(p.id) ?? zeroTotals()
    perPost.push({ key: String(p.id), label: p.content.title, posts: 1, ads: 0, ...m, postId: p.id, channelKind: p.channelKind, status: p.status, publishedAt: p.publishedAt?.toISOString() ?? null, trackingTag: p.trackingTag })
    place(m, 'post', p.channelKind, p.content.campaignId, p.content.productId)
  }
  for (const a of ads) {
    const m = adTotals.get(a.id) ?? zeroTotals()
    perAd.push({ key: String(a.id), label: a.headline, posts: 0, ads: 1, ...m, adId: a.id, status: a.status })
    place(m, 'ad', a.channelKind, a.campaignId, a.content?.productId ?? null)
  }
  const byVisits = (x: ResultRow, y: ResultRow) => y.visits - x.visits || y.enquiries - x.enquiries || x.label.localeCompare(y.label)
  return {
    from: range.from, to: range.to, totals,
    perPost: perPost.sort(byVisits),
    perChannel: [...channels.values()].sort(byVisits),
    perCampaign: [...campaigns2.values()].sort(byVisits),
    perProduct: [...products2.values()].sort(byVisits),
    perAd: perAd.sort(byVisits),
    spendCents: [...adTotals.values()].reduce((s, t) => s + t.spendCents, 0),
  }
}

