// AI capture: the "house model" photo (one fictional woman, uploaded once by the owner).
// Server only. The key lives on SiteSettings row 1 and is never part of the public settings.
import type { PrismaClient } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { getImageStorage, ImageRejectedError, imageUrlForKey, saveProductImage, type ImageStorage } from '@/lib/storage/images'

const SETTINGS_ID = 1

export async function getHouseModelKey(db: PrismaClient): Promise<string | null> {
  const row = await db.siteSettings.findUnique({ where: { id: SETTINGS_ID }, select: { captureHouseModelKey: true } })
  return row?.captureHouseModelKey ?? null
}

export async function getHouseModel(db: PrismaClient): Promise<{ url: string | null }> {
  const key = await getHouseModelKey(db)
  return { url: key ? imageUrlForKey(key) : null }
}

export async function setHouseModel(
  db: PrismaClient,
  bytes: Uint8Array,
  storage: ImageStorage = getImageStorage(),
): Promise<{ url: string }> {
  let key: string
  try {
    key = (await saveProductImage(bytes, storage)).key
  } catch (error) {
    if (error instanceof ImageRejectedError) throw new WebsiteError(400, error.message)
    throw error
  }
  await db.siteSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, captureHouseModelKey: key },
    update: { captureHouseModelKey: key },
  })
  return { url: imageUrlForKey(key) }
}

export async function clearHouseModel(db: PrismaClient): Promise<void> {
  await db.siteSettings.updateMany({ where: { id: SETTINGS_ID }, data: { captureHouseModelKey: null } })
}
