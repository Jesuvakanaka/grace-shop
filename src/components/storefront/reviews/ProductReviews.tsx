// ZP-508: the product page's review blocks (server components).
// - RatingSummaryLink: "★★★★★ 4.8 · 3 reviews" near the price, to #reviews.
// - ProductReviews: the "Reviews" section (piece summary, shop rating box,
//   approved reviews with photos first then newest, 5 at a time).
// Only approved reviews reach here (public data layer). Comments and replies
// are plain text rendered as React text: escaped, never HTML, never links.
// Nothing renders when there is nothing to show (never "0 reviews").
import type { PublicReview } from "@/lib/storefront/dto";
import {
  ratingLabel,
  ratingSummaryText,
  relativeDate,
  starsText,
  type RatingSummary,
} from "@/lib/reviews/aggregate";
import { ReviewList, type ReviewListItem } from "./ReviewList";
import { ShopRatingBox } from "./ShopRatingBox";

export const REVIEWS_ANCHOR = "reviews";

export type ProductReviewsData = {
  /** The piece's approved reviews; null when it has none. */
  summary: RatingSummary | null;
  reviews: PublicReview[];
  /** The shop rating; null when no approved shop stars exist. */
  shop: RatingSummary | null;
};

export function RatingSummaryLink({ summary }: { summary: RatingSummary | null }) {
  if (!summary) return null;
  return (
    <a
      href={`#${REVIEWS_ANCHOR}`}
      className="sf-focus inline-flex min-h-11 items-center gap-1.5 self-start rounded-[2px] text-sm text-brand-ink hover:underline hover:underline-offset-4"
    >
      <span aria-hidden="true" className="tracking-[0.06em] text-brand-olive-700">
        {starsText(summary.average)}
      </span>
      <span aria-hidden="true">{ratingSummaryText(summary)}</span>
      <span className="sr-only">{ratingLabel(summary)}. Read the reviews</span>
    </a>
  );
}

export function ProductReviews({ data, now = new Date() }: { data: ProductReviewsData | null | undefined; now?: Date }) {
  if (!data || (!data.summary && !data.shop)) return null;
  const items: ReviewListItem[] = data.reviews.map((r) => ({
    stars: r.stars,
    starsText: starsText(r.stars),
    starsLabel: `${r.stars} out of 5 stars`,
    comment: r.comment,
    name: r.name,
    date: relativeDate(r.date, now),
    dateTime: r.date,
    reply: r.reply,
    photo: r.photo,
  }));
  return (
    <section id={REVIEWS_ANCHOR} aria-labelledby="reviews-title" className="flex scroll-mt-20 flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="reviews-title" className="m-0 font-serif text-[26px] font-medium">
          Reviews
        </h2>
        {data.summary ? (
          <p className="m-0 text-[13px] text-brand-ink-soft">
            <span aria-hidden="true">{ratingSummaryText(data.summary)}</span>
            <span className="sr-only">{ratingLabel(data.summary)}</span>
          </p>
        ) : null}
      </div>
      {data.shop ? <ShopRatingBox summary={data.shop} variant="product" /> : null}
      {items.length === 0 ? (
        <p className="m-0 text-sm leading-relaxed text-brand-ink-soft">
          No reviews for this piece yet. Bought it? Ask us for your review link on WhatsApp.
        </p>
      ) : (
        <ReviewList items={items} />
      )}
    </section>
  );
}
