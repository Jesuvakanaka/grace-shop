// ZP-508: the owner's review queue and moderation. Server only.
// Routes: src/app/api/website/reviews/** (OWNER_ONLY). There is no way to
// create or edit a review's stars, comment or name here: the owner can only
// approve, hide (with a private note), unpublish, reply or delete.
import type { Prisma, PrismaClient } from '@prisma/client'
import { imageUrlForKey, isValidImageKey } from '@/lib/storage/keys'
import { displayName as productDisplayName } from '@/lib/storefront-model/rules'
import { containsProfanity, type ModerationAction, type ReviewStatus } from './rules'

type Db = PrismaClient | Prisma.TransactionClient

/** One review as the owner sees it (admin only; never sent to the storefront). */
export type OwnerReview = {
  id: number
  status: ReviewStatus
  stars: number
  shopStars: number | null
  comment: string
  displayName: string
  /** Signed-in admin URL of the photo (/api/images/<hash>.webp), or null. */
  photoUrl: string | null
  photoConsent: boolean
  /** Word-list match (comment or name). */
  flagged: boolean
  ownerReply: string | null
  privateNote: string | null
  /** A shop-only review (no piece). */
  shopOnly: boolean
  /** null for a shop-only review, or after the piece was deleted. */
  productId: number | null
  productName: string | null
  productSlug: string | null
  createdAt: string
  approvedAt: string | null
  moderatedBy: string | null
}

const OWNER_SELECT = {
  id: true,
  status: true,
  stars: true,
  shopStars: true,
  comment: true,
  displayName: true,
  photoKey: true,
  photoConsent: true,
  flagged: true,
  ownerReply: true,
  privateNote: true,
  shopOnly: true,
  productId: true,
  createdAt: true,
  approvedAt: true,
  moderatedBy: true,
  product: { select: { productName: true, publicName: true, slug: true } },
} satisfies Prisma.ReviewSelect

type OwnerRow = Prisma.ReviewGetPayload<{ select: typeof OWNER_SELECT }>

function toOwnerReview(r: OwnerRow): OwnerReview {
  return {
    id: r.id,
    status: r.status,
    stars: r.stars,
    shopStars: r.shopStars,
    comment: r.comment,
    displayName: r.displayName,
    photoUrl: r.photoKey && isValidImageKey(r.photoKey) ? imageUrlForKey(r.photoKey) : null,
    photoConsent: r.photoConsent,
    // Stored at submit; recomputed so a longer word list also flags older reviews.
    flagged: r.flagged || containsProfanity(`${r.comment} ${r.displayName}`),
    ownerReply: r.ownerReply,
    privateNote: r.privateNote,
    shopOnly: r.shopOnly,
    productId: r.productId,
    productName: r.product ? productDisplayName(r.product) : null,
    productSlug: r.product?.slug ?? null,
    createdAt: r.createdAt.toISOString(),
    approvedAt: r.approvedAt?.toISOString() ?? null,
    moderatedBy: r.moderatedBy,
  }
}

const STATUS_RANK: Record<ReviewStatus, number> = { PENDING: 0, APPROVED: 1, HIDDEN: 2 }

/** The queue: pending first, then approved, then hidden; newest first inside each. At most `limit`. */
export async function listOwnerReviews(db: Db, options: { status?: ReviewStatus; limit?: number } = {}): Promise<OwnerReview[]> {
  const rows = await db.review.findMany({
    where: options.status ? { status: options.status } : undefined,
    select: OWNER_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(500, Math.max(1, options.limit ?? 200)),
  })
  return rows.map(toOwnerReview).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
}

export function countPendingReviews(db: Db): Promise<number> {
  return db.review.count({ where: { status: 'PENDING' } })
}

/** Apply a moderation action. Null when the review does not exist. */
export async function moderateReview(
  db: Db,
  id: number,
  action: ModerationAction,
  by: string,
  now: Date = new Date(),
): Promise<OwnerReview | null> {
  const existing = await db.review.findUnique({ where: { id }, select: { id: true, status: true, approvedAt: true } })
  if (!existing) return null
  let data: Prisma.ReviewUpdateInput
  switch (action.type) {
    case 'approve':
      data = { status: 'APPROVED', approvedAt: existing.approvedAt ?? now, moderatedBy: by }
      break
    case 'hide':
      data = { status: 'HIDDEN', privateNote: action.note, moderatedBy: by }
      break
    case 'unpublish':
      data = existing.status === 'APPROVED' ? { status: 'PENDING', moderatedBy: by } : { moderatedBy: by }
      break
    case 'reply':
      data = { ownerReply: action.reply, ownerReplyAt: action.reply ? now : null, moderatedBy: by }
      break
  }
  const row = await db.review.update({ where: { id }, data, select: OWNER_SELECT })
  return toOwnerReview(row)
}

/**
 * Delete a review for good. Null when it did not exist; else the photo key it
 * had (the caller deletes the file once nothing references it). The link stays used.
 */
export async function deleteReview(db: Db, id: number): Promise<{ photoKey: string | null } | null> {
  const row = await db.review.findUnique({ where: { id }, select: { photoKey: true } })
  if (!row) return null
  const r = await db.review.deleteMany({ where: { id } })
  return r.count === 1 ? { photoKey: row.photoKey } : null
}
