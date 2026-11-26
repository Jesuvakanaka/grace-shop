// VYRA Marketing hub (ZP-1200): publish approved posts through their connector. Server only.
// The gate (assertCanGoLive) runs in transitionPost AND again before any request. Nothing here
// is called by a page load: only the owner's Publish / Retry and the scheduled runner (npm run marketing:run).
import type { MarketingChannel } from '@prisma/client'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import { isValidImageKey, PRODUCT_IMAGE_PREFIX } from '@/lib/storage/keys'
import { primaryStorefrontHost } from '@/lib/storefront/public-url'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { getChannel } from './channels'
import { getConnector } from './connectors'
import type { Connector, FetchLike } from './connectors/types'
import { assertCanGoLive, checkCanGoLive } from './flags'
import { transitionPost, type PostDto } from './posts'
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

function publicOrigin(deps: PublishDeps): string | null {
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
  const action = post.status === 'APPROVED' ? 'publish' : post.status === 'SCHEDULED' ? 'start' : post.status === 'FAILED' ? 'retry' : null
  if (!action) throw new WebsiteError(409, 'This post cannot be published from its current status.')

  const settings = await getSettings(db)
  const channel = await channelFor(db, post)
  const gate = { settings, channel, post }
  assertCanGoLive(gate) // before anything changes or any request is made

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

  try {
    const credentials = decryptJson<Record<string, string>>((channel as MarketingChannel).credentialsEnc as string)
    const keys = Array.isArray(post.imageKeys) ? (post.imageKeys as unknown[]).filter((k): k is string => typeof k === 'string') : []
    const imageUrls = publicImageUrls(keys, publicOrigin(deps), def.limits.imageFormat === 'jpeg')
    const result = await connector.publish(
      { id: post.id, text: post.text, imageUrls, link: post.link, format: post.format, trackingTag: post.trackingTag },
      {
        credentials,
        externalId: (channel as MarketingChannel).externalId,
        config: ((channel as MarketingChannel).config as Record<string, unknown> | null) ?? null,
        fetch: deps.fetch,
        gate,
      },
    )
    if (!result.ok) return await fail(result.error, result.code)
    const published = await transitionPost(db, postId, 'published', SYSTEM_ACTOR, { externalId: result.externalId, externalUrl: result.externalUrl, now })
    if (channel) await db.marketingChannel.update({ where: { id: channel.id }, data: { lastError: null } })
    // Extra words from the platform connector (X cost, "sent to your TikTok inbox") go on the activity log.
    if (result.message) await writeAudit(db, { actor: SYSTEM_ACTOR.username, action: 'post.publish_note', entity: 'post', entityId: postId, detail: { message: result.message.slice(0, 300) } })
    return published
  } catch (e) {
    // Never include anything but the message: credentials are not part of it.
    return await fail(e instanceof Error ? e.message : 'Publishing failed.')
  }
}

export interface RunResult {
  checked: number
  published: number[]
  failed: number[]
  /** Posts left SCHEDULED because the gate said no (or the channel has no connector). */
  blocked: { postId: number; reason: string }[]
  /** The first reason a post was left alone, if any. */
  reason: string | null
}

/** Publish SCHEDULED posts that are due. Posts are only touched when checkCanGoLive passes; otherwise they stay SCHEDULED. */
export async function runDuePosts(db: Db, now: Date, deps: PublishDeps, opts: { max?: number } = {}): Promise<RunResult> {
  const max = Math.min(Math.max(Math.trunc(opts.max ?? 10) || 10, 1), 50)
  const due = await db.marketingPost.findMany({
    where: { status: 'SCHEDULED', scheduledFor: { lte: now } },
    orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
    take: max,
  })
  const out: RunResult = { checked: due.length, published: [], failed: [], blocked: [], reason: null }
  if (due.length === 0) return out
  const settings = await getSettings(db)
  for (const p of due) {
    const channel = await channelFor(db, p)
    const check = checkCanGoLive({ settings, channel, post: p })
    if (!check.ok) {
      out.blocked.push({ postId: p.id, reason: check.reason })
      continue
    }
    try {
      const r = await publishPost(db, p.id, SYSTEM_ACTOR, deps, now)
      if (r.status === 'PUBLISHED') out.published.push(p.id)
      else out.failed.push(p.id)
    } catch (e) {
      out.blocked.push({ postId: p.id, reason: e instanceof Error ? e.message : 'Could not publish.' })
    }
  }
  out.reason = out.blocked[0]?.reason ?? null
  return out
}

