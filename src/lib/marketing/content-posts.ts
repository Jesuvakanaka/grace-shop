// VYRA Marketing hub (ZP-1200): add channels (draft posts) to existing content. Server only.
import { WebsiteError } from '@/lib/website/http'
import type { Db } from './audit'
import { createPostsForContent, type PostDto } from './posts'
import { asObject, onlyKeys } from './validate'

/** Body { channels: string[] }. Channels the content already has are skipped. */
export async function addChannelsToContent(db: Db, contentId: number, body: unknown, actor: string, opts: { host?: string | null } = {}): Promise<PostDto[]> {
  const o = asObject(body)
  onlyKeys(o, ['channels'])
  if (!Array.isArray(o.channels) || o.channels.length === 0 || o.channels.length > 40 || o.channels.some((c) => typeof c !== 'string')) {
    throw new WebsiteError(400, 'Choose at least one channel.', { field: 'channels' })
  }
  const existing = await db.marketingPost.findMany({ where: { contentId }, select: { channelKind: true } })
  const have = new Set(existing.map((p) => p.channelKind))
  const fresh = (o.channels as string[]).filter((c) => !have.has(c))
  if (fresh.length === 0) return []
  return createPostsForContent(db, contentId, fresh, actor, opts)
}
