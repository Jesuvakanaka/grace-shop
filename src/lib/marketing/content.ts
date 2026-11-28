// VYRA Marketing hub (ZP-1200): content ideas (one idea, many posts). Server only.
import type { MarketingContent, MarketingPost, Prisma } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { createPostsForContent, toPostDto, type PostDto } from './posts'
import { JOBS, URGENCY_KINDS } from './brief'
import { asObject, imageKeys, oneOf, onlyKeys, requiredText, text } from './validate'
import { assertNewProductsMarketable } from './catalogue'

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

export const BRIEF_FIELDS = ['job', 'reader', 'message', 'proof', 'urgencyKind', 'urgencyText', 'action'] as const

/** The structured brief fields present in the body, validated. A job is optional so old screens keep working. */
function briefData(o: Record<string, unknown>): Partial<Record<(typeof BRIEF_FIELDS)[number], string | null>> {
  const d: Partial<Record<(typeof BRIEF_FIELDS)[number], string | null>> = {}
  if ('job' in o) d.job = o.job === null || o.job === '' ? null : oneOf(o.job, 'job', JOBS)
  if ('reader' in o) d.reader = text(o.reader, 'reader', 400)
  if ('message' in o) d.message = text(o.message, 'message', 600)
  if ('proof' in o) d.proof = text(o.proof, 'proof', 600)
  if ('urgencyKind' in o) d.urgencyKind = o.urgencyKind === null || o.urgencyKind === '' ? null : oneOf(o.urgencyKind, 'urgencyKind', URGENCY_KINDS)
  if ('urgencyText' in o) d.urgencyText = text(o.urgencyText, 'urgencyText', 200)
  if ('action' in o) d.action = text(o.action, 'action', 160)
  if (d.urgencyKind === 'OWN' && 'urgencyText' in o && !d.urgencyText) throw new WebsiteError(400, 'Type your reason to act now, or choose "None".', { field: 'urgencyText' })
  if (d.urgencyKind !== undefined && d.urgencyKind !== 'OWN') d.urgencyText = null
  return d
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
  onlyKeys(o, ['title', 'brief', 'campaignId', 'productId', 'imageKeys', 'channels', ...BRIEF_FIELDS])
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
  if (productId) await assertNewProductsMarketable(db, [productId]) // ZP-1106 (MM-01-AC4)
  const plan = briefData(o)
  if (plan.urgencyKind === 'OWN' && !plan.urgencyText) throw new WebsiteError(400, 'Type your reason to act now, or choose "None".', { field: 'urgencyText' })
  const row = await db.marketingContent.create({ data: { title, brief, campaignId, productId, imageKeys: keys, createdBy: actor, ...plan } })
  await writeAudit(db, { actor, action: 'content.create', entity: 'content', entityId: row.id, detail: { title } })
  if (channels.length > 0) await createPostsForContent(db, row.id, channels, actor, opts)
  return (await getContent(db, row.id)) as ContentDto
}

export async function updateContent(db: Db, id: number, body: unknown, actor: string): Promise<ContentDto> {
  const o = asObject(body)
  onlyKeys(o, ['title', 'brief', 'campaignId', 'productId', 'imageKeys', ...BRIEF_FIELDS])
  const data: Prisma.MarketingContentUncheckedUpdateInput = { ...briefData(o) }
  if ('title' in o) data.title = requiredText(o.title, 'title', 160)
  if ('brief' in o) data.brief = text(o.brief, 'brief', 4000)
  if ('campaignId' in o) data.campaignId = refId(o.campaignId, 'campaignId')
  if ('productId' in o) data.productId = refId(o.productId, 'productId')
  if ('imageKeys' in o) data.imageKeys = imageKeys(o.imageKeys, 'imageKeys')
  if (Object.keys(data).length === 0) throw new WebsiteError(400, 'Nothing to change.')
  const existing = await db.marketingContent.findUnique({ where: { id }, select: { id: true, productId: true } })
  if (!existing) throw new WebsiteError(404, 'Content not found')
  await checkRefs(db, (data.campaignId as number | null) ?? null, (data.productId as number | null) ?? null)
  // ZP-1106 (MM-01-AC4): a newly chosen product must be on the website and in stock (or on pre-order).
  if (typeof data.productId === 'number' && data.productId !== existing.productId) await assertNewProductsMarketable(db, [data.productId])
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
