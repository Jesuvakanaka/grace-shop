// VYRA Marketing hub (ZP-1200): ads on Meta and Google (create, approve, create paused on the platform, start, pause, sync). Server only.
// Rule 1: assertCanGoLive runs before every outward call. Rule 2: the spend cap is checked (under a lock) when
// an ad is approved, created on Meta, changed and started; ads are created PAUSED and started by a separate action.
import type { MarketingAd, MarketingChannel, Prisma, PrismaClient } from '@prisma/client'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import { primaryStorefrontHost } from '@/lib/storefront/public-url'
import { WebsiteError } from '@/lib/website/http'
import { transitionAd, AD_OBJECTIVES, LIVE_EDITABLE_FIELDS, onPlatform, type AdAction, type AdTransitionResult } from './ad-state'
import { readTargeting } from './audiences'
import { writeAudit, type Db } from './audit'
import { checkAdCap, monthDateBounds } from './budget'
import { campaignBlockReason } from './campaign-window'
import { assertContentProductMarketable } from './catalogue'
import { assertCanGoLive } from './flags'
import {
  activateAd, createPausedAd, fetchAdInsights, pauseAd, updateAdSchedule,
  type AdsContext, type MetaAdSpec,
} from './connectors/meta-ads'
import {
  activateGoogleAd, createPausedGoogleAd, fetchGoogleInsights, pauseGoogleAd, updateGoogleSchedule, type GoogleAdsContext,
} from './connectors/google-ads'
import type { FetchLike } from './connectors/types'
import { publicImageUrls } from './publish'
import { decryptJson } from './secrets'
import { getSettings } from './settings'
import type { Actor } from './state'
import { buildTrackedLink, generateTrackingTag } from './tracking'
import { asObject, date, imageKeys, int, onlyKeys, oneOf, requiredText, text } from './validate'

export const AD_PLATFORMS = ['META_ADS', 'GOOGLE_ADS'] as const
export type AdPlatformKind = (typeof AD_PLATFORMS)[number]
const PLATFORM_LABEL: Record<AdPlatformKind, string> = { META_ADS: 'Meta', GOOGLE_ADS: 'Google' }
const platformKind = (a: { channelKind: string }): AdPlatformKind => (a.channelKind === 'GOOGLE_ADS' ? 'GOOGLE_ADS' : 'META_ADS')
const labelOf = (a: { channelKind: string }) => PLATFORM_LABEL[platformKind(a)]

export type AdDto = Omit<MarketingAd, 'imageKeys'> & { imageKeys: string[] }

export const toAdDto = (a: MarketingAd): AdDto => ({
  ...a,
  imageKeys: Array.isArray(a.imageKeys) ? (a.imageKeys as unknown[]).filter((k): k is string => typeof k === 'string') : [],
})

export interface AdDeps {
  fetch: FetchLike
  /** Public origin photos are downloaded from (default: first GRACE_STOREFRONT_HOSTS entry). */
  baseUrl?: string | null
  now?: Date
}

const asActor = (a: Actor | string): Actor => (typeof a === 'string' ? { username: a, role: 'OWNER' } : a)
export const MIN_DAILY_BUDGET_CENTS = 100
const COPY = { headline: 80, primaryText: 500, description: 150 } as const

// ───────────────────────── lock ─────────────────────────

const LOCK_KEY = 1_200_001

