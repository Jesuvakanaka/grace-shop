// VYRA Marketing hub (ZP-1200): Meta (Facebook + Instagram) ads through the Marketing API.
//
// !!! The field mapping below was written from Meta's DOCUMENTED fields and has NEVER been run against a
// !!! real ad account (the owner has none yet). Meta changes required fields between versions. Everything
// !!! that maps our ad to Meta's fields lives in the build* functions in this file so it can be fixed in
// !!! one place. Verify with a real ad account (start with a $1 a day test ad, created paused) before trusting it.
//
// Safety (hard rules 1 and 2): every call that creates, changes or starts an ad runs assertCanGoLive and the
// spend-cap check BEFORE any request; missing checks fail closed. Everything is created PAUSED. Pausing and
// reading insights need only saved credentials (stopping spend must never be blocked by a switch).
import { assertCanGoLive, type GoLiveInput } from '../flags'
import type { TargetingSpec } from '../audiences'
import { failureOf, graphClient, MetaGraphError, type GraphClient } from './meta-graph'
import type { FetchLike } from './types'

export interface AdsCredentials {
  accessToken: string
  /** Digits only (no "act_"). */
  adAccountId: string
  pageId: string
}

export interface AdsContext {
  credentials: Partial<AdsCredentials>
  fetch: FetchLike
  /** What assertCanGoLive needs. Missing = fail closed. */
  gate?: GoLiveInput
  /** Throws a 409 when the spend cap would be exceeded. Missing = fail closed. */
  capCheck?: () => void | Promise<void>
  /** Account currency from connect time; only USD is supported because the cap is in USD cents. */
  currency?: string | null
}

export interface MetaAdIds {
  campaignId: string | null
  adSetId: string | null
  creativeId: string | null
  adId: string | null
}

export interface MetaAdSpec {
  id: number
  trackingTag: string
  objective: 'TRAFFIC' | 'ENGAGEMENT' | 'CLICK_TO_WHATSAPP'
  headline: string
  primaryText: string
  description: string | null
  link: string | null
  /** Public JPEG URL Meta downloads (used as `picture`). */
  imageUrl: string | null
  /** Optional: upload these bytes with /adimages and use the image hash instead of `picture`. */
  imageBase64?: string | null
  dailyBudgetCents: number
  startsAt: Date
  endsAt: Date | null
  targeting: TargetingSpec | null
  /** Ids already created by an earlier, partly failed attempt (resume instead of duplicating). */
  existing?: Partial<MetaAdIds>
}

export type CreateResult =
  | { ok: true; ids: MetaAdIds }
  | { ok: false; error: string; ids: Partial<MetaAdIds>; code?: number }

export type SimpleResult = { ok: true } | { ok: false; error: string; code?: number }

export const HARARE_DEFAULT = { lat: -17.8292, lng: 31.0522, radiusKm: 25 } as const

// ───────────────────────── the one place that maps our ad to Meta's fields ─────────────────────────

const OBJECTIVE_MAP = { TRAFFIC: 'OUTCOME_TRAFFIC', ENGAGEMENT: 'OUTCOME_ENGAGEMENT', CLICK_TO_WHATSAPP: 'OUTCOME_ENGAGEMENT' } as const
const CTA_MAP = { TRAFFIC: 'SHOP_NOW', ENGAGEMENT: 'LEARN_MORE', CLICK_TO_WHATSAPP: 'WHATSAPP_MESSAGE' } as const
/** Documented link for click-to-WhatsApp creatives. */
export const WHATSAPP_LINK = 'https://api.whatsapp.com/send'

export const cleanAccountId = (id: string) => id.trim().replace(/^act_/i, '')
const act = (c: AdsCredentials) => `act_${cleanAccountId(c.adAccountId)}`

