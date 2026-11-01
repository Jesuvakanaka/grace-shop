// ZP-508: schema.org Product JSON-LD with AggregateRating and Review, for
// the product page only and only from genuine APPROVED reviews (the public
// reviews index). No reviews -> null (no rating markup at all). Pure.
import type { PublicReview } from '@/lib/storefront/dto'
import type { RatingSummary } from './aggregate'

/** Reviews included as individual Review items (the aggregate covers all). */
export const JSON_LD_MAX_REVIEWS = 5

export function productReviewsJsonLd(input: {
  name: string
  url: string | null
  image: string | null
  summary: RatingSummary | null
  reviews: readonly PublicReview[]
}): Record<string, unknown> | null {
  if (!input.summary || input.summary.count < 1 || input.reviews.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    ...(input.url ? { url: input.url } : {}),
    ...(input.image ? { image: input.image } : {}),
    brand: { '@type': 'Brand', name: 'VYRA' },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: input.summary.average,
      reviewCount: input.summary.count,
      bestRating: 5,
      worstRating: 1,
    },
    review: input.reviews.slice(0, JSON_LD_MAX_REVIEWS).map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r.name },
      datePublished: r.date.slice(0, 10),
      reviewBody: r.comment,
      reviewRating: { '@type': 'Rating', ratingValue: r.stars, bestRating: 5, worstRating: 1 },
    })),
  }
}

/** JSON for a <script type="application/ld+json">: "<" escaped so text can never close the tag. */
export function jsonLdScript(data: Record<string, unknown>): string {
  // Also escape U+2028/U+2029 (line terminators for older JS parsers).
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