/** Serialise budget decisions (approve, create, change, start) so two ads cannot both pass the cap. */
export async function withBudgetLock<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if ('$transaction' in db) {
    return (db as PrismaClient).$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`
        return fn(tx)
      },
      { timeout: 20_000 },
    )
  }
  return fn(db)
}

// ───────────────────────── reads ─────────────────────────

export async function listAds(db: Db, f: { status?: string | null; campaignId?: number | null } = {}): Promise<AdDto[]> {
  const where: Prisma.MarketingAdWhereInput = {}
  if (f.status) where.status = f.status
  if (f.campaignId) where.campaignId = f.campaignId
  return (await db.marketingAd.findMany({ where, orderBy: { id: 'desc' }, take: 300 })).map(toAdDto)
}

export async function getAd(db: Db, id: number): Promise<AdDto | null> {
  const a = await db.marketingAd.findUnique({ where: { id } })
  return a ? toAdDto(a) : null
}

async function mustGet(db: Db, id: number): Promise<MarketingAd> {
  const a = await db.marketingAd.findUnique({ where: { id } })
  if (!a) throw new WebsiteError(404, 'Ad not found')
  return a
}

// ───────────────────────── create / edit ─────────────────────────

function checkCopy(o: { headline?: string; primaryText?: string; description?: string | null }) {
  if (o.headline !== undefined && /[\r\n]/.test(o.headline)) throw new WebsiteError(400, 'The headline must be one line.', { field: 'headline' })
}

async function checkRefs(db: Db, o: { campaignId?: number | null; contentId?: number | null; audienceId?: number | null }) {
  if (o.campaignId && !(await db.marketingCampaign.findUnique({ where: { id: o.campaignId }, select: { id: true } }))) throw new WebsiteError(400, 'That campaign does not exist.', { field: 'campaignId' })
  if (o.contentId && !(await db.marketingContent.findUnique({ where: { id: o.contentId }, select: { id: true } }))) throw new WebsiteError(400, 'That content does not exist.', { field: 'contentId' })
  if (o.audienceId) {
    const a = await db.marketingAudience.findUnique({ where: { id: o.audienceId }, select: { kind: true } })
    if (!a) throw new WebsiteError(400, 'That audience does not exist.', { field: 'audienceId' })
    if (a.kind !== 'AD_TARGETING') throw new WebsiteError(400, 'Choose an ad targeting audience.', { field: 'audienceId' })
  }
}

function refId(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new WebsiteError(400, `${field} is not valid.`, { field })
  return v
}

async function linkFor(db: Db, contentId: number | null, objective: string, trackingTag: string, host: string | null | undefined): Promise<string | null> {
  if (objective === 'CLICK_TO_WHATSAPP') return null
  const content = contentId ? await db.marketingContent.findUnique({ where: { id: contentId }, include: { product: { select: { slug: true } } } }) : null
  return buildTrackedLink({ slug: content?.product?.slug ?? null, trackingTag, storefrontHosts: hostRoutingConfigFromEnv().storefrontHosts, host })
}

const AD_CREATE_KEYS = ['channelKind', 'contentId', 'campaignId', 'audienceId', 'objective', 'headline', 'primaryText', 'description', 'imageKeys', 'dailyBudgetCents', 'startsAt', 'endsAt'] as const

export async function createAd(db: Db, body: unknown, actor: string, opts: { host?: string | null; aiGenerated?: boolean } = {}): Promise<AdDto> {
  const o = asObject(body)
  onlyKeys(o, AD_CREATE_KEYS)
  const channelKind = 'channelKind' in o ? oneOf(o.channelKind, 'channelKind', AD_PLATFORMS) : 'META_ADS'
  const objective = 'objective' in o ? oneOf(o.objective, 'objective', AD_OBJECTIVES) : 'TRAFFIC'
  if (channelKind === 'GOOGLE_ADS' && objective !== 'TRAFFIC') throw new WebsiteError(400, 'Google search ads send people to the shop: choose "visits to the shop".', { field: 'objective' })
  const headline = requiredText(o.headline, 'headline', COPY.headline)
  const primaryText = requiredText(o.primaryText, 'primaryText', COPY.primaryText)
  checkCopy({ headline })
  const campaignId = refId(o.campaignId, 'campaignId')
  const contentId = refId(o.contentId, 'contentId')
  const audienceId = refId(o.audienceId, 'audienceId')
  await checkRefs(db, { campaignId, contentId, audienceId })
  const dailyBudgetCents = int(o.dailyBudgetCents, 'dailyBudgetCents', MIN_DAILY_BUDGET_CENTS, 10_000_000)
  const startsAt = date(o.startsAt ?? null, 'startsAt')
  if (!startsAt) throw new WebsiteError(400, 'startsAt is required.', { field: 'startsAt' })
  const endsAt = 'endsAt' in o ? date(o.endsAt, 'endsAt') : null
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) throw new WebsiteError(400, 'The end date must be after the start date.', { field: 'endsAt' })
  let keys: string[] = 'imageKeys' in o ? imageKeys(o.imageKeys, 'imageKeys', 1) : []
  if (keys.length === 0 && contentId) {
    const c = await db.marketingContent.findUnique({ where: { id: contentId }, select: { imageKeys: true } })
    keys = (Array.isArray(c?.imageKeys) ? (c?.imageKeys as unknown[]) : []).filter((k): k is string => typeof k === 'string').slice(0, 1)
  }
  const trackingTag = generateTrackingTag()
  const ad = await db.marketingAd.create({
    data: {
      channelKind, campaignId, contentId, audienceId, objective, headline, primaryText,
      description: text(o.description, 'description', COPY.description),
      imageKeys: keys, trackingTag, dailyBudgetCents, startsAt, endsAt,
      link: await linkFor(db, contentId, objective, trackingTag, opts.host),
      aiGenerated: opts.aiGenerated ?? false, createdBy: actor,
    },
  })
  await writeAudit(db, { actor, action: 'ad.create', entity: 'ad', entityId: ad.id, detail: { channelKind, objective, dailyBudgetCents } })
  return toAdDto(ad)
}

const EDIT_KEYS = ['contentId', 'campaignId', 'audienceId', 'objective', 'headline', 'primaryText', 'description', 'imageKeys', 'dailyBudgetCents', 'startsAt', 'endsAt'] as const

/**
 * Edit an ad. Before it is on Meta, any change sends it back to DRAFT (approval is for the exact words and money).
 * Once on Meta only the budget and end date can change: the cap is checked, approval is cleared, the owner approves again.
 */
export async function updateAd(db: Db, id: number, body: unknown, actorIn: Actor | string, opts: { host?: string | null; now?: Date } = {}): Promise<AdDto> {
  const actor = asActor(actorIn)
  const now = opts.now ?? new Date()
  const o = asObject(body)
  onlyKeys(o, EDIT_KEYS)
  return withBudgetLock(db, async (tx) => {
    const ad = await mustGet(tx, id)
    const live = onPlatform(ad.status)
    const data: Prisma.MarketingAdUncheckedUpdateManyInput = {}
    const changes: string[] = []
    const set = <K extends keyof Prisma.MarketingAdUncheckedUpdateManyInput>(k: K, v: Prisma.MarketingAdUncheckedUpdateManyInput[K], same: boolean) => {
      if (!same) { data[k] = v; changes.push(k) }
    }
    if (live) {
      for (const k of Object.keys(o)) {
        if (!(LIVE_EDITABLE_FIELDS as readonly string[]).includes(k)) throw new WebsiteError(409, `This ad is already on ${labelOf(ad)}: only the daily budget and the end date can change. Cancel it and make a new ad for anything else.`, { field: k })
      }
    }
    const budget = 'dailyBudgetCents' in o ? int(o.dailyBudgetCents, 'dailyBudgetCents', MIN_DAILY_BUDGET_CENTS, 10_000_000) : ad.dailyBudgetCents
    set('dailyBudgetCents', budget, budget === ad.dailyBudgetCents)
    const startsAt = 'startsAt' in o ? date(o.startsAt, 'startsAt') : ad.startsAt
    if (!startsAt) throw new WebsiteError(400, 'startsAt is required.', { field: 'startsAt' })
    set('startsAt', startsAt, startsAt.getTime() === ad.startsAt.getTime())
    const endsAt = 'endsAt' in o ? date(o.endsAt, 'endsAt') : ad.endsAt
    if (endsAt && endsAt.getTime() <= startsAt.getTime()) throw new WebsiteError(400, 'The end date must be after the start date.', { field: 'endsAt' })
    set('endsAt', endsAt, (endsAt?.getTime() ?? null) === (ad.endsAt?.getTime() ?? null))
    if (!live) {
      const objective = 'objective' in o ? oneOf(o.objective, 'objective', AD_OBJECTIVES) : ad.objective
      set('objective', objective, objective === ad.objective)
      if ('headline' in o) { const v = requiredText(o.headline, 'headline', COPY.headline); checkCopy({ headline: v }); set('headline', v, v === ad.headline) }
      if ('primaryText' in o) { const v = requiredText(o.primaryText, 'primaryText', COPY.primaryText); set('primaryText', v, v === ad.primaryText) }
      if ('description' in o) { const v = text(o.description, 'description', COPY.description); set('description', v, v === ad.description) }
      if ('imageKeys' in o) { const v = imageKeys(o.imageKeys, 'imageKeys', 1); set('imageKeys', v, JSON.stringify(v) === JSON.stringify(ad.imageKeys)) }
      const refs = {
        campaignId: 'campaignId' in o ? refId(o.campaignId, 'campaignId') : ad.campaignId,
        contentId: 'contentId' in o ? refId(o.contentId, 'contentId') : ad.contentId,
        audienceId: 'audienceId' in o ? refId(o.audienceId, 'audienceId') : ad.audienceId,
      }
      await checkRefs(tx, refs)
      set('campaignId', refs.campaignId, refs.campaignId === ad.campaignId)
      set('contentId', refs.contentId, refs.contentId === ad.contentId)
      set('audienceId', refs.audienceId, refs.audienceId === ad.audienceId)
      if (refs.contentId !== ad.contentId || objective !== ad.objective) {
        data.link = await linkFor(tx, refs.contentId, objective, ad.trackingTag, opts.host)
      }
    }
    if (changes.length === 0) return toAdDto(ad)
    let result: AdTransitionResult
    if (live) {
      result = transitionAd(ad, 'edit_live', actor) // throws while the ad is running
      await checkAdCap(tx, await getSettings(tx), { id, dailyBudgetCents: budget, startsAt, endsAt }, now)
    } else {
      result = transitionAd(ad, 'edit', actor)
    }
    const res = await tx.marketingAd.updateMany({ where: { id, status: ad.status }, data: { ...data, ...result } })
    if (res.count === 0) throw new WebsiteError(409, 'Someone else just changed this. Reload and try again.')
    await writeAudit(tx, { actor: actor.username, action: live ? 'ad.edit_live' : 'ad.edit', entity: 'ad', entityId: id, detail: { fields: changes, from: ad.status, to: result.status } })
    return toAdDto(await mustGet(tx, id))
  })
}

export async function deleteAd(db: Db, id: number, actor: string): Promise<void> {
  const ad = await mustGet(db, id)
  if (!['DRAFT', 'REJECTED', 'CANCELLED', 'FAILED'].includes(ad.status) || ad.externalCampaignId || ad.externalAdId) {
    throw new WebsiteError(409, `This ad has been approved or created on ${labelOf(ad)}, so it cannot be deleted. Cancel it instead.`)
  }
  await db.marketingAd.delete({ where: { id } })
  await writeAudit(db, { actor, action: 'ad.delete', entity: 'ad', entityId: id, detail: { status: ad.status } })
}

// ───────────────────────── platform ─────────────────────────

/** What a platform's connector must do. Meta and Google run through exactly the same steps in this file. */
type Ctx = AdsContext | GoogleAdsContext
type Ids = { campaignId: string | null; adSetId: string | null; creativeId: string | null; adId: string | null }
interface PlatformOps {
  label: string
  /** Value of AdminError `blocked` for the owner screen. */
  blocked: string
  createPaused(ctx: Ctx, spec: MetaAdSpec, now: Date): ReturnType<typeof createPausedAd>
  updateSchedule(ctx: Ctx, ids: Ids, change: { dailyBudgetCents: number; endsAt: Date | null }): ReturnType<typeof updateAdSchedule>
  activate(ctx: Ctx, ids: Ids): ReturnType<typeof activateAd>
  pause(ctx: Ctx, ids: Ids): ReturnType<typeof pauseAd>
  insights(ctx: Ctx, adId: string): ReturnType<typeof fetchAdInsights>
}

const OPS: Record<AdPlatformKind, PlatformOps> = {
  META_ADS: {
    label: 'Meta', blocked: 'meta',
    createPaused: (c, spec) => createPausedAd(c as AdsContext, spec),
    updateSchedule: (c, ids, ch) => updateAdSchedule(c as AdsContext, ids.adSetId ?? '', ch),
    activate: (c, ids) => activateAd(c as AdsContext, ids),
    pause: (c, ids) => pauseAd(c as AdsContext, ids),
    insights: (c, adId) => fetchAdInsights(c as AdsContext, adId),
  },
  GOOGLE_ADS: {
    label: 'Google', blocked: 'google',
    createPaused: (c, spec, now) => createPausedGoogleAd(c as GoogleAdsContext, spec, now),
    updateSchedule: (c, ids, ch) => updateGoogleSchedule(c as GoogleAdsContext, ids, ch),
    activate: (c, ids) => activateGoogleAd(c as GoogleAdsContext, ids),
    pause: (c, ids) => pauseGoogleAd(c as GoogleAdsContext, ids),
    insights: (c, adId) => fetchGoogleInsights(c as GoogleAdsContext, adId),
  },
}
const opsOf = (ad: { channelKind: string }) => OPS[platformKind(ad)]
const idsOf = (ad: MarketingAd): Ids => ({ campaignId: ad.externalCampaignId, adSetId: ad.externalAdSetId, creativeId: ad.externalCreativeId, adId: ad.externalAdId })

async function adsChannel(db: Db, kind: string): Promise<MarketingChannel | null> {
  return db.marketingChannel.findFirst({ where: { kind, status: 'CONNECTED' }, orderBy: { id: 'asc' } })
}

function adsContext(db: Db, ad: MarketingAd, settings: Awaited<ReturnType<typeof getSettings>>, channel: MarketingChannel | null, deps: AdDeps, now: Date): Ctx {
  const credentials = channel?.credentialsEnc ? decryptJson<Record<string, string>>(channel.credentialsEnc) : {}
  const cfg = (channel?.config ?? {}) as Record<string, unknown>
  return {
    credentials,
    fetch: deps.fetch,
    gate: { settings, channel, post: ad },
    capCheck: () => checkAdCap(db, settings, { id: ad.id, dailyBudgetCents: ad.dailyBudgetCents, startsAt: ad.startsAt, endsAt: ad.endsAt }, now),
    currency: typeof cfg.currency === 'string' ? cfg.currency : null,
  }
}

function origin(deps: AdDeps): string | null {
  if (deps.baseUrl) return deps.baseUrl.replace(/\/+$/, '')
  const host = primaryStorefrontHost(hostRoutingConfigFromEnv().storefrontHosts)
  return host ? `https://${host}` : null
}

