// ZP-508: one-time review links (ReviewInvite) and the customer's submit.
// Server only. See docs/storefront/reviews.md.
//
// - createReviewInvite: the OWNER makes a link for a piece (or the shop).
//   32 random bytes; only sha256(token) is stored; valid REVIEW_INVITE_DAYS.
// - readReviewInvite: what the public /review/<token> page shows.
// - setInvitePhoto / clearInvitePhoto: the customer's photo, parked on the
//   open invite (at most REVIEW_PHOTO_MAX_UPLOADS uploads per link). They
//   return the photo they replaced/removed so the caller can delete it.
// - submitReview: single use, enforced ATOMICALLY: one conditional UPDATE
//   (usedAt IS NULL AND expiresAt > now) claims the link; only the request
//   that claimed it creates the Review, in the same transaction. The parked
//   photo moves to the review only with consent; otherwise it is returned
//   as `discardedPhotoKey` for deletion.
import type { Prisma, PrismaClient } from '@prisma/client'
import { isValidImageKey } from '@/lib/storage/keys'
import { compareGalleryImages, displayName as productDisplayName } from '@/lib/storefront-model/rules'
import { publicImageSrc, publicImageSrcSet } from '@/lib/storefront/image-sizes'
import { REVIEW_INVITE_DAYS, REVIEW_PHOTO_MAX_UPLOADS, containsProfanity, type ValidReview } from './rules'
import { generateReviewToken, hashReviewToken, isWellFormedReviewToken, sameTokenHash } from './token'

type Db = PrismaClient | Prisma.TransactionClient

const DAY_MS = 86_400_000

function inTransaction<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return '$transaction' in db ? db.$transaction(fn) : fn(db)
}

export type CreatedInvite = { token: string; inviteId: number; expiresAt: Date; productName: string | null }

/** Throws "Product not found" for an unknown product id. */
export async function createReviewInvite(
  db: Db,
  input: { productId: number | null; customerHint?: string | null; createdBy: string; now?: Date },
): Promise<CreatedInvite> {
  const now = input.now ?? new Date()
  let productName: string | null = null
  if (input.productId !== null) {
    const product = await db.product.findUnique({
      where: { id: input.productId },
      select: { productName: true, publicName: true },
    })
    if (!product) throw new Error('Product not found')
    productName = productDisplayName(product)
  }
  const { token, hash } = generateReviewToken()
  const expiresAt = new Date(now.getTime() + REVIEW_INVITE_DAYS * DAY_MS)
  const row = await db.reviewInvite.create({
    data: {
      tokenHash: hash,
      shopOnly: input.productId === null,
      productId: input.productId,
      customerHint: input.customerHint ?? null,
      expiresAt,
      createdBy: input.createdBy,
      createdAt: now,
    },
    select: { id: true },
  })
  return { token, inviteId: row.id, expiresAt, productName }
}

export type InvitePiece = {
  name: string
  /** The piece's main photo, only when the piece is public (else null). */
  image: { url: string; srcSet: string; alt: string } | null
}

export type InviteState =
  | { state: 'invalid' }
  | { state: 'expired' }
  | { state: 'used' }
  | {
      state: 'open'
      inviteId: number
      /** null = shop-only link. */
      product: InvitePiece | null
      customerHint: string | null
      hasPhoto: boolean
      /** Photo uploads this link may still make. */
      photoUploadsLeft: number
    }

const INVITE_SELECT = {
  id: true,
  tokenHash: true,
  shopOnly: true,
  productId: true,
  customerHint: true,
  expiresAt: true,
  usedAt: true,
  photoKey: true,
  photoUploads: true,
  product: {
    select: {
      productName: true,
      publicName: true,
      published: true,
      slug: true,
      category: { select: { published: true } },
      images: { select: { id: true, imageKey: true, alt: true, isPrimary: true, sortOrder: true } },
    },
  },
} satisfies Prisma.ReviewInviteSelect

type InviteRow = Prisma.ReviewInviteGetPayload<{ select: typeof INVITE_SELECT }>

async function findInvite(db: Db, token: unknown): Promise<InviteRow | null> {
  if (!isWellFormedReviewToken(token)) return null
  const hash = hashReviewToken(token)
  const row = await db.reviewInvite.findUnique({ where: { tokenHash: hash }, select: INVITE_SELECT })
  // The lookup is by the unique hash; compare again in constant time.
  return row && sameTokenHash(row.tokenHash, hash) ? row : null
}

function stateOf(row: Pick<InviteRow, 'usedAt' | 'expiresAt' | 'shopOnly' | 'productId'> | null, now: Date): 'invalid' | 'expired' | 'used' | 'open' {
  if (!row) return 'invalid'
  if (row.usedAt) return 'used'
  // A piece link whose product was deleted (productId set to null) no longer works.
  if (!row.shopOnly && row.productId === null) return 'invalid'
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'open'
}

function piece(row: InviteRow): InvitePiece | null {
  const p = row.product
  if (!p) return null
  const name = productDisplayName(p)
  const isPublic = p.published && !!p.slug && !!p.category?.published
  const main = [...p.images].sort(compareGalleryImages).find((i) => isValidImageKey(i.imageKey))
  return {
    name,
    image: isPublic && main ? { url: publicImageSrc(main.imageKey), srcSet: publicImageSrcSet(main.imageKey), alt: main.alt?.trim() || name } : null,
  }
}

