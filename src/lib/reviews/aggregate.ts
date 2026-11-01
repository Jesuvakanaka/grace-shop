// ZP-508: rating aggregates and their wording. Pure; client and server.
// Nothing here ever produces "0 reviews": no reviews means null, and the
// caller hides the block.

export type RatingSummary = {
  /** Rounded to one decimal. */
  average: number
  count: number
}

/** Average (one decimal) and count of 1-5 star values; null when there are none. */
export function summarizeStars(stars: readonly number[]): RatingSummary | null {
  if (stars.length === 0) return null
  const sum = stars.reduce((t, s) => t + s, 0)
  return { average: Math.round((sum / stars.length) * 10) / 10, count: stars.length }
}

/**
 * The stars that make up the SHOP rating (ZP-508 spec + owner decision):
 * exactly ONE rating per approved review, its shop stars when given,
 * otherwise its stars (a piece review's piece stars; a shop-only review's
 * stars are the shop rating). Every approved review counts, whether or not
 * the piece is still published or still exists, so "N verified customers" is
 * the number of approved reviews. Pass approved reviews only.
 */
export function shopRatingStars(reviews: readonly { stars: number; shopStars: number | null }[]): number[] {
  return reviews.map((r) => r.shopStars ?? r.stars)
}

const one = (n: number) => n.toFixed(1)

/**
 * "★★★★☆": full stars for the WHOLE part of the value (4.5 and 4.8 show four),
 * so the picture never claims more than the number next to it says.
 */
export function starsText(value: number): string {
  const full = Math.min(5, Math.max(0, Math.floor(value + 1e-9)))
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

/** Feed caption: "★ 4.8 (12)". */
export function feedRatingText(s: RatingSummary | null): string | null {
  return s ? `★ ${one(s.average)} (${s.count})` : null
}

/** "4.8 · 12 reviews" / "5.0 · 1 review". */
export function ratingSummaryText(s: RatingSummary): string {
  return `${one(s.average)} · ${s.count} ${s.count === 1 ? 'review' : 'reviews'}`
}

/** Accessible label: "Rated 4.8 out of 5 from 12 reviews". */
export function ratingLabel(s: RatingSummary): string {
  return `Rated ${one(s.average)} out of 5 from ${s.count} ${s.count === 1 ? 'review' : 'reviews'}`
}

/** Menu / product page: "Rated 4.8 out of 5 by 36 verified customers". */
export function shopRatingLine(s: RatingSummary | null): string | null {
  if (!s) return null
  return `Rated ${one(s.average)} out of 5 by ${s.count} verified ${s.count === 1 ? 'customer' : 'customers'}`
}

export const formatAverage = one

/** Reviews with a photo first, then newest first (ISO dates). Returns a new array. */
export function sortReviewsForDisplay<T extends { date: string; photo: unknown }>(reviews: readonly T[]): T[] {
  return [...reviews].sort((a, b) => Number(!!b.photo) - Number(!!a.photo) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

const DAY = 86_400_000

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", "1 month ago", "2 years ago". */
export function relativeDate(iso: string, now: Date = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY))
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return plural(days, 'day')
  if (days < 30) return plural(Math.floor(days / 7), 'week')
  if (days < 365) return plural(Math.floor(days / 30), 'month')
  return plural(Math.floor(days / 365), 'year')
}
