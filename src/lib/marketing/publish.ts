// VYRA Marketing hub (ZP-1200): publish approved posts through their connector. Server only.
// The gate (assertCanGoLive) runs in transitionPost AND again before any request. Nothing here
// is called by a page load: only the owner's Publish / Retry and the scheduled runner (npm run marketing:run).
import type { MarketingChannel, MarketingPost } from '@prisma/client'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import { isValidImageKey, PRODUCT_IMAGE_PREFIX } from '@/lib/storage/keys'
import { primaryStorefrontHost } from '@/lib/storefront/public-url'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { campaignBlockReason, campaignHasEnded, shopDayLabel } from './campaign-window'
import { getChannel } from './channels'
import { updateCredentials } from './connect'
import { getConnector } from './connectors'
import { NotSentError } from './connectors/common'
import type { Connector, FetchLike } from './connectors/types'
import { assertCanGoLive, checkCanGoLive } from './flags'
import { assertInCampaignWindow, campaignOfPost, transitionPost, type PostDto } from './posts'
import { decryptJson } from './secrets'
import { getSettings } from './settings'
import type { Actor } from './state'

export interface PublishDeps {
  fetch: FetchLike
  /** Override the public origin that platforms download photos from (default: first GRACE_STOREFRONT_HOSTS entry). */
  baseUrl?: string | null
  /** Tests inject connectors; the default is the registry. */
  getConnector?: (kind: string) => Connector | undefined
}

export const SYSTEM_ACTOR: Actor = { username: 'system', role: 'SYSTEM' }

const asActor = (a: Actor | string): Actor => (typeof a === 'string' ? { username: a, role: 'OWNER' } : a)

export function publicOrigin(deps: PublishDeps): string | null {
  if (deps.baseUrl) return deps.baseUrl.replace(/\/+$/, '')
  const host = primaryStorefrontHost(hostRoutingConfigFromEnv().storefrontHosts)
  return host ? `https://${host}` : null
}

/** Absolute public photo URLs. JPEG rendition when the channel needs JPEG. Throws a plain message when none can be built. */
export function publicImageUrls(keys: string[], origin: string | null, jpeg: boolean): string[] {
  if (keys.length === 0) return []
  if (!origin) throw new Error('The public site address is not set (GRACE_STOREFRONT_HOSTS), so the platform cannot download the photos.')
  return keys.map((k) => {
    if (!isValidImageKey(k)) throw new Error('A photo on this post is not a product photo that can be shared.')
    return `${origin}/api/images/public/${k.slice(PRODUCT_IMAGE_PREFIX.length)}${jpeg ? '?format=jpeg' : ''}`
  })
}

async function channelFor(db: Db, post: { channelId: number | null; channelKind: string }): Promise<MarketingChannel | null> {
  return post.channelId
    ? db.marketingChannel.findUnique({ where: { id: post.channelId } })
    : db.marketingChannel.findFirst({ where: { kind: post.channelKind, status: 'CONNECTED' } })
}

/**
 * Publish one post now: APPROVED -> publish, SCHEDULED -> start (when due), FAILED -> retry.
 * Throws a 409 (nothing changes) when the gate or the status machine refuses. Once the post is
 * PUBLISHING the outcome is recorded as PUBLISHED or FAILED and the post is returned.
 */