async function specFor(db: Db, ad: MarketingAd, deps: AdDeps): Promise<MetaAdSpec> {
  const keys = (Array.isArray(ad.imageKeys) ? ad.imageKeys : []).filter((k): k is string => typeof k === 'string')
  const audience = ad.audienceId ? await db.marketingAudience.findUnique({ where: { id: ad.audienceId } }) : null
  // Google search ads have no picture.
  const imageUrl = keys.length && platformKind(ad) === 'META_ADS' ? publicImageUrls(keys.slice(0, 1), origin(deps), true)[0] : null
  return {
    id: ad.id, trackingTag: ad.trackingTag, objective: ad.objective as MetaAdSpec['objective'], headline: ad.headline,
    primaryText: ad.primaryText, description: ad.description, link: ad.link, imageUrl,
    dailyBudgetCents: ad.dailyBudgetCents, startsAt: ad.startsAt, endsAt: ad.endsAt,
    targeting: audience?.kind === 'AD_TARGETING' ? readTargeting(audience.targeting) : null,
    existing: { campaignId: ad.externalCampaignId, adSetId: ad.externalAdSetId, creativeId: ad.externalCreativeId, adId: ad.externalAdId },
  }
}

async function cas(db: Db, ad: MarketingAd, result: AdTransitionResult, extra: Prisma.MarketingAdUncheckedUpdateManyInput = {}) {
  const res = await db.marketingAd.updateMany({ where: { id: ad.id, status: ad.status }, data: { ...result, ...extra } })
  if (res.count === 0) throw new WebsiteError(409, 'Someone else just changed this. Reload and try again.')
}

