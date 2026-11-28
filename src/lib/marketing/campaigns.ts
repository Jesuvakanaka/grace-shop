// VYRA Marketing hub (ZP-1200): campaigns. Server only.
import type { MarketingCampaign, Prisma } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { asObject, date, idList, int, onlyKeys, oneOf, requiredText, text } from './validate'
import { assertNewProductsMarketable } from './catalogue'

export const OBJECTIVES = ['AWARENESS', 'VISITS', 'ENQUIRIES'] as const
/** ARCHIVED replaces deleting (ZP-1124, MM-04-AC6): the campaign and its history stay, hidden from the normal list. */
export const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED'] as const
/** The statuses the owner can set by editing. Archiving has its own action. */
const SETTABLE_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'] as const
const FIELDS = ['name', 'goal', 'objective', 'status', 'startsAt', 'endsAt', 'budgetCents', 'notes', 'productIds'] as const

export type CampaignDto = MarketingCampaign & { productIds: number[] }

type WithProducts = MarketingCampaign & { products: { productId: number }[] }
const toDto = ({ products, ...c }: WithProducts): CampaignDto => ({ ...c, productIds: products.map((p) => p.productId).sort((a, b) => a - b) })
const include = { products: { select: { productId: true } } } as const

export async function listCampaigns(db: Db, status?: string | null): Promise<CampaignDto[]> {
  const where: Prisma.MarketingCampaignWhereInput = {}
  if (status) where.status = oneOf(status, 'status', CAMPAIGN_STATUSES)
  else where.status = { not: 'ARCHIVED' }
  return (await db.marketingCampaign.findMany({ where, orderBy: { id: 'desc' }, include })).map(toDto)
}

export async function getCampaign(db: Db, id: number): Promise<CampaignDto | null> {
  const c = await db.marketingCampaign.findUnique({ where: { id }, include })
  return c ? toDto(c) : null
}

async function checkProducts(db: Db, ids: number[]) {
  if (ids.length === 0) return
  const n = await db.product.count({ where: { id: { in: ids } } })
  if (n !== ids.length) throw new WebsiteError(400, 'One of the chosen products does not exist.', { field: 'productIds' })
}

function parse(o: Record<string, unknown>, creating: boolean) {
  onlyKeys(o, FIELDS)
  const d: Prisma.MarketingCampaignUncheckedUpdateInput = {}
  if (creating || 'name' in o) d.name = requiredText(o.name, 'name', 120)
  if ('goal' in o) d.goal = text(o.goal, 'goal', 500)
  if ('objective' in o) d.objective = oneOf(o.objective, 'objective', OBJECTIVES)
  if ('status' in o) d.status = oneOf(o.status, 'status', SETTABLE_STATUSES)
  if ('startsAt' in o) d.startsAt = date(o.startsAt, 'startsAt')
  if ('endsAt' in o) d.endsAt = date(o.endsAt, 'endsAt')
  if ('budgetCents' in o) d.budgetCents = o.budgetCents === null ? null : int(o.budgetCents, 'budgetCents', 0, 100_000_000)
  if ('notes' in o) d.notes = text(o.notes, 'notes', 2000)
  const productIds = 'productIds' in o ? idList(o.productIds, 'productIds') : null
  return { d, productIds }
}

function checkDates(startsAt: Date | null | undefined, endsAt: Date | null | undefined) {
  if (startsAt && endsAt && endsAt < startsAt) throw new WebsiteError(400, 'The end date is before the start date.', { field: 'endsAt' })
}

export async function createCampaign(db: Db, body: unknown, actor: string): Promise<CampaignDto> {
  const { d, productIds } = parse(asObject(body), true)
  checkDates(d.startsAt as Date | null | undefined, d.endsAt as Date | null | undefined)
  if (productIds) await checkProducts(db, productIds)
  if (productIds) await assertNewProductsMarketable(db, productIds) // ZP-1106 (MM-01-AC4)
  const row = await db.marketingCampaign.create({
    data: {
      ...(d as Prisma.MarketingCampaignUncheckedCreateInput),
      name: d.name as string,
      createdBy: actor,
      products: productIds ? { create: productIds.map((productId) => ({ productId })) } : undefined,
    },
    include,
  })
  await writeAudit(db, { actor, action: 'campaign.create', entity: 'campaign', entityId: row.id, detail: { name: row.name } })
  return toDto(row)
}