export function buildCampaignParams(ad: MetaAdSpec) {
  return {
    name: `VYRA ${ad.trackingTag}`,
    objective: OBJECTIVE_MAP[ad.objective],
    status: 'PAUSED',
    special_ad_categories: JSON.stringify([]),
    // Required by recent versions when the budget lives on the ad set.
    is_adset_budget_sharing_enabled: false,
  }
}

/** Meta's targeting spec from ours (geo as a custom location, a radius around the shop). */
export function buildTargeting(t: TargetingSpec | null) {
  const geo = t?.geo ?? HARARE_DEFAULT
  const out: Record<string, unknown> = {
    geo_locations: {
      custom_locations: [{ latitude: geo.lat, longitude: geo.lng, radius: geo.radiusKm, distance_unit: 'kilometer' }],
    },
    age_min: t?.ageMin ?? 18,
    age_max: t?.ageMax ?? 65,
    // Required in recent versions: do not let Meta widen the audience on its own.
    targeting_automation: { advantage_audience: 0 },
  }
  const genders = t?.genders ?? []
  if (genders.length === 1) out.genders = [genders[0] === 'MALE' ? 1 : 2] // both or none = all genders
  if (t?.interests?.length) out.flexible_spec = [{ interests: t.interests.map((i) => ({ id: i.id, name: i.name })) }]
  return out
}

export function buildAdSetParams(ad: MetaAdSpec, campaignId: string, pageId: string) {
  const whatsapp = ad.objective === 'CLICK_TO_WHATSAPP'
  const params: Record<string, string | number | boolean | undefined> = {
    name: `VYRA ${ad.trackingTag} set`,
    campaign_id: campaignId,
    daily_budget: ad.dailyBudgetCents, // minor units of the account currency (USD cents)
    billing_event: 'IMPRESSIONS',
    optimization_goal: whatsapp ? 'CONVERSATIONS' : ad.objective === 'ENGAGEMENT' ? 'POST_ENGAGEMENT' : 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: JSON.stringify(buildTargeting(ad.targeting)),
    start_time: ad.startsAt.toISOString(),
    end_time: ad.endsAt ? ad.endsAt.toISOString() : undefined,
    status: 'PAUSED',
  }
  if (whatsapp) {
    params.destination_type = 'WHATSAPP'
    params.promoted_object = JSON.stringify({ page_id: pageId })
  }
  return params
}

export function buildCreativeParams(ad: MetaAdSpec, pageId: string, imageHash: string | null) {
  const whatsapp = ad.objective === 'CLICK_TO_WHATSAPP'
  const link = whatsapp ? WHATSAPP_LINK : ad.link ?? ''
  const linkData: Record<string, unknown> = {
    link,
    message: ad.primaryText,
    name: ad.headline,
    ...(ad.description ? { description: ad.description } : {}),
    ...(imageHash ? { image_hash: imageHash } : ad.imageUrl ? { picture: ad.imageUrl } : {}),
    call_to_action: {
      type: CTA_MAP[ad.objective],
      ...(whatsapp ? { value: { app_destination: 'WHATSAPP' } } : { value: { link } }),
    },
  }
  return {
    name: `VYRA ${ad.trackingTag} creative`,
    object_story_spec: JSON.stringify({ page_id: pageId, link_data: linkData }),
  }
}

export function buildAdParams(ad: MetaAdSpec, adSetId: string, creativeId: string) {
  return {
    name: `VYRA ${ad.trackingTag}`,
    adset_id: adSetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: 'PAUSED',
  }
}

/** Budget and end date of an existing ad set. */
export function buildScheduleParams(change: { dailyBudgetCents: number; endsAt: Date | null }) {
  return {
    daily_budget: change.dailyBudgetCents,
    ...(change.endsAt ? { end_time: change.endsAt.toISOString() } : {}),
  }
}

export const INSIGHT_FIELDS = 'impressions,reach,clicks,spend'

// ───────────────────────── guards ─────────────────────────