/** The ad is complete enough to ask for approval. */
function checkComplete(ad: MarketingAd) {
  const keys = Array.isArray(ad.imageKeys) ? ad.imageKeys : []
  if (keys.length === 0 && platformKind(ad) === 'META_ADS') throw new WebsiteError(409, 'Add a photo to this ad first.')
  if (ad.objective === 'TRAFFIC' && !ad.link) throw new WebsiteError(409, 'A traffic ad needs a link to the shop: the public site address is not set (GRACE_STOREFRONT_HOSTS).')
  if (ad.dailyBudgetCents < MIN_DAILY_BUDGET_CENTS) throw new WebsiteError(409, 'The daily budget must be at least $1.00.')
}

export const AD_API_ACTIONS = ['submit', 'approve', 'reject', 'create_on_platform', 'start', 'pause', 'cancel'] as const
export type AdApiAction = (typeof AD_API_ACTIONS)[number]

/** Move an ad along the machine. create_on_platform, start and pause make real calls to Meta or Google (gated). */
export async function transitionAdAction(db: Db, id: number, action: AdApiAction, actorIn: Actor | string, deps: AdDeps): Promise<AdDto> {
  const actor = asActor(actorIn)
  const now = deps.now ?? new Date()
  const audit = (from: string, to: string) => writeAudit(db, { actor: actor.username, action: `ad.${action}`, entity: 'ad', entityId: id, detail: { from, to } })

  if (action === 'create_on_platform') return createOnPlatform(db, id, actor, deps, now)
  if (action === 'start') return startAd(db, id, actor, deps, now)
  if (action === 'pause') return pauseOnPlatform(db, id, actor, deps)

  if (action === 'submit') {
    const ad = await mustGet(db, id)
    const t = transitionAd(ad, 'submit', actor)
    checkComplete(ad)
    await cas(db, ad, t)
    await audit(ad.status, t.status)
    return toAdDto(await mustGet(db, id))
  }
  if (action === 'approve') {
    return withBudgetLock(db, async (tx) => {
      const ad = await mustGet(tx, id)
      const t = transitionAd(ad, 'approve', actor, { now })
      // An owner cannot approve money the cap does not allow.
      await checkAdCap(tx, await getSettings(tx), { id, dailyBudgetCents: ad.dailyBudgetCents, startsAt: ad.startsAt, endsAt: ad.endsAt }, now)
      await cas(tx, ad, t)
      await writeAudit(tx, { actor: actor.username, action: 'ad.approve', entity: 'ad', entityId: id, detail: { from: ad.status, to: t.status } })
      return toAdDto(await mustGet(tx, id))
    })
  }
  // reject, cancel
  const ad = await mustGet(db, id)
  const t = transitionAd(ad, action, actor)
  await cas(db, ad, t)
  await audit(ad.status, t.status)
  return toAdDto(await mustGet(db, id))
}

