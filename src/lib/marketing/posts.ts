// VYRA Marketing hub (ZP-1200): posts (content as it goes out on one channel). Server only.
import type { MarketingPost, Prisma } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import { writeAudit, type Db } from './audit'
import { campaignBlockReason, type WindowCampaign } from './campaign-window'
import { getChannel, isChannelKind, type ChannelDef } from './channels'
import { assertCanGoLive } from './flags'
import { getSettings } from './settings'
import { POST_STATUSES, transition, OWNER_ACTIONS, type Actor, type PostAction, type PostStatus, type TransitionOpts } from './state'
import { buildTrackedLink, generateTrackingTag } from './tracking'
import { asObject, date, imageKeys, onlyKeys, oneOf, requiredText } from './validate'

export type PostDto = Omit<MarketingPost, 'imageKeys' | 'aiOpenings' | 'aiNotes'> & { imageKeys: string[]; aiOpenings: string[]; aiNotes: string[] }

const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((k): k is string => typeof k === 'string') : [])

export const toPostDto = (p: MarketingPost): PostDto => ({
  ...p,
  imageKeys: strings(p.imageKeys),
  aiOpenings: strings(p.aiOpenings),
  aiNotes: strings(p.aiNotes),
})

const asActor = (a: Actor | string): Actor => (typeof a === 'string' ? { username: a, role: 'OWNER' } : a)

function checkText(ch: ChannelDef, text: string) {
  if (text.length > ch.limits.maxText) {
    throw new WebsiteError(400, `${ch.label} allows at most ${ch.limits.maxText} characters (this has ${text.length}).`, { field: 'text' })
  }
}

function checkImages(ch: ChannelDef, keys: string[]) {
  if (keys.length > ch.limits.maxImages) {
    throw new WebsiteError(400, `${ch.label} allows at most ${ch.limits.maxImages} photo${ch.limits.maxImages === 1 ? '' : 's'}.`, { field: 'imageKeys' })
  }
}

export interface PostFilter {
  status?: string | null
  channel?: string | null
  from?: string | null
  to?: string | null
  contentId?: number | null
}

/** Posts by status / channel. from/to match scheduledFor or publishedAt (the calendar). */
export async function listPosts(db: Db, f: PostFilter = {}): Promise<PostDto[]> {
  const where: Prisma.MarketingPostWhereInput = {}
  if (f.status) where.status = oneOf(f.status, 'status', POST_STATUSES)
  if (f.channel) {
    if (!isChannelKind(f.channel)) throw new WebsiteError(400, 'Unknown channel.', { field: 'channel' })
    where.channelKind = f.channel
  }
  if (f.contentId) where.contentId = f.contentId
  const from = f.from ? date(f.from, 'from') : null
  const to = f.to ? date(f.to, 'to') : null
  if (from || to) {
    const range = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) }
    where.OR = [{ scheduledFor: range }, { publishedAt: range }]
  }
  const rows = await db.marketingPost.findMany({ where, orderBy: [{ scheduledFor: 'asc' }, { id: 'desc' }], take: 500 })
  return rows.map(toPostDto)
}

export async function getPost(db: Db, id: number): Promise<PostDto | null> {
  const p = await db.marketingPost.findUnique({ where: { id } })
  return p ? toPostDto(p) : null
}

/** One DRAFT post per channel for a content piece. */
export async function createPostsForContent(
  db: Db,
  contentId: number,
  channelKinds: string[],
  actor: Actor | string,
  opts: { host?: string | null; text?: string | null } = {},
): Promise<PostDto[]> {
  const a = asActor(actor)
  const content = await db.marketingContent.findUnique({ where: { id: contentId }, include: { product: { select: { slug: true } } } })
  if (!content) throw new WebsiteError(404, 'Content not found')
  const kinds = [...new Set(channelKinds)]
  for (const k of kinds) if (!isChannelKind(k)) throw new WebsiteError(400, `Unknown channel "${k}".`, { field: 'channels' })
  const { storefrontHosts } = hostRoutingConfigFromEnv()
  const keys = Array.isArray(content.imageKeys) ? (content.imageKeys as string[]) : []
  const out: PostDto[] = []
  for (const kind of kinds) {
    const ch = getChannel(kind) as ChannelDef
    const text = (opts.text ?? content.brief ?? content.title).slice(0, ch.limits.maxText)
    const row = await db.marketingChannel.findFirst({ where: { kind, status: { in: ['CONNECTED', 'MANUAL'] } }, orderBy: { id: 'asc' }, select: { id: true } })
    const trackingTag = generateTrackingTag()
    const post = await db.marketingPost.create({
      data: {
        contentId,
        channelKind: kind,
        channelId: row?.id ?? null,
        format: ch.formats[0],
        text,
        imageKeys: keys.slice(0, ch.limits.maxImages),
        trackingTag,
        link: buildTrackedLink({ slug: content.product?.slug ?? null, trackingTag, storefrontHosts, host: opts.host }),
        createdBy: a.username,
      },
    })
    await writeAudit(db, { actor: a.username, action: 'post.create', entity: 'post', entityId: post.id, detail: { channel: kind, contentId } })
    out.push(toPostDto(post))
  }
  return out
}

