// VYRA Marketing hub (ZP-1200): write the words for a content idea's draft posts with AI. Server only.
import { aiStatus } from '@/lib/ai/config'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from '../audit'
import { toPostDto, type PostDto } from '../posts'
import { getSettings } from '../settings'
import { draftPosts, type DraftFailure, type DraftInput, type DraftResult } from './writer'

export const DRAFTABLE = ['DRAFT', 'REJECTED']

export interface DraftOutcome {
  posts: PostDto[]
  failed: DraftFailure[]
  costCents: number
  writer: 'claude' | 'openai'
}

/**
 * Write text for this content's DRAFT/REJECTED posts (or only `channels`).
 * 404 unknown content, 400 channel with no post, 409 a chosen post is past DRAFT/REJECTED
 * or there is nothing to write, 503 no AI key. `write` is injectable for tests.
 */
export async function draftContentPosts(
  db: Db,
  contentId: number,
  opts: { channels?: string[]; actor: string; write?: (input: DraftInput) => Promise<DraftResult> },
): Promise<DraftOutcome> {
  const content = await db.marketingContent.findUnique({ where: { id: contentId }, include: { product: true, campaign: true, posts: { orderBy: { id: 'asc' } } } })
  if (!content) throw new WebsiteError(404, 'Content not found')
  let targets = content.posts
  if (opts.channels && opts.channels.length > 0) {
    targets = []
    for (const kind of new Set(opts.channels)) {
      const post = content.posts.find((p) => p.channelKind === kind)
      if (!post) throw new WebsiteError(400, `This idea has no post for ${kind}.`, { field: 'channels' })
      if (!DRAFTABLE.includes(post.status)) throw new WebsiteError(409, `The ${kind} post cannot be rewritten: it is ${post.status.toLowerCase().replace('_', ' ')}.`)
      targets.push(post)
    }
  } else {
    targets = content.posts.filter((p) => DRAFTABLE.includes(p.status))
    if (targets.length === 0) throw new WebsiteError(409, 'There are no draft posts to write.')
  }
  if (!opts.write && !aiStatus().text) throw new WebsiteError(503, 'AI writing is not set up yet: no AI key is configured.')

  const settings = await getSettings(db)
  const product = content.product
  const write = opts.write ?? ((i: DraftInput) => draftPosts(i))
  const result = await write({
    product: product ?? { productName: content.title, sellingPriceUsd: 0, priceDisplay: 'ASK_FOR_PRICE' },
    brief: content.brief ?? content.title,
    channels: targets.map((p) => p.channelKind),
    brandVoice: settings.brandVoice,
    campaignGoal: content.campaign?.goal ?? null,
    links: Object.fromEntries(targets.map((p) => [p.channelKind, p.link])),
  })

  const n = Math.max(result.drafts.length, 1)
  const out: PostDto[] = []
  const failed = [...result.failures]
  let i = 0
  for (const d of result.drafts) {
    const post = targets.find((p) => p.channelKind === d.channel)
    if (!post) continue
    const cost = Math.floor(result.costCents / n) + (i === 0 ? result.costCents % n : 0)
    i++
    const res = await db.marketingPost.updateMany({
      where: { id: post.id, status: post.status },
      data: { text: d.text, aiGenerated: true, aiCostCents: { increment: cost }, status: 'DRAFT', approvedBy: null, approvedAt: null, scheduledFor: null },
    })
    if (res.count === 0) {
      failed.push({ channel: d.channel, reason: 'Someone else just changed this post.' })
      continue
    }
    await writeAudit(db, {
      actor: opts.actor, action: 'post.ai_draft', entity: 'post', entityId: post.id,
      detail: { channel: post.channelKind, from: post.status, costCents: cost, writer: result.writer },
    })
    out.push(toPostDto((await db.marketingPost.findUnique({ where: { id: post.id } }))!))
  }
  return { posts: out, failed, costCents: result.costCents, writer: result.writer }
}