export async function publishPost(db: Db, postId: number, actorIn: Actor | string, deps: PublishDeps, now: Date = new Date()): Promise<PostDto> {
  const actor = asActor(actorIn)
  const post = await db.marketingPost.findUnique({ where: { id: postId } })
  if (!post) throw new WebsiteError(404, 'Post not found')
  const def = getChannel(post.channelKind)
  const connector = (deps.getConnector ?? getConnector)(post.channelKind)
  if (!def || !connector) throw new WebsiteError(409, `${def?.label ?? 'This channel'} has no automatic posting yet.`)
  if (connector.messagesOnly) throw new WebsiteError(409, `${def.label} messages go out from the Messages screen, to people who opted in.`)
  const action = post.status === 'APPROVED' ? 'publish' : post.status === 'SCHEDULED' ? 'start' : post.status === 'FAILED' ? 'retry' : null
  if (!action) throw new WebsiteError(409, 'This post cannot be published from its current status.')

  const settings = await getSettings(db)
  const channel = await channelFor(db, post)
  const gate = { settings, channel, post }
  assertCanGoLive(gate) // before anything changes or any request is made
  await assertInCampaignWindow(db, post.contentId, now) // ZP-1124: never outside the campaign's dates, never while it is paused

  // Moves to PUBLISHING (compare-and-set), checks the gate again and writes the audit row.
  await transitionPost(db, postId, action, actor, { now })

  const fail = async (error: string, code?: number): Promise<PostDto> => {
    // 190 = Meta token no longer valid; 401 = any other platform's token expired or revoked.
    const tokenDead = code === 190 || code === 401
    const failed = await transitionPost(db, postId, 'failed', SYSTEM_ACTOR, { error })
    if (channel) {
      await db.marketingChannel.update({
        where: { id: channel.id },
        data: { lastError: error.slice(0, 500), ...(tokenDead ? { status: 'ERROR' } : {}) },
      })
      if (tokenDead) await writeAudit(db, { actor: SYSTEM_ACTOR.username, action: 'channel.error', entity: 'channel', entityId: channel.id, detail: { code } })
    }
    return failed
  }

  // ZP-1124 (MM-09-AC2): the request may have reached the platform but no clear answer came back.
  // The post may be out, so it is never retried by itself: the owner checks and says which.
  const uncertain = async (why: string): Promise<PostDto> => {
    const error = `${why.trim().replace(/[.\s]*$/, '.')} It may already be on ${def.label}: check there, then press "It went out" or "It did not go out".`
    const out = await transitionPost(db, postId, 'uncertain', SYSTEM_ACTOR, { error })
    if (channel) await db.marketingChannel.update({ where: { id: channel.id }, data: { lastError: why.slice(0, 500) } })
    return out
  }

  // Before the request: anything that goes wrong here means nothing was sent, so it is a plain failure.
  let credentials: Record<string, string>
  let imageUrls: string[]
  try {
    credentials = decryptJson<Record<string, string>>((channel as MarketingChannel).credentialsEnc as string)
    // Short-lived tokens (X): renew first, and save the new tokens before they are used (a refresh token can be single-use).
    if (connector.refreshCredentials) {
      const r = await connector.refreshCredentials(credentials, deps.fetch)
      if (!r.ok) return await fail(r.error, r.code)
      if (r.refreshed) {
        await updateCredentials(db, (channel as MarketingChannel).id, r.credentials, SYSTEM_ACTOR.username)
        credentials = r.credentials
      }
    }
    const keys = Array.isArray(post.imageKeys) ? (post.imageKeys as unknown[]).filter((k): k is string => typeof k === 'string') : []
    imageUrls = publicImageUrls(keys, publicOrigin(deps), def.limits.imageFormat === 'jpeg')
  } catch (e) {
    // Never include anything but the message: credentials are not part of it.
    return await fail(e instanceof Error ? e.message : 'Publishing failed.')
  }

  // The request itself. A crash or a broken connection here leaves the outcome unknown.
  let result: Awaited<ReturnType<Connector['publish']>>
  try {
    result = await connector.publish(
      { id: post.id, text: post.text, imageUrls, link: post.link, format: post.format, trackingTag: post.trackingTag },
      {
        credentials,
        externalId: (channel as MarketingChannel).externalId,
        config: ((channel as MarketingChannel).config as Record<string, unknown> | null) ?? null,
        fetch: deps.fetch,
        gate,
      },
    )
  } catch (e) {
    // The connector's own gate check (a 409) or a step it knows came before any creating request
    // (a photo it could not download): nothing was sent, so it is a plain failure, not "check the platform".
    if (e instanceof WebsiteError || e instanceof NotSentError) return await fail(e.message)
    return await uncertain(e instanceof Error ? e.message : 'The request to the platform broke off.')
  }
  if (!result.ok) return result.uncertain ? await uncertain(result.error) : await fail(result.error, result.code)
  // MM-09-AC3: published needs the platform's ID for the post.
  if (!result.externalId || !String(result.externalId).trim()) return await uncertain(`${def.label} answered without the post's ID.`)
  const published = await transitionPost(db, postId, 'published', SYSTEM_ACTOR, { externalId: result.externalId, externalUrl: result.externalUrl, now })
  if (channel) await db.marketingChannel.update({ where: { id: channel.id }, data: { lastError: null } })
  // Extra words from the platform connector (X cost, "sent to your TikTok inbox") go on the activity log.
  if (result.message) await writeAudit(db, { actor: SYSTEM_ACTOR.username, action: 'post.publish_note', entity: 'post', entityId: postId, detail: { message: result.message.slice(0, 300) } })
  return published
}