/**
 * ZP-1124 (MM-04-AC4): an ad already running on Meta or Google keeps spending on the platform whatever the
 * hub says, and this slice does not pause it remotely (that is MM-04-AC5). So a campaign with a running ad
 * cannot be archived or ended here: the owner pauses the ad first.
 */
async function assertNoRunningAd(db: Db, campaignId: number, what: 'archive' | 'end'): Promise<void> {
  const running = await db.marketingAd.findMany({ where: { campaignId, status: 'ACTIVE' }, select: { id: true, headline: true }, take: 3 })
  if (running.length === 0) return
  const names = running.map((a) => `"${a.headline}"`).join(', ')
  throw new WebsiteError(409, `This campaign has an ad running on the platform (${names}). Pause the ad on the Ads screen first, then ${what} the campaign.`, { blocked: 'ad' })
}

export async function updateCampaign(db: Db, id: number, body: unknown, actor: string): Promise<CampaignDto> {
  const { d, productIds } = parse(asObject(body), false)
  if (Object.keys(d).length === 0 && !productIds) throw new WebsiteError(400, 'Nothing to change.')
  const existing = await db.marketingCampaign.findUnique({ where: { id } })
  if (!existing) throw new WebsiteError(404, 'Campaign not found')
  if (existing.status === 'ARCHIVED') throw new WebsiteError(409, 'This campaign is archived and can no longer be changed.')
  if (d.status === 'ENDED' && existing.status !== 'ENDED') await assertNoRunningAd(db, id, 'end')
  checkDates((d.startsAt as Date | null | undefined) ?? existing.startsAt, (d.endsAt as Date | null | undefined) ?? existing.endsAt)
  if (productIds) {
    await checkProducts(db, productIds)
    // ZP-1106 (MM-01-AC4): newly added products must be marketable; ones already chosen stay listed.
    const had = new Set((await db.marketingCampaignProduct.findMany({ where: { campaignId: id }, select: { productId: true } })).map((r) => r.productId))
    await assertNewProductsMarketable(db, productIds.filter((p) => !had.has(p)))
    await db.marketingCampaignProduct.deleteMany({ where: { campaignId: id } })
    await db.marketingCampaignProduct.createMany({ data: productIds.map((productId) => ({ campaignId: id, productId })) })
  }
  const row = await db.marketingCampaign.update({ where: { id }, data: d, include })
  await writeAudit(db, {
    actor,
    action: existing.status !== row.status ? `campaign.${row.status.toLowerCase()}` : 'campaign.update',
    entity: 'campaign',
    entityId: id,
    detail: { fields: Object.keys(o2(body)) },
  })
  return toDto(row)
}

const o2 = (b: unknown) => (typeof b === 'object' && b ? (b as Record<string, unknown>) : {})

/**
 * Archives the campaign instead of deleting it (ZP-1124, MM-04-AC6): the campaign, its content, posts
 * and results stay for the record. Posts that have not gone out are withdrawn with a reason, and nothing
 * from an archived campaign can go out (campaign-window.ts). Archiving twice is harmless.
 */
export async function archiveCampaign(db: Db, id: number, actor: string): Promise<CampaignDto> {
  const existing = await db.marketingCampaign.findUnique({ where: { id }, include })
  if (!existing) throw new WebsiteError(404, 'Campaign not found')
  if (existing.status === 'ARCHIVED') return toDto(existing)
  await assertNoRunningAd(db, id, 'archive')
  const res = await db.marketingCampaign.updateMany({ where: { id, status: existing.status }, data: { status: 'ARCHIVED' } })
  if (res.count === 0) throw new WebsiteError(409, 'Someone else just changed this campaign. Reload and try again.')
  const posts = await db.marketingPost.findMany({ where: { status: { in: ['APPROVED', 'SCHEDULED'] }, content: { campaignId: id } }, select: { id: true, status: true } })
  const withdrawn: number[] = []
  for (const p of posts) {
    const r = await db.marketingPost.updateMany({
      where: { id: p.id, status: p.status },
      data: { status: 'CANCELLED', scheduledFor: null, error: 'Withdrawn: the campaign was archived before this went out.' },
    })
    if (r.count === 1) withdrawn.push(p.id)
  }
  await writeAudit(db, { actor, action: 'campaign.archive', entity: 'campaign', entityId: id, detail: { name: existing.name, from: existing.status, withdrawnPosts: withdrawn } })
  return (await getCampaign(db, id)) as CampaignDto
}
