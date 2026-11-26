// VYRA Marketing hub (ZP-1200): partners (influencers, resellers, ambassadors). Server only.
// The hub only REPORTS: it pays nothing. A partner's `code` is the ?src= tag on every link they share, so
// their visits and enquiries come from AnalyticsDailySource where campaign = code.
import type { MarketingPartner } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { campaignFromSearch } from '@/lib/analytics/context'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { normalizePhone } from './consent'
import { buildTrackedLink } from './tracking'
import { asObject, int, onlyKeys, oneOf, requiredText, text } from './validate'

export const PARTNER_KINDS = ['INFLUENCER', 'RESELLER', 'AMBASSADOR'] as const
export const PARTNER_STATUSES = ['ACTIVE', 'PAUSED'] as const
export const PARTNER_KIND_LABELS: Record<string, string> = { INFLUENCER: 'Influencer', RESELLER: 'Reseller', AMBASSADOR: 'Ambassador' }

const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const POST_TAG = /^mk[0-9a-f]{12}$/

/** Why a code cannot be used, or null. It must survive the analytics tag cleaning unchanged. */
export function codeProblem(code: string): string | null {
  if (code.length < 3 || code.length > 32) return 'The code must be 3 to 32 characters.'
  if (!CODE.test(code)) return 'The code can only use small letters, numbers and single dashes (for example tendai-23).'
  if (POST_TAG.test(code)) return 'That code looks like an automatic post tag. Pick another.'
  if (campaignFromSearch(`?src=${code}`) !== code) return 'That code would be changed by the link tracking. Pick another.'
  return null
}

/** A readable code from the name plus a few random characters, e.g. "tendai-k7". */
export function suggestCode(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0]?.slice(0, 14) || 'partner'
  return `${base}-${randomBytes(2).toString('hex').slice(0, 3)}`
}

export interface PartnerResults { days: number; visits: number; enquiries: number; byDay: { day: string; visits: number; enquiries: number }[] }

/** Visits and enquiring visits tagged with the code over the last `days` days (default 30). */
export async function partnerResults(db: Db, code: string, days = 30, now = new Date()): Promise<PartnerResults> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days))
  const g = await db.analyticsDailySource.groupBy({ by: ['day'], where: { campaign: code, day: { gte: since } }, _sum: { visits: true, enquiringVisits: true }, orderBy: { day: 'asc' } })
  const byDay = g.map((r) => ({ day: r.day.toISOString().slice(0, 10), visits: r._sum.visits ?? 0, enquiries: r._sum.enquiringVisits ?? 0 }))
  return { days, visits: byDay.reduce((a, r) => a + r.visits, 0), enquiries: byDay.reduce((a, r) => a + r.enquiries, 0), byDay }
}

export type PartnerDto = Omit<MarketingPartner, 'shopKey'> & { results?: PartnerResults }

const toDto = ({ shopKey: _s, ...p }: MarketingPartner): PartnerDto => (void _s, p)

function parse(o: Record<string, unknown>) {
  const d: { name?: string; kind?: string; phone?: string | null; handle?: string | null; commissionPercent?: number | null; notes?: string | null; status?: string } = {}
  if ('name' in o) d.name = requiredText(o.name, 'name', 120)
  if ('kind' in o) d.kind = oneOf(o.kind, 'kind', PARTNER_KINDS)
  if ('status' in o) d.status = oneOf(o.status, 'status', PARTNER_STATUSES)
  if ('handle' in o) d.handle = text(o.handle, 'handle', 80)
  if ('notes' in o) d.notes = text(o.notes, 'notes', 1000)
  if ('commissionPercent' in o) d.commissionPercent = o.commissionPercent === null || o.commissionPercent === '' ? null : int(o.commissionPercent, 'commissionPercent', 0, 100)
  if ('phone' in o) {
    const raw = text(o.phone, 'phone', 40)
    if (raw === null) d.phone = null
    else {
      const p = normalizePhone(raw)
      if (!p) throw new WebsiteError(400, 'That does not look like a phone number.', { field: 'phone' })
      d.phone = p
    }
  }
  return d
}

async function codeFree(db: Db, code: string, exceptId?: number) {
  const taken = await db.marketingPartner.findFirst({ where: { code, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } })
  const asTag = (await db.marketingPost.findFirst({ where: { trackingTag: code }, select: { id: true } })) ?? (await db.marketingAd.findFirst({ where: { trackingTag: code }, select: { id: true } })) ?? (await db.marketingBroadcast.findFirst({ where: { trackingTag: code }, select: { id: true } }))
  if (taken || asTag) throw new WebsiteError(409, 'That code is already used. Pick another.', { field: 'code' })
}