export interface RunResult {
  checked: number
  published: number[]
  failed: number[]
  /** ZP-1124: posts whose outcome is unknown (the owner must check the platform). */
  uncertain: number[]
  /** ZP-1124: campaigns closed by this run because their last day is over. */
  endedCampaigns: number[]
  /** ZP-1124: unsent posts withdrawn because their campaign ended. */
  withdrawn: number[]
  /** Posts left SCHEDULED because the gate said no (or the channel has no connector). */
  blocked: { postId: number; reason: string }[]
  /** The first reason a post was left alone, if any. */
  reason: string | null
}

/** How long a post may stay PUBLISHING before the run treats the attempt as lost (a crash mid-request). */
export const PUBLISH_LEASE_MS = 10 * 60 * 1000

/** How many pages of due posts one run looks through (blocked posts are skipped, not counted). */
export const RUN_MAX_PAGES = 20

/** Post statuses that have not gone out and are withdrawn when their campaign ends. */
const UNSENT = ['APPROVED', 'SCHEDULED']

/**
 * ZP-1124 (MM-04-AC3, MM-04-AC6): close campaigns whose last day is over BEFORE any post is processed.
 * Running and paused campaigns become ENDED; every unsent post of an ended campaign (including drafts
 * of campaigns never started) is withdrawn with a plain reason. History is kept.
 */
export async function closeEndedCampaigns(db: Db, now: Date): Promise<{ ended: number[]; withdrawn: number[] }> {
  const out = { ended: [] as number[], withdrawn: [] as number[] }
  const candidates = await db.marketingCampaign.findMany({
    where: { status: { in: ['DRAFT', 'ACTIVE', 'PAUSED'] }, endsAt: { not: null, lt: now } },
    select: { id: true, name: true, status: true, endsAt: true },
  })
  for (const c of candidates) {
    if (!campaignHasEnded(c, now)) continue // the end day is not over yet in shop time
    if (c.status !== 'DRAFT') {
      const res = await db.marketingCampaign.updateMany({ where: { id: c.id, status: c.status }, data: { status: 'ENDED' } })
      if (res.count === 1) {
        out.ended.push(c.id)
        await writeAudit(db, { actor: SYSTEM_ACTOR.username, action: 'campaign.ended', entity: 'campaign', entityId: c.id, detail: { from: c.status, reason: 'last day passed' } })
      }
    }
    const error = `Withdrawn: the campaign ended on ${shopDayLabel(c.endsAt as Date)} before this went out.`
    const posts = await db.marketingPost.findMany({ where: { status: { in: UNSENT }, content: { campaignId: c.id } }, select: { id: true, status: true } })
    for (const p of posts) {
      const res = await db.marketingPost.updateMany({ where: { id: p.id, status: p.status }, data: { status: 'CANCELLED', scheduledFor: null, error } })
      if (res.count === 1) {
        out.withdrawn.push(p.id)
        await writeAudit(db, { actor: SYSTEM_ACTOR.username, action: 'post.withdrawn', entity: 'post', entityId: p.id, detail: { from: p.status, to: 'CANCELLED', campaignId: c.id } })
      }
    }
  }
  return out
}