/**
 * ZP-1124 (MM-04-AC4): an ad in a campaign follows the campaign's dates and status like a post does.
 * Checked before any request, so nothing is created or started (and no money spent) outside them.
 */
export async function assertAdCampaignAllows(db: Db, ad: { campaignId: number | null }, now: Date): Promise<void> {
  if (!ad.campaignId) return
  const campaign = await db.marketingCampaign.findUnique({ where: { id: ad.campaignId }, select: { id: true, name: true, status: true, startsAt: true, endsAt: true } })
  const reason = campaignBlockReason(campaign, now)
  if (reason) throw new WebsiteError(409, reason, { blocked: 'campaign' })
}

/**
 * ZP-1106 (MM-01-AC4, AT-06): an ad for a withdrawn or sold-out piece is not created or started on the platform.
 * Checked before any request, like the campaign dates.
 */
export async function assertAdProductMarketable(db: Db, ad: { contentId: number | null }): Promise<void> {
  if (ad.contentId) await assertContentProductMarketable(db, ad.contentId)
}

async function createOnPlatform(db: Db, id: number, actor: Actor, deps: AdDeps, now: Date): Promise<AdDto> {
  const before = await mustGet(db, id)
  transitionAd(before, 'create_on_platform', actor) // throws when not allowed
  await assertAdCampaignAllows(db, before, now)
  await assertAdProductMarketable(db, before)
  const ops = opsOf(before)
  const settings = await getSettings(db)
  const channel = await adsChannel(db, platformKind(before))
  assertCanGoLive({ settings, channel, post: before }) // before anything changes or any request is made
  // Cap check and the move to CREATING (which counts as committed) happen together under the lock.
  const ad = await withBudgetLock(db, async (tx) => {
    const fresh = await mustGet(tx, id)
    const tt = transitionAd(fresh, 'create_on_platform', actor)
    await checkAdCap(tx, settings, { id, dailyBudgetCents: fresh.dailyBudgetCents, startsAt: fresh.startsAt, endsAt: fresh.endsAt }, now)
    await cas(tx, fresh, tt)
    await writeAudit(tx, { actor: actor.username, action: 'ad.create_on_platform', entity: 'ad', entityId: id, detail: { from: fresh.status, to: tt.status } })
    return fresh
  })
  const creating = await mustGet(db, id)
  const fail = async (error: string, ids: { campaignId?: string | null; adSetId?: string | null; creativeId?: string | null; adId?: string | null }) => {
    const res = transitionAd(creating, 'create_failed', { username: 'system', role: 'SYSTEM' }, { error })
    await cas(db, creating, res, {
      externalCampaignId: ids.campaignId ?? null, externalAdSetId: ids.adSetId ?? null,
      externalCreativeId: ids.creativeId ?? null, externalAdId: ids.adId ?? null,
    })
    await writeAudit(db, { actor: 'system', action: 'ad.create_failed', entity: 'ad', entityId: id, detail: { error: error.slice(0, 300) } })
    return toAdDto(await mustGet(db, id))
  }
  try {
    const result = await ops.createPaused(adsContext(db, creating, settings, channel, deps, now), await specFor(db, ad, deps), now)
    if (!result.ok) return await fail(result.error, result.ids)
    const done = transitionAd(creating, 'created', { username: 'system', role: 'SYSTEM' })
    await cas(db, creating, done, {
      externalCampaignId: result.ids.campaignId, externalAdSetId: result.ids.adSetId,
      externalCreativeId: result.ids.creativeId, externalAdId: result.ids.adId,
    })
    await writeAudit(db, { actor: 'system', action: 'ad.created', entity: 'ad', entityId: id, detail: { adId: result.ids.adId, paused: true, platform: ops.label } })
    return toAdDto(await mustGet(db, id))
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Creating the ad failed.', {})
  }
}