export async function createPartner(db: Db, body: unknown, actor: string): Promise<PartnerDto> {
  const o = asObject(body)
  onlyKeys(o, ['name', 'kind', 'phone', 'handle', 'code', 'commissionPercent', 'notes', 'status'])
  if (!('name' in o)) throw new WebsiteError(400, 'Give the partner a name.', { field: 'name' })
  if (!('kind' in o)) throw new WebsiteError(400, 'Say what kind of partner this is.', { field: 'kind' })
  const d = parse(o)
  let code = typeof o.code === 'string' && o.code.trim() ? o.code.trim().toLowerCase() : null
  if (code) {
    const p = codeProblem(code)
    if (p) throw new WebsiteError(400, p, { field: 'code' })
  } else {
    for (let i = 0; i < 8 && !code; i++) {
      const c = suggestCode(d.name as string)
      if (!codeProblem(c) && !(await db.marketingPartner.findFirst({ where: { code: c } }))) code = c
    }
    if (!code) throw new WebsiteError(500, 'Could not make a code. Type one in.')
  }
  await codeFree(db, code)
  const row = await db.marketingPartner.create({ data: { ...(d as { name: string; kind: string }), phone: d.phone ?? null, handle: d.handle ?? null, commissionPercent: d.commissionPercent ?? null, notes: d.notes ?? null, status: d.status ?? 'ACTIVE', code, createdBy: actor } })
  await writeAudit(db, { actor, action: 'partner.create', entity: 'partner', entityId: row.id, detail: { kind: row.kind, code } })
  return toDto(row)
}

export async function updatePartner(db: Db, id: number, body: unknown, actor: string): Promise<PartnerDto> {
  const o = asObject(body)
  // The code is the tag on links already shared, so it is fixed once made.
  onlyKeys(o, ['name', 'kind', 'phone', 'handle', 'commissionPercent', 'notes', 'status'])
  const before = await db.marketingPartner.findUnique({ where: { id } })
  if (!before || before.shopKey !== 'vyra') throw new WebsiteError(404, 'Partner not found')
  const d = parse(o)
  if (Object.keys(d).length === 0) throw new WebsiteError(400, 'Nothing to change.')
  const row = await db.marketingPartner.update({ where: { id }, data: d })
  await writeAudit(db, { actor, action: 'partner.update', entity: 'partner', entityId: id, detail: { fields: Object.keys(d) } })
  return toDto(row)
}

export async function listPartners(db: Db, days = 30): Promise<PartnerDto[]> {
  const rows = await db.marketingPartner.findMany({ where: { shopKey: 'vyra' }, orderBy: { id: 'desc' }, take: 300 })
  return Promise.all(rows.map(async (p) => ({ ...toDto(p), results: await partnerResults(db, p.code, days) })))
}

export async function getPartner(db: Db, id: number, days = 30): Promise<PartnerDto> {
  const p = await db.marketingPartner.findUnique({ where: { id } })
  if (!p || p.shopKey !== 'vyra') throw new WebsiteError(404, 'Partner not found')
  return { ...toDto(p), results: await partnerResults(db, p.code, days) }
}

export interface ShareKit {
  link: string | null
  text: string
  imageKeys: string[]
  productName: string | null
}

/**
 * Everything a partner needs: their tracked link (shop home, or one product), words, and the product photos.
 * Words are fixed templates and the product name comes from the Product row: nothing is invented, no prices.
 */
export async function shareKit(db: Db, partnerId: number, opts: { productId?: number | null; host?: string | null } = {}): Promise<ShareKit> {
  const p = await db.marketingPartner.findUnique({ where: { id: partnerId } })
  if (!p || p.shopKey !== 'vyra') throw new WebsiteError(404, 'Partner not found')
  let slug: string | null = null
  let productName: string | null = null
  let imageKeys: string[] = []
  if (opts.productId) {
    const prod = await db.product.findFirst({
      where: { id: opts.productId, published: true },
      select: { productName: true, publicName: true, slug: true, images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], select: { imageKey: true } } },
    })
    if (!prod) throw new WebsiteError(404, 'That product is not published.')
    slug = prod.slug
    productName = prod.publicName || prod.productName
    imageKeys = prod.images.map((i) => i.imageKey).filter((k) => /^products\/[a-f0-9]{32}\.webp$/.test(k)).slice(0, 5)
  }
  const link = buildTrackedLink({ slug, trackingTag: p.code, storefrontHosts: hostRoutingConfigFromEnv().storefrontHosts, host: opts.host })
  const what = productName ? `${productName} from VYRA` : 'the new pieces at VYRA'
  const words = p.kind === 'RESELLER'
    ? `Now available: ${what}.\nMessage me or tap the link to see it and enquire:`
    : `Look at ${what}.\nTap the link to see it and ask about it on WhatsApp:`
  return { link, text: link ? `${words}\n${link}` : words, imageKeys, productName }
}