/** ZP-1124 (MM-09-AC1): a post left PUBLISHING past the lease (the run died mid-request) becomes UNCERTAIN, never retried blind. */
export async function markStalePublishing(db: Db, now: Date, leaseMs: number = PUBLISH_LEASE_MS): Promise<number[]> {
  const stale = await db.marketingPost.findMany({ where: { status: 'PUBLISHING', updatedAt: { lt: new Date(now.getTime() - leaseMs) } }, select: { id: true, channelKind: true } })
  const out: number[] = []
  for (const p of stale) {
    const label = getChannel(p.channelKind)?.label ?? 'the platform'
    const error = `The run that was posting this stopped before ${label} answered. It may already be on ${label}: check there, then press "It went out" or "It did not go out".`
    const res = await db.marketingPost.updateMany({ where: { id: p.id, status: 'PUBLISHING' }, data: { status: 'UNCERTAIN', error } })
    if (res.count === 1) {
      out.push(p.id)
      await writeAudit(db, { actor: SYSTEM_ACTOR.username, action: 'post.uncertain', entity: 'post', entityId: p.id, detail: { from: 'PUBLISHING', to: 'UNCERTAIN', reason: 'lease expired' } })
    }
  }
  return out
}

/**
 * Publish SCHEDULED posts that are due. Ended campaigns are closed first, and lost attempts are marked
 * uncertain. Posts are only touched when the campaign allows it and checkCanGoLive passes; otherwise they stay SCHEDULED.
 */
export async function runDuePosts(db: Db, now: Date, deps: PublishDeps, opts: { max?: number } = {}): Promise<RunResult> {
  const max = Math.min(Math.max(Math.trunc(opts.max ?? 10) || 10, 1), 50)
  const closed = await closeEndedCampaigns(db, now)
  const stale = await markStalePublishing(db, now)
  const out: RunResult = { checked: 0, published: [], failed: [], uncertain: [...stale], endedCampaigns: closed.ended, withdrawn: closed.withdrawn, blocked: [], reason: null }
  // Posts that are blocked (a paused campaign, a channel the gate refuses) stay SCHEDULED. They must not
  // use up the batch, or a paused campaign with many overdue posts would stop every other post for ever:
  // the run pages past them until `max` posts were actually tried (or nothing due is left).
  let settings: Awaited<ReturnType<typeof getSettings>> | null = null
  let after: { scheduledFor: Date; id: number } | null = null
  let tried = 0
  for (let page = 0; page < RUN_MAX_PAGES && tried < max; page++) {
    const due: MarketingPost[] = await db.marketingPost.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: { lte: now },
        ...(after ? { OR: [{ scheduledFor: { gt: after.scheduledFor } }, { scheduledFor: after.scheduledFor, id: { gt: after.id } }] } : {}),
      },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: max,
    })
    if (due.length === 0) break
    const last = due[due.length - 1]
    after = { scheduledFor: last.scheduledFor as Date, id: last.id }
    settings ??= await getSettings(db)
    for (const p of due) {
      if (tried >= max) break
      out.checked++
      const outside = campaignBlockReason(await campaignOfPost(db, p.contentId), now)
      if (outside) {
        out.blocked.push({ postId: p.id, reason: outside })
        continue
      }
      const channel = await channelFor(db, p)
      const check = checkCanGoLive({ settings, channel, post: p })
      if (!check.ok) {
        out.blocked.push({ postId: p.id, reason: check.reason })
        continue
      }
      tried++
      try {
        const r = await publishPost(db, p.id, SYSTEM_ACTOR, deps, now)
        if (r.status === 'PUBLISHED') out.published.push(p.id)
        else if (r.status === 'UNCERTAIN') out.uncertain.push(p.id)
        else out.failed.push(p.id)
      } catch (e) {
        out.blocked.push({ postId: p.id, reason: e instanceof Error ? e.message : 'Could not publish.' })
      }
    }
    if (due.length < max) break
  }
  out.reason = out.blocked[0]?.reason ?? null
  return out
}
