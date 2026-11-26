// VYRA Marketing hub (ZP-1200): campaigns. Server only.
import type { MarketingCampaign, Prisma } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { asObject, date, idList, int, onlyKeys, oneOf, requiredText, text } from './validate'

export const OBJECTIVES = ['AWARENESS', 'VISITS', 'ENQUIRIES'] as const
export const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'] as const
const FIELDS = ['name', 'goal', 'objective', 'status', 'startsAt', 'endsAt', 'budgetCents', 'notes', 'productIds'] as const

export type CampaignDto = MarketingCampaign & { productIds: number[] }

type WithProducts = MarketingCampaign & { products: { productId: number }[] }
const toDto = ({ products, ...c }: WithProducts): CampaignDto => ({ ...c, productIds: products.map((p) => p.productId).sort((a, b) => a - b) })
const include = { products: { select: { productId: true } } } as const

export async function listCampaigns(db: Db, status?: string | null): Promise<CampaignDto[]> {
  const where: Prisma.MarketingCampaignWhereInput = {}
  if (status) where.status = oneOf(status, 'status', CAMPAIGN_STATUSES)
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
  if ('status' in o) d.status = oneOf(o.status, 'status', CAMPAIGN_STATUSES)
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

export async function updateCampaign(db: Db, id: number, body: unknown, actor: string): Promise<CampaignDto> {
  const { d, productIds } = parse(asObject(body), false)
  if (Object.keys(d).length === 0 && !productIds) throw new WebsiteError(400, 'Nothing to change.')
  const existing = await db.marketingCampaign.findUnique({ where: { id } })
  if (!existing) throw new WebsiteError(404, 'Campaign not found')
  checkDates((d.startsAt as Date | null | undefined) ?? existing.startsAt, (d.endsAt as Date | null | undefined) ?? existing.endsAt)
  if (productIds) {
    await checkProducts(db, productIds)
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

/** Deletes the campaign; its content and posts stay (content is detached). */
export async function deleteCampaign(db: Db, id: number, actor: string): Promise<void> {
  const existing = await db.marketingCampaign.findUnique({ where: { id } })
  if (!existing) throw new WebsiteError(404, 'Campaign not found')
  await db.marketingCampaign.delete({ where: { id } })
  await writeAudit(db, { actor, action: 'campaign.delete', entity: 'campaign', entityId: id, detail: { name: existing.name } })
}
