// VYRA Marketing hub (ZP-1200): ad audiences (a subset of Meta's targeting). Server only.
import type { MarketingAudience, Prisma } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { asObject, int, onlyKeys, oneOf, requiredText, text } from './validate'

export const AUDIENCE_KINDS = ['AD_TARGETING', 'CONTACT_LIST'] as const
export const GENDERS = ['MALE', 'FEMALE'] as const

export interface TargetingSpec {
  geo: { lat: number; lng: number; radiusKm: number }
  ageMin: number
  ageMax: number
  /** One gender, or empty / both for everyone. */
  genders: ('MALE' | 'FEMALE')[]
  interests: { id: string; name: string }[]
}

/** Harare, 25 km, adults 18 to 65. */
export const DEFAULT_TARGETING: TargetingSpec = { geo: { lat: -17.8292, lng: 31.0522, radiusKm: 25 }, ageMin: 18, ageMax: 65, genders: [], interests: [] }

const bad = (m: string, field: string) => new WebsiteError(400, m, { field })

function num(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw bad(`${field} must be a number from ${min} to ${max}.`, field)
  return v
}

/** Validate a targeting object, filling the defaults (Harare). */
export function parseTargeting(v: unknown): TargetingSpec {
  if (v === null || v === undefined) return structuredClone(DEFAULT_TARGETING)
  const o = asObject(v)
  onlyKeys(o, ['geo', 'ageMin', 'ageMax', 'genders', 'interests'])
  const geoIn = o.geo === undefined ? DEFAULT_TARGETING.geo : asObject(o.geo)
  if (o.geo !== undefined) onlyKeys(geoIn as Record<string, unknown>, ['lat', 'lng', 'radiusKm'])
  const g = geoIn as Record<string, unknown>
  const geo = {
    lat: 'lat' in g ? num(g.lat, 'geo.lat', -90, 90) : DEFAULT_TARGETING.geo.lat,
    lng: 'lng' in g ? num(g.lng, 'geo.lng', -180, 180) : DEFAULT_TARGETING.geo.lng,
    // Meta allows 1 to 80 km around a custom location.
    radiusKm: 'radiusKm' in g ? num(g.radiusKm, 'geo.radiusKm', 1, 80) : DEFAULT_TARGETING.geo.radiusKm,
  }
  const ageMin = 'ageMin' in o ? int(o.ageMin, 'ageMin', 13, 65) : DEFAULT_TARGETING.ageMin
  const ageMax = 'ageMax' in o ? int(o.ageMax, 'ageMax', 13, 65) : DEFAULT_TARGETING.ageMax
  if (ageMin > ageMax) throw bad('The youngest age cannot be above the oldest age.', 'ageMin')
  let genders: ('MALE' | 'FEMALE')[] = []
  if ('genders' in o) {
    if (!Array.isArray(o.genders) || o.genders.length > 2) throw bad('genders must be a list of MALE and/or FEMALE.', 'genders')
    genders = [...new Set(o.genders.map((x) => oneOf(x, 'genders', GENDERS)))]
  }
  let interests: { id: string; name: string }[] = []
  if ('interests' in o) {
    if (!Array.isArray(o.interests) || o.interests.length > 25) throw bad('interests must be a list of at most 25 interests.', 'interests')
    interests = o.interests.map((i) => {
      const io = asObject(i)
      onlyKeys(io, ['id', 'name'])
      const id = typeof io.id === 'number' ? String(io.id) : io.id
      if (typeof id !== 'string' || !/^\d{3,20}$/.test(id)) throw bad('An interest needs a numeric Meta interest id.', 'interests')
      return { id, name: requiredText(io.name, 'interests.name', 100) }
    })
  }
  return { geo, ageMin, ageMax, genders, interests }
}

/** Read a stored targeting JSON back into a spec (defaults when missing or damaged). */
export function readTargeting(v: unknown): TargetingSpec {
  try {
    return parseTargeting(v)
  } catch {
    return structuredClone(DEFAULT_TARGETING)
  }
}

export const listAudiences = (db: Db) => db.marketingAudience.findMany({ orderBy: { id: 'desc' }, take: 300 })
export const getAudience = (db: Db, id: number) => db.marketingAudience.findUnique({ where: { id } })

export async function createAudience(db: Db, body: unknown, actor: string): Promise<MarketingAudience> {
  const o = asObject(body)
  onlyKeys(o, ['name', 'description', 'kind', 'targeting'])
  const kind = 'kind' in o ? oneOf(o.kind, 'kind', AUDIENCE_KINDS) : 'AD_TARGETING'
  const row = await db.marketingAudience.create({
    data: {
      name: requiredText(o.name, 'name', 120),
      description: text(o.description, 'description', 500),
      kind,
      targeting: kind === 'AD_TARGETING' ? (parseTargeting(o.targeting) as unknown as Prisma.InputJsonValue) : undefined,
      createdBy: actor,
    },
  })
  await writeAudit(db, { actor, action: 'audience.create', entity: 'audience', entityId: row.id, detail: { name: row.name, kind } })
  return row
}

export async function updateAudience(db: Db, id: number, body: unknown, actor: string): Promise<MarketingAudience> {
  const o = asObject(body)
  onlyKeys(o, ['name', 'description', 'targeting'])
  const existing = await db.marketingAudience.findUnique({ where: { id } })
  if (!existing) throw new WebsiteError(404, 'Audience not found')
  const data: Prisma.MarketingAudienceUpdateInput = {}
  if ('name' in o) data.name = requiredText(o.name, 'name', 120)
  if ('description' in o) data.description = text(o.description, 'description', 500)
  if ('targeting' in o) {
    if (existing.kind !== 'AD_TARGETING') throw new WebsiteError(409, 'Only an ad targeting audience has targeting.')
    data.targeting = parseTargeting(o.targeting) as unknown as Prisma.InputJsonValue
  }
  if (Object.keys(data).length === 0) throw new WebsiteError(400, 'Nothing to change.')
  const row = await db.marketingAudience.update({ where: { id }, data })
  if ('targeting' in o) {
    // Approval is for the exact audience: ads not yet on Meta go back to a draft. Ads already on Meta keep their targeting.
    await db.marketingAd.updateMany({
      where: { audienceId: id, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      data: { status: 'DRAFT', approvedBy: null, approvedAt: null },
    })
  }
  await writeAudit(db, { actor, action: 'audience.update', entity: 'audience', entityId: id, detail: { fields: Object.keys(data) } as Prisma.InputJsonValue })
  return row
}

export async function deleteAudience(db: Db, id: number, actor: string): Promise<void> {
  const existing = await db.marketingAudience.findUnique({ where: { id } })
  if (!existing) throw new WebsiteError(404, 'Audience not found')
  await db.marketingAudience.delete({ where: { id } }) // ads keep running: audienceId becomes null
  await writeAudit(db, { actor, action: 'audience.delete', entity: 'audience', entityId: id, detail: { name: existing.name } })
}
