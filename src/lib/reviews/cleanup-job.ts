// ZP-508: the nightly review-photo sweep as a job step. Server only.
// Run by `npm run reviews:cleanup` and at the end of the nightly analytics
// rollup job (scripts/analytics-rollup.ts), so no extra scheduler is needed.
import type { PrismaClient } from '@prisma/client'
import { getImageStorage } from '@/lib/storage/images'
import { cleanupReviewPhotos, type PhotoCleanupResult } from './photos'

export type CleanupJobResult = ({ ran: true } & PhotoCleanupResult) | { ran: false; reason: string }

/**
 * Refuses to run in production without GRACE_IMAGE_STORAGE set: the default
 * local driver would "delete" nothing while clearing the references to the
 * real (GCS) files, leaving them orphaned forever.
 */
export async function runReviewPhotoCleanup(
  db: PrismaClient,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): Promise<CleanupJobResult> {
  if (env.NODE_ENV === 'production' && !env.GRACE_IMAGE_STORAGE?.trim()) {
    return { ran: false, reason: 'GRACE_IMAGE_STORAGE is not set; review photo cleanup skipped' }
  }
  const result = await cleanupReviewPhotos(db, getImageStorage(env), now)
  return { ran: true, ...result }
}
