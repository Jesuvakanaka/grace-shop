// VYRA Marketing hub: the selling profile of a product (who buys it, why, what stops them). Server only
// for the database functions; the types and cleanProfile are pure.
import type { MarketingSellingProfile } from '@prisma/client'
import { aiStatus } from '@/lib/ai/config'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { getSettings } from './settings'
import { asObject, onlyKeys } from './validate'
import { shopIdentity, shopPolicies } from './ai/shop'
import type { ProfileInput, ProfileResult } from './ai/profile'
import { ASK, PROFILE_LIMITS, cleanProfile, type SellingProfile } from './profile-model'

export * from './profile-model'

export type SellingProfileDto = SellingProfile & { productId: number; aiGenerated: boolean; updatedBy: string | null; updatedAt: Date }

const toDto = (row: MarketingSellingProfile): SellingProfileDto => ({
  ...cleanProfile(row),
  productId: row.productId,
  aiGenerated: row.aiGenerated,
  updatedBy: row.updatedBy,
  updatedAt: row.updatedAt,
})

export async function getProfile(db: Db, productId: number): Promise<SellingProfileDto | null> {
  const row = await db.marketingSellingProfile.findUnique({ where: { productId } })
  return row ? toDto(row) : null
}

/**
 * Ask the AI for this product's profile and save it (replacing any earlier one).
 * 404 unknown product, 503 no AI key. `write` is injectable for tests.
 */
export async function generateProfile(
  db: Db,
  productId: number,
  actor: string,
  opts: { write?: (input: ProfileInput) => Promise<ProfileResult> } = {},
): Promise<SellingProfileDto> {
  const product = await db.product.findUnique({ where: { id: productId }, include: { category: { select: { name: true } } } })
  if (!product) throw new WebsiteError(404, 'Product not found')
  if (!opts.write && !aiStatus().text) throw new WebsiteError(503, 'AI writing is not set up yet: no AI key is configured.')
  const settings = await getSettings(db)
  const write = opts.write ?? (async (i: ProfileInput) => (await import('./ai/profile')).writeProfile(i))
  const result = await write({
    product: { ...product, category: product.category?.name ?? null },
    shop: shopIdentity(settings),
    policies: shopPolicies(settings),
    brandVoice: settings.brandVoice,
  })
  const data = { ...result.profile, aiGenerated: true, updatedBy: actor } as const
  const row = await db.marketingSellingProfile.upsert({
    where: { productId },
    update: { ...data, aiCostCents: { increment: result.costCents } },
    create: { productId, ...data, aiCostCents: result.costCents },
  })
  await writeAudit(db, { actor, action: 'profile.ai_write', entity: 'product', entityId: productId, detail: { costCents: result.costCents, writer: result.writer } })
  return toDto(row)
}

/** The owner's corrections. The whole profile is sent; anything malformed is refused, not silently dropped. */
export async function saveProfile(db: Db, productId: number, body: unknown, actor: string): Promise<SellingProfileDto> {
  const o = asObject(body)
  onlyKeys(o, ['buyers', 'reasons', 'doubts', 'occasions'])
  for (const k of ['buyers', 'reasons', 'doubts', 'occasions'] as const) {
    if (!Array.isArray(o[k])) throw new WebsiteError(400, `${k} must be a list.`, { field: k })
    if ((o[k] as unknown[]).length > PROFILE_LIMITS[k]) throw new WebsiteError(400, `At most ${PROFILE_LIMITS[k]} ${k}.`, { field: k })
  }
  const profile = cleanProfile(o)
  const sent = (k: 'buyers' | 'reasons' | 'doubts' | 'occasions') => (o[k] as unknown[]).length
  if (profile.buyers.length !== sent('buyers') || profile.reasons.length !== sent('reasons') || profile.doubts.length !== sent('doubts') || profile.occasions.length !== new Set(o.occasions as unknown[]).size) {
    throw new WebsiteError(400, 'Fill in both boxes on every line, and leave prices out: the shop adds the price itself.')
  }
  const answers = (o.doubts as unknown[]).map((d) => (typeof d === 'object' && d !== null ? (d as Record<string, unknown>).answer : null))
  if (answers.some((a, i) => typeof a === 'string' && a.trim() !== '' && !ASK.test(a) && profile.doubts[i].answer === null)) {
    throw new WebsiteError(400, 'Leave prices out of the answers: the shop adds the price itself.', { field: 'doubts' })
  }
  if (!(await db.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw new WebsiteError(404, 'Product not found')
  const row = await db.marketingSellingProfile.upsert({
    where: { productId },
    update: { ...profile, aiGenerated: false, updatedBy: actor },
    create: { productId, ...profile, aiGenerated: false, updatedBy: actor },
  })
  await writeAudit(db, { actor, action: 'profile.edit', entity: 'product', entityId: productId, detail: { buyers: profile.buyers.length, reasons: profile.reasons.length, doubts: profile.doubts.length } })
  return toDto(row)
}