async function startAd(db: Db, id: number, actor: Actor, deps: AdDeps, now: Date): Promise<AdDto> {
  const ad = await mustGet(db, id)
  const t = transitionAd(ad, 'start', actor, { now })
  await assertAdCampaignAllows(db, ad, now)
  await assertAdProductMarketable(db, ad)
  const ops = opsOf(ad)
  const settings = await getSettings(db)
  const channel = await adsChannel(db, platformKind(ad))
  assertCanGoLive({ settings, channel, post: ad })
  await withBudgetLock(db, (tx) => checkAdCap(tx, settings, { id, dailyBudgetCents: ad.dailyBudgetCents, startsAt: ad.startsAt, endsAt: ad.endsAt }, now))
  const ctx = adsContext(db, ad, settings, channel, deps, now)
  const fail = (error: string): never => { throw new WebsiteError(502, error, { blocked: ops.blocked }) }
  // Make the platform match the approved budget and end date, then switch on.
  const sched = await ops.updateSchedule(ctx, idsOf(ad), { dailyBudgetCents: ad.dailyBudgetCents, endsAt: ad.endsAt })
  if (!sched.ok) fail(sched.error)
  const act = await ops.activate(ctx, idsOf(ad))
  if (!act.ok) {
    await db.marketingAd.updateMany({ where: { id }, data: { error: act.error.slice(0, 500) } })
    fail(act.error)
  }
  await cas(db, ad, t)
  await writeAudit(db, { actor: actor.username, action: 'ad.start', entity: 'ad', entityId: id, detail: { from: ad.status, to: t.status, dailyBudgetCents: ad.dailyBudgetCents } })
  return toAdDto(await mustGet(db, id))
}