export async function readReviewInvite(db: Db, token: unknown, now: Date = new Date()): Promise<InviteState> {
  const row = await findInvite(db, token)
  const state = stateOf(row, now)
  if (state !== 'open' || !row) return { state } as InviteState
  return {
    state: 'open',
    inviteId: row.id,
    product: row.shopOnly ? null : piece(row),
    customerHint: row.customerHint,
    hasPhoto: !!row.photoKey,
    photoUploadsLeft: Math.max(0, REVIEW_PHOTO_MAX_UPLOADS - row.photoUploads),
  }
}

export type PhotoChange =
  | { ok: true; previousKey: string | null }
  | { ok: false; reason: 'closed' | 'shop-only' | 'limit' }

/** Lock the invite row for this transaction and return it (or null). */
async function lockInvite(tx: Prisma.TransactionClient, tokenHash: string) {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "ReviewInvite" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`
  if (rows.length === 0) return null
  return tx.reviewInvite.findUnique({ where: { id: rows[0].id }, select: INVITE_SELECT })
}

/**
 * Park an uploaded (already processed and stored) photo on an OPEN piece
 * invite, replacing any earlier one, at most REVIEW_PHOTO_MAX_UPLOADS times.
 * Returns the replaced key (to delete once nothing references it).
 */
export function setInvitePhoto(db: Db, token: unknown, photoKey: string, now: Date = new Date()): Promise<PhotoChange> {
  if (!isWellFormedReviewToken(token) || !isValidImageKey(photoKey)) return Promise.resolve({ ok: false, reason: 'closed' })
  const tokenHash = hashReviewToken(token)
  return inTransaction(db, async (tx) => {
    const row = await lockInvite(tx, tokenHash)
    if (stateOf(row, now) !== 'open' || !row) return { ok: false, reason: 'closed' }
    if (row.shopOnly) return { ok: false, reason: 'shop-only' }
    if (row.photoUploads >= REVIEW_PHOTO_MAX_UPLOADS) return { ok: false, reason: 'limit' }
    await tx.reviewInvite.update({ where: { id: row.id }, data: { photoKey, photoUploads: { increment: 1 } } })
    return { ok: true, previousKey: row.photoKey && row.photoKey !== photoKey ? row.photoKey : null }
  })
}

/** The customer removed the photo in the form. Returns the removed key. */
export function clearInvitePhoto(db: Db, token: unknown, now: Date = new Date()): Promise<PhotoChange> {
  if (!isWellFormedReviewToken(token)) return Promise.resolve({ ok: false, reason: 'closed' })
  const tokenHash = hashReviewToken(token)
  return inTransaction(db, async (tx) => {
    const row = await lockInvite(tx, tokenHash)
    if (stateOf(row, now) !== 'open' || !row) return { ok: false, reason: 'closed' }
    if (row.photoKey) await tx.reviewInvite.update({ where: { id: row.id }, data: { photoKey: null } })
    return { ok: true, previousKey: row.photoKey }
  })
}

export type SubmitResult =
  | { ok: true; reviewId: number; discardedPhotoKey: string | null }
  | { ok: false; state: 'invalid' | 'expired' | 'used' }

/**
 * Create the review for an open link, exactly once. `value` comes from
 * validateReviewSubmission. A shop-only link never stores shop stars or a
 * photo. The parked photo is attached only when the customer chose it AND
 * consented; otherwise it is detached and returned for deletion. The review
 * starts PENDING; `flagged` marks a word-list match.
 */
export function submitReview(db: Db, token: unknown, value: ValidReview, now: Date = new Date()): Promise<SubmitResult> {
  if (!isWellFormedReviewToken(token)) return Promise.resolve({ ok: false, state: 'invalid' })
  const tokenHash = hashReviewToken(token)
  return inTransaction(db, async (tx) => {
    const claimed = await tx.reviewInvite.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now }, OR: [{ shopOnly: true }, { productId: { not: null } }] },
      data: { usedAt: now },
    })
    if (claimed.count !== 1) {
      const row = await tx.reviewInvite.findUnique({ where: { tokenHash }, select: INVITE_SELECT })
      const state = stateOf(row, now)
      // Lost a race to a concurrent submit of the same link: it is used now.
      return { ok: false, state: state === 'open' ? 'used' : state }
    }
    const invite = await tx.reviewInvite.findUniqueOrThrow({
      where: { tokenHash },
      select: { id: true, shopOnly: true, productId: true, photoKey: true },
    })
    const parked = invite.photoKey && isValidImageKey(invite.photoKey) ? invite.photoKey : null
    const keep = !invite.shopOnly && value.photo && value.photoConsent ? parked : null
    if (invite.photoKey) await tx.reviewInvite.update({ where: { id: invite.id }, data: { photoKey: null } })
    const review = await tx.review.create({
      data: {
        inviteId: invite.id,
        shopOnly: invite.shopOnly,
        productId: invite.shopOnly ? null : invite.productId,
        stars: value.stars,
        shopStars: invite.shopOnly ? null : value.shopStars,
        comment: value.comment,
        displayName: value.displayName,
        photoKey: keep,
        photoConsent: keep !== null,
        flagged: containsProfanity(`${value.comment} ${value.displayName}`),
        createdAt: now,
      },
      select: { id: true },
    })
    return { ok: true, reviewId: review.id, discardedPhotoKey: keep === null ? parked : null }
  })
}
