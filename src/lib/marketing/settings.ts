// VYRA Marketing hub (ZP-1200): the settings singleton. Server only.
import type { MarketingSettings } from '@prisma/client'
import { writeAudit, type Db } from './audit'
import { asObject, bool, int, onlyKeys, oneOf, text } from './validate'
import { WebsiteError } from '@/lib/website/http'
import {
  CONTACT_ROUTES, SALES_MODES, SUPPORTED_CURRENCIES, SUPPORTED_TIME_ZONES, TRUTH_FIELDS, readAudienceNotes, readConfirmations, setupState,
  type Confirmations, type SetupState, type SiteFacts, type TruthField,
} from './shop-truth'

export const SETTINGS_FIELDS = [
  'liveEnabled', 'monthlySpendCapCents', 'metaPixelId', 'productFeedEnabled', 'weeklyPostTarget', 'brandVoice', 'messageDailyCap', 'shopDescription', 'policyDelivery', 'policyReturns', 'policyOrdering',
  // ZP-1106 (MM-01): the shop's truth.
  'market', 'currency', 'timeZone', 'salesMode', 'contactRoute', 'audienceNotes',
  /** Fields whose CURRENT value the owner says is right, without changing it. */
  'confirm',
] as const

/** The one settings row (id 1), created with the safe defaults when missing. */
export async function getSettings(db: Db): Promise<MarketingSettings> {
  return db.marketingSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
}

export async function updateSettings(db: Db, body: unknown, actor: string, now?: Date): Promise<MarketingSettings> {
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
  if ('market' in o) data.market = text(o.market, 'market', 120)
  if ('currency' in o) {
    const v = text(o.currency, 'currency', 8)
    if (v !== null && !(SUPPORTED_CURRENCIES as readonly string[]).includes(v.toUpperCase())) throw new WebsiteError(400, 'For now the shop can only work in US dollars (USD).', { field: 'currency' })
    data.currency = v === null ? null : v.toUpperCase()
  }
  if ('timeZone' in o) {
    const v = text(o.timeZone, 'timeZone', 64)
    if (v !== null && !(SUPPORTED_TIME_ZONES as readonly string[]).includes(v)) throw new WebsiteError(400, 'For now the shop can only work in Harare time (Africa/Harare).', { field: 'timeZone' })
    data.timeZone = v
  }
  if ('salesMode' in o) data.salesMode = o.salesMode === null || o.salesMode === '' ? null : oneOf(o.salesMode, 'salesMode', SALES_MODES)
  if ('contactRoute' in o) data.contactRoute = o.contactRoute === null || o.contactRoute === '' ? null : oneOf(o.contactRoute, 'contactRoute', CONTACT_ROUTES)
  if ('audienceNotes' in o) {
    if (!Array.isArray(o.audienceNotes) || o.audienceNotes.length > 8 || o.audienceNotes.some((x) => typeof x !== 'string' || x.length > 200)) {
      throw new WebsiteError(400, 'Write at most 8 guesses about who buys, each under 200 characters.', { field: 'audienceNotes' })
    }
    data.audienceNotes = readAudienceNotes(o.audienceNotes)
  }
  let confirm: TruthField[] = []
  if ('confirm' in o) {
    if (!Array.isArray(o.confirm) || o.confirm.some((f) => !(TRUTH_FIELDS as readonly string[]).includes(f as string))) throw new WebsiteError(400, 'confirm must be a list of shop facts.', { field: 'confirm' })
    confirm = [...new Set(o.confirm as TruthField[])]
  }
  if ('metaPixelId' in o) {
    const v = text(o.metaPixelId, 'metaPixelId', 32)
    if (v !== null && !/^\d{5,32}$/.test(v)) throw new WebsiteError(400, 'The Meta Pixel ID is a number (digits only).', { field: 'metaPixelId' })
    data.metaPixelId = v
  }
  if (Object.keys(data).length === 0 && confirm.length === 0) throw new WebsiteError(400, 'Nothing to change.')
  const before = await getSettings(db)
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const changed = Object.fromEntries(
    Object.entries(data)
      .filter(([k, v]) => !same((before as Record<string, unknown>)[k], v))
      .map(([k, v]) => [k, { from: (before as Record<string, unknown>)[k] ?? null, to: v }]),
  )
  // MM-01-AC3: a shop fact the owner changed, or said is right, is confirmed by them now.
  // A fact sent back unchanged keeps its earlier confirmation (saving the whole form confirms nothing by itself).
  const confirmations: Confirmations = readConfirmations(before.confirmations)
  const at = (now ?? new Date()).toISOString()
  const confirmed = [...new Set([...confirm, ...TRUTH_FIELDS.filter((f) => f in changed)])]
  for (const f of confirmed) confirmations[f] = { by: actor, at }
  const row = await db.marketingSettings.update({ where: { id: 1 }, data: { ...data, confirmations: confirmations as never, updatedBy: actor } })
  if (Object.keys(changed).length > 0 || confirm.length > 0) {
    await writeAudit(db, { actor, action: 'settings.update', entity: 'settings', entityId: 1, detail: { ...changed, ...(confirmed.length > 0 ? { confirmed } : {}) } as never })
  }
  return row
}

/** The contact facts the website settings already hold. Read, never copied. */
export async function siteFacts(db: Db): Promise<SiteFacts> {
  const s = await db.siteSettings.findUnique({ where: { id: 1 }, select: { whatsappNumber: true, phone: true, email: true, address: true, openingHours: true, paymentMethods: true, holdHours: true } })
  return {
    whatsappNumber: s?.whatsappNumber ?? null, phone: s?.phone ?? null, email: s?.email ?? null, address: s?.address ?? null,
    openingHoursSet: s?.openingHours !== null && s?.openingHours !== undefined, paymentMethods: s?.paymentMethods ?? null, holdHours: s?.holdHours ?? null,
  }
}

/** What the setup knows and what it still has to ask (MM-01, MM-02-AC1). */
export async function getSetupState(db: Db): Promise<SetupState> {
  return setupState(await getSettings(db), await siteFacts(db))
}