function creds(ctx: AdsContext): AdsCredentials {
  const c = ctx.credentials
  if (!c.accessToken || !c.adAccountId || !c.pageId) throw new Error('The ad account is not fully connected (token, ad account ID and Page ID are needed).')
  return c as AdsCredentials
}

/** Gate + cap, before any request. Fails closed. */
async function guardSpend(ctx: AdsContext): Promise<void> {
  if (!ctx.gate) throw new Error('Blocked: no go-live check was supplied.')
  assertCanGoLive(ctx.gate)
  if (!ctx.capCheck) throw new Error('Blocked: no spend cap check was supplied.')
  await ctx.capCheck()
  if (ctx.currency && ctx.currency.toUpperCase() !== 'USD') {
    throw new Error(`The ad account currency is ${ctx.currency}, but the spend cap is in US dollars. Use a USD ad account.`)
  }
}

const fail = (e: unknown): { ok: false; error: string; code?: number } => {
  const f = failureOf(e)
  return { ok: false, error: f.error, ...(f.code !== undefined ? { code: f.code } : {}) }
}

/** Meta errors keep Meta's own message at the end; make sure it is shown plainly. */
export function adsError(e: unknown): string {
  if (e instanceof MetaGraphError) return e.message
  return e instanceof Error ? e.message : 'Meta ads request failed.'
}

// ───────────────────────── calls ─────────────────────────

export async function verifyAdAccount(
  credentials: { accessToken: string; adAccountId: string },
  fetchFn: FetchLike,
): Promise<{ ok: true; id: string; name: string | null; currency: string | null } | { ok: false; error: string }> {
  try {
    const g = graphClient(fetchFn)
    const acc = await g.get<{ id?: string; name?: string; currency?: string; account_status?: number }>(
      `act_${cleanAccountId(credentials.adAccountId)}`, credentials.accessToken, { fields: 'id,name,currency,account_status' },
    )
    // account_status 1 = ACTIVE.
    if (typeof acc.account_status === 'number' && acc.account_status !== 1) {
      return { ok: false, error: `Meta says this ad account is not active (status ${acc.account_status}). Check Business settings, Ad accounts, and the payment method.` }
    }
    return { ok: true, id: cleanAccountId(acc.id ?? credentials.adAccountId), name: acc.name ?? null, currency: acc.currency ?? null }
  } catch (e) {
    return { ok: false, error: adsError(e) }
  }
}

export async function uploadImage(ctx: AdsContext, bytesBase64: string): Promise<string> {
  await guardSpend(ctx)
  const c = creds(ctx)
  const res = await graphClient(ctx.fetch).post<{ images?: Record<string, { hash?: string }> }>(`${act(c)}/adimages`, c.accessToken, { bytes: bytesBase64 })
  const hash = Object.values(res.images ?? {})[0]?.hash
  if (!hash) throw new Error('Meta did not return an image hash.')
  return hash
}

/** Create campaign, ad set, creative and ad, ALL PAUSED. Resumes from `ad.existing`. */
export async function createPausedAd(ctx: AdsContext, ad: MetaAdSpec): Promise<CreateResult> {
  const ids: MetaAdIds = {
    campaignId: ad.existing?.campaignId ?? null,
    adSetId: ad.existing?.adSetId ?? null,
    creativeId: ad.existing?.creativeId ?? null,
    adId: ad.existing?.adId ?? null,
  }
  try {
    await guardSpend(ctx) // before ANY request
    const c = creds(ctx)
    if (ad.dailyBudgetCents < 100) throw new Error('The daily budget must be at least $1.00.')
    if (ad.objective === 'TRAFFIC' && !ad.link) throw new Error('A traffic ad needs a link.')
    const g: GraphClient = graphClient(ctx.fetch)
    if (!ids.campaignId) {
      ids.campaignId = (await g.post<{ id: string }>(`${act(c)}/campaigns`, c.accessToken, buildCampaignParams(ad))).id
    }
    if (!ids.adSetId) {
      ids.adSetId = (await g.post<{ id: string }>(`${act(c)}/adsets`, c.accessToken, buildAdSetParams(ad, ids.campaignId, c.pageId))).id
    }
    if (!ids.creativeId) {
      let hash: string | null = null
      if (ad.imageBase64) {
        const up = await g.post<{ images?: Record<string, { hash?: string }> }>(`${act(c)}/adimages`, c.accessToken, { bytes: ad.imageBase64 })
        hash = Object.values(up.images ?? {})[0]?.hash ?? null
      }
      ids.creativeId = (await g.post<{ id: string }>(`${act(c)}/adcreatives`, c.accessToken, buildCreativeParams(ad, c.pageId, hash))).id
    }
    if (!ids.adId) {
      ids.adId = (await g.post<{ id: string }>(`${act(c)}/ads`, c.accessToken, buildAdParams(ad, ids.adSetId, ids.creativeId))).id
    }
    if (!ids.campaignId || !ids.adSetId || !ids.creativeId || !ids.adId) throw new Error('Meta did not return all the ids.')
    return { ok: true, ids }
  } catch (e) {
    return { ...fail(e), ids }
  }
}