/** Edit text, photos or format. Editing anything past DRAFT sends it back to DRAFT (approval is for the exact words). */
export async function updatePost(db: Db, id: number, body: unknown, actor: Actor | string): Promise<PostDto> {
  const a = asActor(actor)
  const o = asObject(body)
  onlyKeys(o, ['text', 'imageKeys', 'format'])
  const post = await db.marketingPost.findUnique({ where: { id } })
  if (!post) throw new WebsiteError(404, 'Post not found')
  const ch = getChannel(post.channelKind) as ChannelDef
  const data: Prisma.MarketingPostUpdateManyMutationInput = {}
  const changes: string[] = []
  if ('text' in o) {
    const t = requiredText(o.text, 'text', 20000)
    checkText(ch, t)
    if (t !== post.text) { data.text = t; data.aiNotes = []; changes.push('text') } // the check's notes were about the old words
  }
  if ('imageKeys' in o) {
    const k = imageKeys(o.imageKeys, 'imageKeys')
    checkImages(ch, k)
    if (JSON.stringify(k) !== JSON.stringify(post.imageKeys)) { data.imageKeys = k; changes.push('imageKeys') }
  }
  if ('format' in o) {
    const f = oneOf(o.format, 'format', ch.formats)
    if (f !== post.format) { data.format = f; changes.push('format') }
  }
  if (changes.length === 0) return toPostDto(post)
  const t = transition(post, 'edit', a) // throws 409 when the post can no longer be edited
  const res = await db.marketingPost.updateMany({
    where: { id, status: post.status },
    data: { ...data, ...fieldsOf(t) },
  })
  if (res.count === 0) throw new WebsiteError(409, 'Someone else just changed this. Reload and try again.')
  await writeAudit(db, {
    actor: a.username, action: 'post.edit', entity: 'post', entityId: id,
    detail: { fields: changes, from: post.status, to: t.status },
  })
  return toPostDto((await db.marketingPost.findUnique({ where: { id } })) as MarketingPost)
}

const fieldsOf = (t: ReturnType<typeof transition>) => ({ ...t })

const GATED: readonly PostAction[] = ['publish', 'retry', 'start']
/** ZP-1124 (MM-04-AC4): every way out also respects the campaign's dates and pause. */
const IN_CAMPAIGN_WINDOW: readonly PostAction[] = ['publish', 'retry', 'start', 'share']

/** The campaign a post belongs to (through its content), or null when the content is outside any campaign. */
export async function campaignOfPost(db: Db, contentId: number): Promise<WindowCampaign | null> {
  const content = await db.marketingContent.findUnique({
    where: { id: contentId },
    select: { campaign: { select: { id: true, name: true, status: true, startsAt: true, endsAt: true } } },
  })
  return content?.campaign ?? null
}

/** Throws a 409 with a plain reason when the post's campaign does not allow it to go out at `when`. */
export async function assertInCampaignWindow(db: Db, contentId: number, when: Date): Promise<void> {
  const reason = campaignBlockReason(await campaignOfPost(db, contentId), when)
  if (reason) throw new WebsiteError(409, reason, { blocked: 'campaign' })
}

/**
 * Move a post through the status machine. Publishing actions also pass
 * assertCanGoLive. Writes an audit row. `action` from the API must be an owner action.
 */
export async function transitionPost(
  db: Db,
  id: number,
  action: PostAction,
  actor: Actor | string,
  opts: TransitionOpts = {},
): Promise<PostDto> {
  const a = asActor(actor)
  const post = await db.marketingPost.findUnique({ where: { id } })
  if (!post) throw new WebsiteError(404, 'Post not found')
  const ch = getChannel(post.channelKind) as ChannelDef
  if (action === 'submit') {
    if (post.text.trim() === '') throw new WebsiteError(409, 'Write the words for this post first.')
    checkText(ch, post.text)
    const keys = Array.isArray(post.imageKeys) ? post.imageKeys : []
    if (ch.limits.needsImage && keys.length === 0) throw new WebsiteError(409, `${ch.label} needs at least one photo.`)
  }
  const t = transition(post, action, a, opts)
  if (IN_CAMPAIGN_WINDOW.includes(action)) await assertInCampaignWindow(db, post.contentId, opts.now ?? new Date())
  // A scheduled time outside the campaign would only be refused later: refuse it now.
  if (action === 'schedule' && t.scheduledFor) await assertInCampaignWindow(db, post.contentId, t.scheduledFor)
  if (GATED.includes(action)) {
    const settings = await getSettings(db)
    const channel = post.channelId
      ? await db.marketingChannel.findUnique({ where: { id: post.channelId } })
      : await db.marketingChannel.findFirst({ where: { kind: post.channelKind, status: 'CONNECTED' } })
    assertCanGoLive({ settings, channel, post })
  }
  const res = await db.marketingPost.updateMany({ where: { id, status: post.status }, data: { ...t } })
  if (res.count === 0) throw new WebsiteError(409, 'Someone else just changed this. Reload and try again.')
  await writeAudit(db, {
    actor: a.username, action: `post.${action}`, entity: 'post', entityId: id,
    detail: { from: post.status, to: t.status, channel: post.channelKind },
  })
  return toPostDto((await db.marketingPost.findUnique({ where: { id } })) as MarketingPost)
}

export const isOwnerAction = (a: unknown): a is (typeof OWNER_ACTIONS)[number] =>
  typeof a === 'string' && (OWNER_ACTIONS as readonly string[]).includes(a)

export type { PostStatus }
