// VYRA Marketing hub (ZP-1200): content ideas (one idea, many posts). Server only.
import type { MarketingContent, MarketingPost, Prisma } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { createPostsForContent, toPostDto, type PostDto } from './posts'
import { asObject, imageKeys, onlyKeys, requiredText, text } from './validate'

export type ContentDto = Omit<MarketingContent, 'imageKeys'> & { imageKeys: string[]; posts?: PostDto[] }

const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [])
const toDto = (c: MarketingContent & { posts?: MarketingPost[] }): ContentDto => ({
  ...c,
  imageKeys: keysOf(c.imageKeys),
  posts: c.posts?.map(toPostDto),
})

export async function listContent(db: Db, f: { campaignId?: number | null } = {}): Promise<ContentDto[]> {
  const where: Prisma.MarketingContentWhereInput = f.campaignId ? { campaignId: f.campaignId } : {}
  return (await db.marketingContent.findMany({ where, orderBy: { id: 'desc' }, include: { posts: { orderBy: { id: 'asc' } } }, take: 300 })).map(toDto)
}

export async function getContent(db: Db, id: number): Promise<ContentDto | null> {
  const c = await db.marketingContent.findUnique({ where: { id }, include: { posts: { orderBy: { id: 'asc' } } } })
  return c ? toDto(c) : null
}

function refId(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new WebsiteError(400, `${field} is not valid.`, { field })
  return v
}

async function checkRefs(db: Db, campaignId: number | null, productId: number | null) {
  if (campaignId && !(await db.marketingCampaign.findUnique({ where: { id: campaignId }, select: { id: true } }))) {
    throw new WebsiteError(400, 'That campaign does not exist.', { field: 'campaignId' })
  }
  if (productId && !(await db.product.findUnique({ where: { id: productId }, select: { id: true } }))) {
    throw new WebsiteError(400, 'That product does not exist.', { field: 'productId' })
  }
}

/** Create a content idea; `channels` (optional) also creates one draft post per channel. */
export async function createContent(db: Db, body: unknown, actor: string, opts: { host?: string | null } = {}): Promise<ContentDto> {
  const o = asObject(body)
  onlyKeys(o, ['title', 'brief', 'campaignId', 'productId', 'imageKeys', 'channels'])
  const title = requiredText(o.title, 'title', 160)
  const brief = text(o.brief, 'brief', 4000)
  const campaignId = refId(o.campaignId, 'campaignId')
  const productId = refId(o.productId, 'productId')
  const keys = 'imageKeys' in o ? imageKeys(o.imageKeys, 'imageKeys') : []
  let channels: string[] = []
  if ('channels' in o) {
    if (!Array.isArray(o.channels) || o.channels.some((c) => typeof c !== 'string') || o.channels.length > 40) {
      throw new WebsiteError(400, 'channels must be a list of channel names.', { field: 'channels' })
    }
    channels = o.channels as string[]
  }
  await checkRefs(db, campaignId, productId)
  const row = await db.marketingContent.create({ data: { title, brief, campaignId, productId, imageKeys: keys, createdBy: actor } })
  await writeAudit(db, { actor, action: 'content.create', entity: 'content', entityId: row.id, detail: { title } })
  if (channels.length > 0) await createPostsForContent(db, row.id, channels, actor, opts)
  return (await getContent(db, row.id)) as ContentDto
}

export async function updateContent(db: Db, id: number, body: unknown, actor: string): Promise<ContentDto> {
  const o = asObject(body)
  onlyKeys(o, ['title', 'brief', 'campaignId', 'productId', 'imageKeys'])
  const data: Prisma.MarketingContentUncheckedUpdateInput = {}
  if ('title' in o) data.title = requiredText(o.title, 'title', 160)
  if ('brief' in o) data.brief = text(o.brief, 'brief', 4000)
  if ('campaignId' in o) data.campaignId = refId(o.campaignId, 'campaignId')
  if ('productId' in o) data.productId = refId(o.productId, 'productId')
  if ('imageKeys' in o) data.imageKeys = imageKeys(o.imageKeys, 'imageKeys')
  if (Object.keys(data).length === 0) throw new WebsiteError(400, 'Nothing to change.')
  if (!(await db.marketingContent.findUnique({ where: { id }, select: { id: true } }))) throw new WebsiteError(404, 'Content not found')
  await checkRefs(db, (data.campaignId as number | null) ?? null, (data.productId as number | null) ?? null)
  await db.marketingContent.update({ where: { id }, data })
  await writeAudit(db, { actor, action: 'content.update', entity: 'content', entityId: id, detail: { fields: Object.keys(o) } })
  return (await getContent(db, id)) as ContentDto
}

/** Deletes the content and its posts. Refused while a post is being published or already went out. */
export async function deleteContent(db: Db, id: number, actor: string): Promise<void> {
  const c = await db.marketingContent.findUnique({ where: { id }, include: { posts: { select: { status: true } } } })
  if (!c) throw new WebsiteError(404, 'Content not found')
  if (c.posts.some((p) => ['PUBLISHING', 'PUBLISHED', 'SHARED'].includes(p.status))) {
    throw new WebsiteError(409, 'Some of this has already gone out, so it is kept for the record.')
  }
  await db.marketingContent.delete({ where: { id } })
  await writeAudit(db, { actor, action: 'content.delete', entity: 'content', entityId: id, detail: { title: c.title } })
}
