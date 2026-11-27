// VYRA Marketing hub (ZP-1200): the settings singleton. Server only.
import type { MarketingSettings } from '@prisma/client'
import { writeAudit, type Db } from './audit'
import { asObject, bool, int, onlyKeys, text } from './validate'
import { WebsiteError } from '@/lib/website/http'

export const SETTINGS_FIELDS = ['liveEnabled', 'monthlySpendCapCents', 'metaPixelId', 'productFeedEnabled', 'weeklyPostTarget', 'brandVoice', 'messageDailyCap', 'shopDescription', 'policyDelivery', 'policyReturns', 'policyOrdering'] as const

/** The one settings row (id 1), created with the safe defaults when missing. */
export async function getSettings(db: Db): Promise<MarketingSettings> {
  return db.marketingSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
}

export async function updateSettings(db: Db, body: unknown, actor: string): Promise<MarketingSettings> {
  const o = asObject(body)
  onlyKeys(o, SETTINGS_FIELDS)
  const data: Record<string, unknown> = {}
  if ('liveEnabled' in o) data.liveEnabled = bool(o.liveEnabled, 'liveEnabled')
  if ('productFeedEnabled' in o) data.productFeedEnabled = bool(o.productFeedEnabled, 'productFeedEnabled')
  if ('monthlySpendCapCents' in o) data.monthlySpendCapCents = int(o.monthlySpendCapCents, 'monthlySpendCapCents', 0, 100_000_000)
  if ('weeklyPostTarget' in o) data.weeklyPostTarget = int(o.weeklyPostTarget, 'weeklyPostTarget', 0, 100)
  if ('messageDailyCap' in o) data.messageDailyCap = int(o.messageDailyCap, 'messageDailyCap', 0, 10000)
  if ('brandVoice' in o) data.brandVoice = text(o.brandVoice, 'brandVoice', 1000)
  if ('shopDescription' in o) data.shopDescription = text(o.shopDescription, 'shopDescription', 200)
  for (const k of ['policyDelivery', 'policyReturns', 'policyOrdering'] as const) if (k in o) data[k] = text(o[k], k, 500)
  if ('metaPixelId' in o) {
    const v = text(o.metaPixelId, 'metaPixelId', 32)
    if (v !== null && !/^\d{5,32}$/.test(v)) throw new WebsiteError(400, 'The Meta Pixel ID is a number (digits only).', { field: 'metaPixelId' })
    data.metaPixelId = v
  }
  if (Object.keys(data).length === 0) throw new WebsiteError(400, 'Nothing to change.')
  const before = await getSettings(db)
  const changed = Object.fromEntries(
    Object.entries(data)
      .filter(([k, v]) => (before as Record<string, unknown>)[k] !== v)
      .map(([k, v]) => [k, { from: (before as Record<string, unknown>)[k] ?? null, to: v }]),
  )
  const row = await db.marketingSettings.update({ where: { id: 1 }, data: { ...data, updatedBy: actor } })
  if (Object.keys(changed).length > 0) {
    await writeAudit(db, { actor, action: 'settings.update', entity: 'settings', entityId: 1, detail: changed as never })
  }
  return row
}