async function pauseOnPlatform(db: Db, id: number, actor: Actor, deps: AdDeps): Promise<AdDto> {
  const ad = await mustGet(db, id)
  const t = transitionAd(ad, 'pause', actor)
  const ops = opsOf(ad)
  // Pausing stops spend, so it needs only saved credentials (no live switch): it must work when switches are turned off.
  const channel = await adsChannel(db, platformKind(ad))
  if (!channel?.credentialsEnc) throw new WebsiteError(409, ops.label === 'Meta' ? 'The ad account is not connected, so the ad cannot be paused from here. Pause it in Meta Ads Manager.' : 'The Google Ads account is not connected, so the ad cannot be paused from here. Pause it in Google Ads.')
  const ctx: Ctx = { credentials: decryptJson(channel.credentialsEnc), fetch: deps.fetch }
  const r = await ops.pause(ctx, idsOf(ad))
  if (!r.ok) throw new WebsiteError(502, `${r.error} The ad may still be running: pause it in ${ops.label === 'Meta' ? 'Meta Ads Manager' : 'Google Ads'}.`, { blocked: ops.blocked })
  await cas(db, ad, t)
  await writeAudit(db, { actor: actor.username, action: 'ad.pause', entity: 'ad', entityId: id, detail: { from: ad.status, to: t.status } })
  return toAdDto(await mustGet(db, id))
}

// ───────────────────────── sync ─────────────────────────

const dayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

/**
 * Pull the last 7 days of insights into MarketingMetric (entity AD), add visits and enquiries from the
 * analytics rolled up under the ad's tracking tag, and refresh spendCents. Read-only on the platform.
 * Safety net: an ACTIVE ad is paused when the month's recorded spend has reached the cap.
 */
