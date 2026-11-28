// VYRA Marketing hub (ZP-1200): Google Ads (Search campaigns) through the Google Ads API, REST.
//
// !!! Written from Google's DOCUMENTED REST shapes and NEVER run against a real Google Ads account (the owner has none yet). !!!
// !!! Everything that maps our ad to Google's fields lives in the build* functions in this file so it can be fixed in one place. !!!
//
// API version: v26 (v26.2 is the latest release, 11 Nov 2026). Checked on 2026-11-26 at
//   https://developers.google.com/google-ads/api/docs/release-notes  and  https://developers.google.com/ads/blog/posts/2026/10/google-ads-api-release-and-sunset
//   (a version is sunset about a year after release: v23 Feb 2027, v24 May 2027, v25 Aug 2027, v26 Nov 2027; bump GOOGLE_ADS_VERSION then).
// REST: POST https://googleads.googleapis.com/v26/customers/{customerId}/{campaignBudgets|campaigns|campaignCriteria|adGroups|adGroupAds}:mutate
//   body { operations: [ { create: {...} } | { updateMask: "status", update: { resourceName, status } } ] } -> { results: [ { resourceName } ] }
//   (https://developers.google.com/google-ads/api/rest/common/mutate). Reading: POST .../customers/{id}/googleAds:search { query } (GAQL).
// Headers: Authorization: Bearer <OAuth access token>, developer-token: <token>, login-customer-id: <manager id, only when given>.
// Campaign fields (https://developers.google.com/google-ads/api/docs/campaigns/create-campaigns): name, status, advertisingChannelType,
//   campaignBudget, networkSettings, a bidding strategy (we use targetSpend = "Maximize clicks": no bid is invented, the daily budget is the limit),
//   startDateTime / endDateTime ("yyyy-MM-dd HH:mm:ss" in the account's time zone: assumed to be Harare), containsEuPoliticalAdvertising (required).
//
// Developer token: it needs Google's approval ("Basic access", Tools, API Center) before it works on a real account. Until then every call is refused.
// Billing: Google Ads bills the card saved on the Google Ads account, not VYRA.
//
// Safety (hard rules 1 and 2): every call that creates, changes or starts anything runs assertCanGoLive and the spend-cap check
// BEFORE any request (the OAuth token request counts as a request); missing checks fail closed. Everything is created PAUSED.
// Pausing and reading results need only saved credentials (stopping spend must never be blocked by a switch).
//
// Id mapping on MarketingAd: externalCampaignId = campaign id, externalAdSetId = ad group id, externalCreativeId = campaign BUDGET id
// (needed to change the amount), externalAdId = ad id (the ad lives at adGroupAds/{adGroupId}~{adId}).
import { assertCanGoLive } from '../flags'
import { HARARE_OFFSET_MS } from '../budget'
import type { InsightDay, MetaAdIds, MetaAdSpec, SimpleResult, CreateResult } from './meta-ads'
import { exchangeRefreshToken, failureOfGoogle, GoogleApiError, googleJson } from './google-oauth'
import type { GoLiveInput } from '../flags'
import type { Connector, FetchLike, PublishResult, VerifyResult } from './types'

