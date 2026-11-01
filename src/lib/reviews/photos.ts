// ZP-508: customer review photos are deleted when nothing needs them.
// Server only. See docs/storefront/reviews.md ("Photo lifecycle").
//
// Stored pictures are content-hashed ("products/<hash>.webp") and SHARED:
// the same bytes uploaded as a product photo, a category hero, a settings
// picture or another review get the same key. A review photo is therefore
// only deleted from storage when, AFTER its own reference was cleared, no
// ProductImage, Product.imageUrl, Category hero, current site-settings
// picture, Review or ReviewInvite references the key any more.
//
// Deleted:
// - when the customer removes the photo in the form (DELETE /api/public/reviews/photo),
// - when a new upload replaces it,
// - when the review is sent without the photo or WITHOUT consent,
// - when the owner deletes the review,
// - nightly (cleanupReviewPhotos, run after the analytics rollup job): photos
//   of links that expired unused, and any review photo without consent.
import type { Prisma, PrismaClient } from '@prisma/client'
import { isSettingsImageKey } from '@/lib/site-settings/db'
import { imageUrlForKey, isValidImageKey, type ImageStorage } from '@/lib/storage/keys'

type Db = PrismaClient | Prisma.TransactionClient

/** True while anything in the database still references the stored picture. */
export async function isImageKeyReferenced(db: Db, key: string): Promise<boolean> {
  if (!isValidImageKey(key)) return false
  const [image, product, category, settings, review, invite] = await Promise.all([
    db.productImage.findFirst({ where: { imageKey: key }, select: { id: true } }),
    db.product.findFirst({ where: { imageUrl: imageUrlForKey(key) }, select: { id: true } }),
    db.category.findFirst({ where: { heroImageKey: key }, select: { id: true } }),
    isSettingsImageKey(db, key),
    db.review.findFirst({ where: { photoKey: key }, select: { id: true } }),
    db.reviewInvite.findFirst({ where: { photoKey: key }, select: { id: true } }),
  ])
  return !!(image || product || category || settings || review || invite)
}

/**
 * Delete the bytes of `key` unless something still references it. Call it
 * AFTER the reference was removed (committed). Never throws: a failure is
 * logged and the nightly sweep cannot retry it (the reference is gone), so
 * it returns false and the caller may report it.
 */
export async function deletePhotoIfUnreferenced(db: Db, storage: ImageStorage, key: string | null | undefined): Promise<boolean> {
  if (!key || !isValidImageKey(key)) return false
  try {
    if (await isImageKeyReferenced(db, key)) return false
    await storage.delete(key)
    return true
  } catch (error) {
    console.error('[reviews] photo delete failed:', error instanceof Error ? error.message : error)
    return false
  }
}

export type PhotoCleanupResult = { invites: number; reviews: number; deleted: number }

/**
 * Nightly sweep: clear and delete photos of review links that expired (or
 * were used) with a photo still parked on them, and photos of reviews that
 * have no consent. Idempotent.
 */
export async function cleanupReviewPhotos(db: PrismaClient, storage: ImageStorage, now: Date = new Date()): Promise<PhotoCleanupResult> {
  const keys = new Set<string>()
  const invites = await db.reviewInvite.findMany({
    where: { photoKey: { not: null }, OR: [{ expiresAt: { lte: now } }, { usedAt: { not: null } }] },
    select: { id: true, photoKey: true },
  })
  for (const inv of invites) {
    // Only clear it if it is still the same photo (a concurrent upload wins).
    const r = await db.reviewInvite.updateMany({ where: { id: inv.id, photoKey: inv.photoKey }, data: { photoKey: null } })
    if (r.count === 1 && inv.photoKey) keys.add(inv.photoKey)
  }
  const reviews = await db.review.findMany({
    where: { photoKey: { not: null }, photoConsent: false },
    select: { id: true, photoKey: true },
  })
  for (const rev of reviews) {
    const r = await db.review.updateMany({ where: { id: rev.id, photoKey: rev.photoKey, photoConsent: false }, data: { photoKey: null } })
    if (r.count === 1 && rev.photoKey) keys.add(rev.photoKey)
  }
  let deleted = 0
  for (const key of keys) if (await deletePhotoIfUnreferenced(db, storage, key)) deleted += 1
  return { invites: invites.length, reviews: reviews.length, deleted }
}
