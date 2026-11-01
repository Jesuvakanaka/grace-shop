// ZP-508: public reviews for the storefront. Server only.
//
// ONE read, cached as one entry next to the catalogue (./cached, tag
// `storefront:reviews`): every APPROVED review, turned into allow-listed DTOs
// (./dto toPublicReview) and aggregates.
// - Piece lists and piece ratings: only for pieces that are public now.
// - The shop rating (owner decision): ALL approved shop stars, whether the
//   piece is still published or even still exists (Review.productId is SET
//   NULL when a product is deleted; shopOnly tells the two apart).
// The admin's approve / hide / unpublish / reply / delete expire the tag.
// Nothing that is not APPROVED is ever read here, and buildReviewsIndex
// drops it again if it were. See docs/storefront/reviews.md.
import type { Prisma } from '@prisma/client'
import type { Db } from '@/lib/storefront-model/db'
import { shopRatingStars, sortReviewsForDisplay, summarizeStars, type RatingSummary } from '@/lib/reviews/aggregate'
import { toPublicReview, type PublicReview, type PublicReviewRow } from './dto'

if (typeof window !== 'undefined') throw new Error('src/lib/storefront is server-only')

/** Most reviews kept per piece (with photo first, then newest); the page shows 5 at a time. */
export const MAX_REVIEWS_PER_PIECE = 100

export type PieceReviews = { summary: RatingSummary; reviews: PublicReview[] }

/** Plain JSON (cacheable). Keys are product slugs. Only public pieces with at least one approved review. */
export type PublicReviewsIndex = {
  shop: RatingSummary | null
  products: Record<string, PieceReviews>
}

export type ReviewIndexRow = PublicReviewRow & {
  /** The piece, with whether it is public right now; null for shop-only or a deleted piece. */
  product: { slug: string | null; name: string; isPublic: boolean } | null
}

export function buildReviewsIndex(rows: readonly ReviewIndexRow[]): PublicReviewsIndex {
  const approved = rows.filter((r) => r.status === 'APPROVED')
  const byPiece = new Map<string, { stars: number[]; reviews: PublicReview[] }>()
  for (const row of approved) {
    if (row.shopOnly || !row.product?.isPublic || !row.product.slug) continue
    const dto = toPublicReview(row, row.product.name)
    if (!dto) continue
    const entry = byPiece.get(row.product.slug) ?? { stars: [], reviews: [] }
    entry.stars.push(row.stars)
    entry.reviews.push(dto)
    byPiece.set(row.product.slug, entry)
  }
  const products: Record<string, PieceReviews> = {}
  for (const [slug, entry] of byPiece) {
    const summary = summarizeStars(entry.stars)
    if (!summary) continue
    products[slug] = { summary, reviews: sortReviewsForDisplay(entry.reviews).slice(0, MAX_REVIEWS_PER_PIECE) }
  }
  return { shop: summarizeStars(shopRatingStars(approved)), products }
}

const REVIEW_SELECT = {
  id: true,
  inviteId: true,
  shopOnly: true,
  productId: true,
  stars: true,
  shopStars: true,
  comment: true,
  displayName: true,
  photoKey: true,
  photoConsent: true,
  status: true,
  flagged: true,
  ownerReply: true,
  privateNote: true,
  moderatedBy: true,
  createdAt: true,
  approvedAt: true,
  product: {
    select: { slug: true, productName: true, publicName: true, published: true, category: { select: { published: true } } },
  },
} satisfies Prisma.ReviewSelect

/** Every approved review (uncached). Piece visibility is decided in buildReviewsIndex. */
export async function loadPublicReviews(db: Db): Promise<PublicReviewsIndex> {
  const rows = await db.review.findMany({
    where: { status: 'APPROVED' },
    select: REVIEW_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  return buildReviewsIndex(
    rows.map(({ product, ...row }) => ({
      ...row,
      product: product
        ? {
            slug: product.slug,
            name: product.publicName?.trim() || product.productName,
            // Same rule as PUBLIC_PRODUCT_WHERE (./queries).
            isPublic: product.published && !!product.slug && !!product.category?.published,
          }
        : null,
    })),
  )
}