export async function syncAd(db: Db, id: number, actorIn: Actor | string, deps: AdDeps): Promise<AdDto> {
  const actor = asActor(actorIn)
  const now = deps.now ?? new Date()
  const ad = await mustGet(db, id)
  const ops = opsOf(ad)
  if (!ad.externalAdId) throw new WebsiteError(409, `This ad is not on ${ops.label} yet, so there are no results to pull.`)
  const channel = await db.marketingChannel.findFirst({ where: { kind: platformKind(ad) }, orderBy: { id: 'asc' } })
  if (!channel?.credentialsEnc) throw new WebsiteError(409, 'The ad account is not connected.')
  const ctx: Ctx = { credentials: decryptJson(channel.credentialsEnc), fetch: deps.fetch }
  const ins = await ops.insights(ctx, ad.externalAdId)
  if (!ins.ok) throw new WebsiteError(502, ins.error, { blocked: ops.blocked })

  const since = new Date(now.getTime() - 9 * 86_400_000)
  const analytics = await db.analyticsDailySource.findMany({ where: { campaign: ad.trackingTag, day: { gte: dayDate(since.toISOString().slice(0, 10)) } } })
  const perDay = new Map<string, { visits: number; enquiries: number }>()
  for (const r of analytics) {
    const k = r.day.toISOString().slice(0, 10)
    const cur = perDay.get(k) ?? { visits: 0, enquiries: 0 }
    cur.visits += r.visits
    cur.enquiries += r.enquiringVisits
    perDay.set(k, cur)
  }
  const days = new Map(ins.days.map((d) => [d.day, d]))
  for (const k of perDay.keys()) if (!days.has(k)) days.set(k, { day: k, impressions: 0, reach: 0, clicks: 0, spendCents: -1, raw: {} })
  for (const d of days.values()) {
    const a = perDay.get(d.day) ?? { visits: 0, enquiries: 0 }
    const key = { entity_entityId_day: { entity: 'AD', entityId: id, day: dayDate(d.day) } }
    if (d.spendCents < 0) {
      // Analytics only (no platform row for that day): keep any spend we already have.
      const existing = await db.marketingMetric.findUnique({ where: key })
      await db.marketingMetric.upsert({
        where: key,
        update: { visits: a.visits, enquiries: a.enquiries },
        create: { entity: 'AD', entityId: id, day: dayDate(d.day), visits: a.visits, enquiries: a.enquiries, spendCents: existing?.spendCents ?? 0 },
      })
      continue
    }
    const data = { impressions: d.impressions, reach: d.reach, clicks: d.clicks, spendCents: d.spendCents, visits: a.visits, enquiries: a.enquiries, raw: d.raw as Prisma.InputJsonValue }
    await db.marketingMetric.upsert({ where: key, update: data, create: { entity: 'AD', entityId: id, day: dayDate(d.day), ...data } })
  }
  const total = await db.marketingMetric.aggregate({ where: { entity: 'AD', entityId: id }, _sum: { spendCents: true } })
  await db.marketingAd.update({ where: { id }, data: { spendCents: total._sum.spendCents ?? 0, lastSyncedAt: now } })
  await writeAudit(db, { actor: actor.username, action: 'ad.sync', entity: 'ad', entityId: id, detail: { days: ins.days.length } })

  // Finished by its end date.
  let current = await mustGet(db, id)
  if (current.endsAt && current.endsAt.getTime() <= now.getTime() && (current.status === 'ACTIVE' || current.status === 'PAUSED_ON_PLATFORM')) {
    await cas(db, current, transitionAd(current, 'complete', { username: 'system', role: 'SYSTEM' }))
    await writeAudit(db, { actor: 'system', action: 'ad.complete', entity: 'ad', entityId: id, detail: {} })
    current = await mustGet(db, id)
  }
  // Cap safety net: stop a running ad once the month's recorded spend has reached the cap.
  if (current.status === 'ACTIVE') {
    const settings = await getSettings(db)
    const { start, end } = monthDateBounds(now)
    const month = await db.marketingMetric.aggregate({ where: { entity: 'AD', day: { gte: start, lt: end } }, _sum: { spendCents: true } })
    if ((month._sum.spendCents ?? 0) >= Math.max(0, settings.monthlySpendCapCents)) {
      const r = await ops.pause(ctx, idsOf(current))
      if (r.ok) {
        await cas(db, current, transitionAd(current, 'pause', { username: 'system', role: 'SYSTEM' }))
        await writeAudit(db, { actor: 'system', action: 'ad.cap_pause', entity: 'ad', entityId: id, detail: { capCents: settings.monthlySpendCapCents } })
      }
    }
  }
  return toAdDto(await mustGet(db, id))
}
