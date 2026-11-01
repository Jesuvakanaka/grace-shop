// ZP-486: reading and writing the single SiteSettings row (server only).
import { Prisma, type PrismaClient, type SiteSettings } from '@prisma/client'
import { EDITABLE_FIELDS, SITE_SETTINGS_DEFAULTS, type SiteSettingsData } from './schema'
import { validateOpeningHours } from './validate'
import { settingsImageKeys } from './dto'
import { readSizeChart } from '@/lib/storefront-model/size-chart'

export const SITE_SETTINGS_ID = 1

type Db = PrismaClient | Prisma.TransactionClient

/** The editable fields of a row. Stored hours that no longer validate read as "not set". */
export function rowToSiteSettings(row: SiteSettings | null): SiteSettingsData {
  if (!row) return { ...SITE_SETTINGS_DEFAULTS }
  const out = {} as Record<string, unknown>
  for (const f of EDITABLE_FIELDS) out[f] = row[f]
  const hours = row.openingHours === null ? null : validateOpeningHours(row.openingHours)
  out.openingHours = hours && hours.ok ? hours.value : null
  // ZP-513: a stored chart that no longer validates reads as "none".
  out.defaultSizeChart = readSizeChart(row.defaultSizeChart)
  return out as SiteSettingsData
}

/** Current settings; the defaults when the row is missing (the migration seeds it). */
export async function readSiteSettings(db: Db): Promise<SiteSettingsData> {
  return rowToSiteSettings(await db.siteSettings.findUnique({ where: { id: SITE_SETTINGS_ID } }))
}

/** True when `key` is one of the CURRENT settings pictures (settingsImageKeys). Uncached. */
export async function isSettingsImageKey(db: Db, key: string): Promise<boolean> {
  return settingsImageKeys(await readSiteSettings(db)).includes(key)
}

/** The "few left" threshold the storefront uses; the default when the row is missing. */
export async function readFewLeftThreshold(db: Db): Promise<number> {
  const row = await db.siteSettings.findUnique({ where: { id: SITE_SETTINGS_ID }, select: { fewLeftThreshold: true } })
  return row?.fewLeftThreshold ?? SITE_SETTINGS_DEFAULTS.fewLeftThreshold
}

function toColumns(patch: Partial<SiteSettingsData>) {
  const { openingHours, defaultSizeChart, ...rest } = patch
  return {
    ...rest,
    ...(openingHours === undefined
      ? {}
      : { openingHours: openingHours === null ? Prisma.DbNull : (openingHours as Prisma.InputJsonObject) }),
    ...(defaultSizeChart === undefined
      ? {}
      : { defaultSizeChart: defaultSizeChart === null ? Prisma.DbNull : (defaultSizeChart as Prisma.InputJsonArray) }),
  }
}

/**
 * Apply an already validated partial update (validateSiteSettingsInput) and
 * return the full settings. Creates the row from the defaults if it is missing.
 */
export async function updateSiteSettings(
  db: Db,
  patch: Partial<SiteSettingsData>,
  updatedBy: string,
): Promise<SiteSettingsData> {
  const data = { ...toColumns(patch), updatedBy }
  const row = await db.siteSettings.upsert({
    where: { id: SITE_SETTINGS_ID },
    create: { id: SITE_SETTINGS_ID, ...data },
    update: data,
  })
  return rowToSiteSettings(row)
}