export const GOOGLE_ADS_VERSION = 'v26'
export const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}`

/** Google's limits for a responsive search ad. */
export const RSA_LIMITS = { headline: 30, description: 90, headlines: { min: 3, max: 15 }, descriptions: { min: 2, max: 4 } } as const

export interface GoogleAdsContext {
  credentials: Record<string, string | undefined>
  fetch: FetchLike
  gate?: GoLiveInput
  capCheck?: () => void | Promise<void>
  /** Account currency from connect time; only USD is supported because the cap is in USD cents. */
  currency?: string | null
}

export const cleanCustomerId = (id: string) => id.replace(/[\s-]/g, '')
const trim = (v: string | undefined) => (v ?? '').trim()

// ───────────────────────── copy: headline / primaryText / description -> Google's limits ─────────────────────────

const key = (t: string) => t.toLowerCase().replace(/\s+/g, ' ')

/** Cut at the last word boundary within max characters. */
export function clipWords(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, '')
}

const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
const clauses = (t: string) => t.split(/(?<=[,;:])\s+|\s[-–—]\s/).map((s) => s.trim()).filter(Boolean)

function pushUnique(list: string[], seen: Set<string>, t: string, max: number) {
  const v = t.trim()
  if (!v || v.length > max || seen.has(key(v))) return
  seen.add(key(v))
  list.push(v)
}

// ZP-1106 (MM-01-AC2): fillers state nothing the owner has not confirmed (no town, no shop visit, no delivery).
const FILLER_HEADLINES = ['VYRA', 'Shop at VYRA', 'Discover VYRA']
const FILLER_DESCRIPTIONS = ['See the latest pieces from VYRA.', 'Browse the collection on the VYRA website.']

/**
 * Split our headline (80), primaryText (500) and description (150) into Google's 3 to 15 headlines (30 characters)
 * and 2 to 4 descriptions (90 characters). Nothing is invented: pieces come from the ad's own words, cut at sentence,
 * comma or word boundaries; only when there are too few pieces are the short generic VYRA lines added. Google does not
 * allow "!" in headlines, so it is dropped there.
 */
export function splitAdCopy(ad: { headline: string; primaryText: string; description: string | null }): { headlines: string[]; descriptions: string[] } {
  const H = RSA_LIMITS.headline
  const D = RSA_LIMITS.description
  const headlines: string[] = []
  const hs = new Set<string>()
  const addHeadline = (raw: string) => {
    const t = raw.replace(/!/g, '').replace(/[.]+$/, '').trim()
    if (t.length <= H) pushUnique(headlines, hs, t, H)
    else {
      for (const c of clauses(t)) pushUnique(headlines, hs, c.replace(/[.]+$/, '').replace(/!/g, ''), H)
      pushUnique(headlines, hs, clipWords(t, H), H)
    }
  }
  addHeadline(ad.headline)
  if (ad.description) addHeadline(ad.description)
  for (const s of sentences(ad.primaryText)) {
    if (headlines.length >= 6) break
    addHeadline(s)
  }
  for (const f of FILLER_HEADLINES) if (headlines.length < RSA_LIMITS.headlines.min) pushUnique(headlines, hs, f, H)

  const descriptions: string[] = []
  const ds = new Set<string>()
  // Pack neighbouring sentences of the primary text into 90-character lines.
  let cur = ''
  const flush = () => { if (cur) pushUnique(descriptions, ds, cur, D); cur = '' }
  for (const s of sentences(ad.primaryText)) {
    const piece = s.length > D ? clipWords(s, D) : s
    if (cur && `${cur} ${piece}`.length <= D) cur = `${cur} ${piece}`
    else { flush(); cur = piece }
  }
  flush()
  if (ad.description) pushUnique(descriptions, ds, ad.description.length > D ? clipWords(ad.description, D) : ad.description, D)
  pushUnique(descriptions, ds, ad.headline.length > D ? clipWords(ad.headline, D) : ad.headline, D)
  for (const f of FILLER_DESCRIPTIONS) if (descriptions.length < RSA_LIMITS.descriptions.min) pushUnique(descriptions, ds, f, D)
  return { headlines: headlines.slice(0, RSA_LIMITS.headlines.max), descriptions: descriptions.slice(0, RSA_LIMITS.descriptions.max) }
}

// ───────────────────────── the one place that maps our ad to Google's fields ─────────────────────────

/** "yyyy-MM-dd" of the Harare calendar day containing d. */
export const hararePlainDate = (d: Date) => new Date(d.getTime() + HARARE_OFFSET_MS).toISOString().slice(0, 10)

/** 1 US cent = 10,000 micros. */
export const centsToMicros = (cents: number) => String(Math.round(cents) * 10_000)

export function buildBudgetCreate(ad: MetaAdSpec) {
  return { name: `VYRA ${ad.trackingTag} budget`, amountMicros: centsToMicros(ad.dailyBudgetCents), deliveryMethod: 'STANDARD', explicitlyShared: false }
}

/** An end date at exactly midnight does not include that day (same rule as the cap). */
const endDateTime = (endsAt: Date) => `${hararePlainDate(new Date(endsAt.getTime() - 1))} 23:59:59`

export function buildCampaignCreate(ad: MetaAdSpec, budgetResource: string, now: Date) {
  const start = hararePlainDate(ad.startsAt > now ? ad.startsAt : now) // Google refuses a start in the past
  return {
    name: `VYRA ${ad.trackingTag}`,
    status: 'PAUSED',
    advertisingChannelType: 'SEARCH',
    campaignBudget: budgetResource,
    // Search network only (Google Search), no Display and no search partners.
    networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
    // Only people in (not merely interested in) the targeted place.
    geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' },
    targetSpend: {},
    startDateTime: `${start} 00:00:00`,
    ...(ad.endsAt ? { endDateTime: endDateTime(ad.endsAt) } : {}),
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  }
}

/** A radius around the audience's place (Harare by default audience). Only built when the ad has an audience. */
export function buildLocationCreate(campaignResource: string, geo: { lat: number; lng: number; radiusKm: number }) {
  return {
    campaign: campaignResource,
    proximity: {
      geoPoint: { longitudeInMicroDegrees: Math.round(geo.lng * 1_000_000), latitudeInMicroDegrees: Math.round(geo.lat * 1_000_000) },
      radius: geo.radiusKm,
      radiusUnits: 'KILOMETERS',
    },
  }
}

export function buildAdGroupCreate(ad: MetaAdSpec, campaignResource: string) {
  return { name: `VYRA ${ad.trackingTag} group`, campaign: campaignResource, status: 'PAUSED', type: 'SEARCH_STANDARD' }
}

export function buildAdGroupAdCreate(ad: MetaAdSpec, adGroupResource: string) {
  const copy = splitAdCopy(ad)
  return {
    adGroup: adGroupResource,
    status: 'PAUSED',
    ad: {
      finalUrls: [ad.link ?? ''],
      responsiveSearchAd: {
        headlines: copy.headlines.map((text) => ({ text })),
        descriptions: copy.descriptions.map((text) => ({ text })),
      },
    },
  }
}

export const GAQL_DAYS = 'LAST_7_DAYS'
export const insightsQuery = (adId: string) =>
  `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM ad_group_ad WHERE ad_group_ad.ad.id = ${adId} AND segments.date DURING ${GAQL_DAYS}`

// ───────────────────────── plumbing ─────────────────────────

interface Creds { customerId: string; developerToken: string; clientId: string; clientSecret: string; refreshToken: string; loginCustomerId: string }

function creds(ctx: GoogleAdsContext): Creds {
  const c = ctx.credentials
  const out: Creds = {
    customerId: cleanCustomerId(trim(c.customerId)), developerToken: trim(c.developerToken), clientId: trim(c.clientId),
    clientSecret: trim(c.clientSecret), refreshToken: trim(c.refreshToken), loginCustomerId: cleanCustomerId(trim(c.loginCustomerId)),
  }
  if (!out.customerId || !out.developerToken || !out.clientId || !out.clientSecret || !out.refreshToken) {
    throw new Error('The Google Ads account is not fully connected (customer ID, developer token and the Google sign-in details are needed).')
  }
  return out
}

/** Gate + cap, before any request. Fails closed. */
async function guardSpend(ctx: GoogleAdsContext): Promise<void> {
  if (!ctx.gate) throw new Error('Blocked: no go-live check was supplied.')
  assertCanGoLive(ctx.gate)
  if (!ctx.capCheck) throw new Error('Blocked: no spend cap check was supplied.')
  await ctx.capCheck()
  if (ctx.currency && ctx.currency.toUpperCase() !== 'USD') {
    throw new Error(`The Google Ads account currency is ${ctx.currency}, but the spend cap is in US dollars. Use a USD account.`)
  }
}

interface Session { call: <T = Record<string, unknown>>(path: string, body: unknown) => Promise<T>; customerId: string }

async function open(ctx: GoogleAdsContext): Promise<Session> {
  const c = creds(ctx)
  const accessToken = await exchangeRefreshToken(c as unknown as Record<string, string>, ctx.fetch)
  const headers: Record<string, string> = { 'developer-token': c.developerToken, ...(c.loginCustomerId ? { 'login-customer-id': c.loginCustomerId } : {}) }
  return {
    customerId: c.customerId,
    call: (path, body) => googleJson(ctx.fetch, 'POST', `${GOOGLE_ADS_BASE}/customers/${c.customerId}/${path}`, accessToken, body, { adsToken: true, headers }),
  }
}

/** Numeric id at the end of "customers/1/campaigns/23" (or "adGroupAds/4~5" -> "5"). */
export const idOfResource = (name: unknown): string => {
  const last = String(name ?? '').split('/').pop() ?? ''
  return last.includes('~') ? (last.split('~').pop() ?? '') : last
}

async function mutate(s: Session, service: string, operation: Record<string, unknown>): Promise<string> {
  const res = await s.call<{ results?: { resourceName?: string }[] }>(`${service}:mutate`, { operations: [operation] })
  const name = res.results?.[0]?.resourceName
  if (!name) throw new GoogleApiError('Google did not return the id of what it created.', 502, false)
  return name
}

const res = (s: Session, kind: string, id: string) => `customers/${s.customerId}/${kind}/${id}`
const failed = (e: unknown): { ok: false; error: string; code?: number } => {
  const f = failureOfGoogle(e)
  return { ok: false, error: f.error, ...(f.code !== undefined ? { code: f.code } : {}) }
}

// ───────────────────────── calls ─────────────────────────

/** Create budget, campaign (+ place), ad group and responsive search ad, ALL PAUSED. Resumes from `ad.existing`. */
export async function createPausedGoogleAd(ctx: GoogleAdsContext, ad: MetaAdSpec, now: Date = new Date()): Promise<CreateResult> {
  const ids: MetaAdIds = {
    campaignId: ad.existing?.campaignId ?? null, adSetId: ad.existing?.adSetId ?? null,
    creativeId: ad.existing?.creativeId ?? null, adId: ad.existing?.adId ?? null,
  }
  try {
    await guardSpend(ctx) // before ANY request
    creds(ctx)
    if (ad.dailyBudgetCents < 100) throw new Error('The daily budget must be at least $1.00.')
    if (!ad.link) throw new Error('A Google search ad needs a link to the shop.')
    const s = await open(ctx)
    if (!ids.creativeId) ids.creativeId = idOfResource(await mutate(s, 'campaignBudgets', { create: buildBudgetCreate(ad) }))
    if (!ids.campaignId) {
      ids.campaignId = idOfResource(await mutate(s, 'campaigns', { create: buildCampaignCreate(ad, res(s, 'campaignBudgets', ids.creativeId), now) }))
      if (ad.targeting) await mutate(s, 'campaignCriteria', { create: buildLocationCreate(res(s, 'campaigns', ids.campaignId), ad.targeting.geo) })
    }
    if (!ids.adSetId) ids.adSetId = idOfResource(await mutate(s, 'adGroups', { create: buildAdGroupCreate(ad, res(s, 'campaigns', ids.campaignId)) }))
    if (!ids.adId) ids.adId = idOfResource(await mutate(s, 'adGroupAds', { create: buildAdGroupAdCreate(ad, res(s, 'adGroups', ids.adSetId)) }))
    if (!ids.campaignId || !ids.adSetId || !ids.creativeId || !ids.adId) throw new Error('Google did not return all the ids.')
    return { ok: true, ids }
  } catch (e) {
    return { ...failed(e), ids }
  }
}

/** Push the budget amount and end date (gated: a budget change can spend money). */
export async function updateGoogleSchedule(
  ctx: GoogleAdsContext, ids: Pick<MetaAdIds, 'campaignId' | 'creativeId'>, change: { dailyBudgetCents: number; endsAt: Date | null },
): Promise<SimpleResult> {
  try {
    await guardSpend(ctx)
    creds(ctx)
    if (!ids.campaignId || !ids.creativeId) throw new Error('This ad is not fully created on Google.')
    const s = await open(ctx)
    await mutate(s, 'campaignBudgets', {
      updateMask: 'amount_micros',
      update: { resourceName: res(s, 'campaignBudgets', ids.creativeId), amountMicros: centsToMicros(change.dailyBudgetCents) },
    })
    if (change.endsAt) {
      await mutate(s, 'campaigns', {
        updateMask: 'end_date_time',
        update: { resourceName: res(s, 'campaigns', ids.campaignId), endDateTime: endDateTime(change.endsAt) },
      })
    }
    return { ok: true }
  } catch (e) {
    return failed(e)
  }
}

async function setStatus(s: Session, ids: { campaignId?: string | null; adSetId?: string | null; adId?: string | null }, status: 'ENABLED' | 'PAUSED') {
  const order = status === 'PAUSED' ? ['ad', 'group', 'campaign'] : ['campaign', 'group', 'ad'] // pause stops delivery first; enable ends with the ad
  for (const what of order) {
    if (what === 'ad' && ids.adId && ids.adSetId) {
      await mutate(s, 'adGroupAds', { updateMask: 'status', update: { resourceName: res(s, 'adGroupAds', `${ids.adSetId}~${ids.adId}`), status } })
    } else if (what === 'group' && ids.adSetId) {
      await mutate(s, 'adGroups', { updateMask: 'status', update: { resourceName: res(s, 'adGroups', ids.adSetId), status } })
    } else if (what === 'campaign' && ids.campaignId) {
      await mutate(s, 'campaigns', { updateMask: 'status', update: { resourceName: res(s, 'campaigns', ids.campaignId), status } })
    }
  }
}

/** Switch campaign, ad group and ad to ENABLED (ad last: nothing is shown until the ad is enabled). */
export async function activateGoogleAd(ctx: GoogleAdsContext, ids: Pick<MetaAdIds, 'campaignId' | 'adSetId' | 'adId'>): Promise<SimpleResult> {
  try {
    await guardSpend(ctx) // before ANY request
    creds(ctx)
    if (!ids.campaignId || !ids.adSetId || !ids.adId) throw new Error('This ad is not fully created on Google.')
    await setStatus(await open(ctx), ids, 'ENABLED')
    return { ok: true }
  } catch (e) {
    return failed(e)
  }
}

/** Switch ad, ad group and campaign to PAUSED. Needs credentials only. */
export async function pauseGoogleAd(ctx: GoogleAdsContext, ids: Pick<MetaAdIds, 'campaignId' | 'adSetId' | 'adId'>): Promise<SimpleResult> {
  try {
    creds(ctx)
    await setStatus(await open(ctx), ids, 'PAUSED')
    return { ok: true }
  } catch (e) {
    return failed(e)
  }
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** Daily results of the last 7 days from a GAQL search. Needs credentials only. cost_micros / 10,000 = US cents. */
export async function fetchGoogleInsights(ctx: GoogleAdsContext, adId: string): Promise<{ ok: true; days: InsightDay[] } | { ok: false; error: string }> {
  try {
    creds(ctx)
    if (!/^\d+$/.test(adId)) throw new Error('This ad has no valid Google ad id.')
    const s = await open(ctx)
    const out = await s.call<{ results?: { segments?: { date?: string }; metrics?: Record<string, unknown> }[] }>('googleAds:search', { query: insightsQuery(adId) })
    const days = (out.results ?? [])
      .filter((r) => typeof r.segments?.date === 'string')
      .map((r) => ({
        day: String(r.segments?.date),
        impressions: num(r.metrics?.impressions),
        reach: 0, // Search campaigns have no reach figure
        clicks: num(r.metrics?.clicks),
        spendCents: Math.round((Number(r.metrics?.costMicros) || 0) / 10_000),
        raw: r as Record<string, unknown>,
      }))
    return { ok: true, days }
  } catch (e) {
    const f = failed(e)
    return { ok: false, error: f.error }
  }
}

/** Read-only check used when connecting: the customer must be readable, enabled and in US dollars to be useful. */
export async function verifyGoogleAdsAccount(credentials: Record<string, string>, fetchFn: FetchLike): Promise<VerifyResult & { currency?: string | null }> {
  try {
    const ctx: GoogleAdsContext = { credentials, fetch: fetchFn }
    creds(ctx)
    const s = await open(ctx)
    const out = await s.call<{ results?: { customer?: { id?: string; descriptiveName?: string; currencyCode?: string; status?: string } }[] }>(
      'googleAds:search', { query: 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.status FROM customer LIMIT 1' },
    )
    const c = out.results?.[0]?.customer
    if (!c) return { ok: false, error: 'Google returned no account details for that customer ID.' }
    if (c.status && c.status !== 'ENABLED') return { ok: false, error: `Google says this Google Ads account is not active (${c.status}). Check the account and its payment method in Google Ads.` }
    return { ok: true, externalId: c.id ?? cleanCustomerId(trim(credentials.customerId)), name: c.descriptiveName ?? null, currency: c.currencyCode ?? null }
  } catch (e) {
    return { ok: false, error: failureOfGoogle(e).error }
  }
}

export const googleAdsConnector: Connector = {
  kind: 'GOOGLE_ADS',
  async verify(credentials, fetchFn) {
    const v = await verifyGoogleAdsAccount(credentials, fetchFn)
    if (!v.ok) return v
    // The currency is saved with the channel (config) so ads can refuse a non-USD account.
    return { ok: true, externalId: v.externalId, name: v.name, extraConfig: { currency: v.currency ?? '', accountName: v.name ?? '' } }
  },
  // Ads are made on the Ads screen (they need a budget and a second approval), never as a post.
  async publish(): Promise<PublishResult> {
    return { ok: false, retryable: false, error: 'Google Ads are made on the Ads screen, not as posts.' }
  },
}