/** Push the budget and end date to the ad set (gated: a budget change can spend money). */
export async function updateAdSchedule(ctx: AdsContext, adSetId: string, change: { dailyBudgetCents: number; endsAt: Date | null }): Promise<SimpleResult> {
  try {
    await guardSpend(ctx)
    const c = creds(ctx)
    await graphClient(ctx.fetch).post(adSetId, c.accessToken, buildScheduleParams(change))
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** Switch the campaign, ad set and ad to ACTIVE (ad last: nothing is delivered until the ad is active). */
export async function activateAd(ctx: AdsContext, ids: Pick<MetaAdIds, 'campaignId' | 'adSetId' | 'adId'>): Promise<SimpleResult> {
  try {
    await guardSpend(ctx) // before ANY request
    const c = creds(ctx)
    if (!ids.campaignId || !ids.adSetId || !ids.adId) throw new Error('This ad is not fully created on Meta.')
    const g = graphClient(ctx.fetch)
    for (const id of [ids.campaignId, ids.adSetId, ids.adId]) await g.post(id, c.accessToken, { status: 'ACTIVE' })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** Switch the ad, ad set and campaign to PAUSED (ad first: that stops delivery). Needs credentials only. */
export async function pauseAd(ctx: AdsContext, ids: Pick<MetaAdIds, 'campaignId' | 'adSetId' | 'adId'>): Promise<SimpleResult> {
  try {
    const c = creds(ctx)
    const g = graphClient(ctx.fetch)
    for (const id of [ids.adId, ids.adSetId, ids.campaignId]) if (id) await g.post(id, c.accessToken, { status: 'PAUSED' })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export interface InsightDay {
  day: string // YYYY-MM-DD
  impressions: number
  reach: number
  clicks: number
  spendCents: number
  raw: Record<string, unknown>
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** Daily insights of the last 7 days. Needs credentials only. `spend` comes back in account currency units ("1.23"). */
export async function fetchAdInsights(ctx: AdsContext, adId: string): Promise<{ ok: true; days: InsightDay[] } | { ok: false; error: string }> {
  try {
    const c = creds(ctx)
    const res = await graphClient(ctx.fetch).get<{ data?: Record<string, unknown>[] }>(`${adId}/insights`, c.accessToken, {
      fields: INSIGHT_FIELDS, time_increment: 1, date_preset: 'last_7d',
    })
    const days = (res.data ?? [])
      .filter((r) => typeof r.date_start === 'string')
      .map((r) => ({
        day: String(r.date_start),
        impressions: num(r.impressions),
        reach: num(r.reach),
        clicks: num(r.clicks),
        spendCents: Math.round((Number(r.spend) || 0) * 100),
        raw: r,
      }))
    return { ok: true, days }
  } catch (e) {
    return { ok: false, error: adsError(e) }
  }
}
