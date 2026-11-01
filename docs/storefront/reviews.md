# Customer reviews and ratings (ZP-508)

Verified customer reviews for each piece and for the VYRA shop, moderated by
the owner.

## Owner decisions

- Only verified buyers: the owner sends a **one-time link** (no open form, no
  accounts).
- Stars (1–5) and a short plain-text comment; no comment threads. The owner may
  add one public **Reply from VYRA**.
- A **shop rating** as well as per-piece ratings.
- **Every review is approved by the owner** before it appears.
- No fake or seeded reviews: there is no API or UI with which the admin can
  write or edit a review's stars, comment or name.

## Flow

1. **Send review link.** Product editor → Website section → "Send review link"
   (piece review), or Website → Reviews → "Shop review link" (shop only).
   The owner may type the customer's first name (prefills the form and the
   message). The link is shown once, with **Send on WhatsApp**: a `wa.me` link
   with the ready thank-you message and **no number** (the owner picks the
   chat), so the site never stores a phone number. Links work once, for 30 days.
2. **Customer form** `/review/<token>` (UAT: `/site/review/<token>`), design
   `Review.dc.html`: piece photo + name (or the VYRA wordmark for a shop link),
   star buttons (`aria-pressed`, nothing preselected), comment with counter
   (10–1000), name shown as "Tendai M.", optional photo of them wearing it with
   an explicit consent box (unticked by default), optional shop stars, then a
   thank-you screen with "Review us on Google" when the site setting
   `googleReviewUrl` is set. Invalid / expired / used links show a friendly page.
   The page is `noindex, nocache` and `no-referrer`.
3. **Moderation** Website → Reviews (OWNER only): pending first; Approve,
   Hide (optional private note), Reply, Unpublish (back to pending), Delete. A
   simple word-list match shows "Check the wording" on the card (it never blocks
   anything). The admin nav's "Website" item shows the pending count.
4. **Display** (approved only):
   - Product page: "★★★★★ 4.8 · 3 reviews" near the price (links to
     `#reviews`); the Reviews section with the shop rating box, each review's
     stars, comment, name, Verified buyer badge, relative date, owner reply and
     photo; photos first then newest, 5 at a time with "Show more". Schema.org
     `Product` + `AggregateRating` + `Review` JSON-LD only when the piece has
     approved reviews.
   - Feed caption (with details shown): "★ 4.8 (12)" when the piece has at
     least one approved review.
   - Menu: "Rated 4.8 out of 5 by 36 verified customers".
   - Nothing ever says "0 reviews": no reviews → the block is hidden.

## Data

`ReviewInvite`: `tokenHash` (sha256 of the token; the token is never stored),
`productId` (null = shop), `customerHint`, `expiresAt` (+30 days), `usedAt`,
`photoKey` (an uploaded photo not yet submitted), `createdBy`.

`Review`: `inviteId` (unique), `productId` (null = shop-only), `stars`,
`shopStars` (piece reviews only), `comment`, `displayName`, `photoKey`,
`photoConsent`, `status` (`PENDING` / `APPROVED` / `HIDDEN`), `flagged`,
`ownerReply`, `privateNote`, `approvedAt`, `moderatedBy`, timestamps. CHECK
constraints guard stars (1–5) and comment length (10–1000). Deleting a product
deletes its invites and reviews.

**Shop rating** = the `shopStars` of approved piece reviews plus the `stars` of
approved shop-only reviews; "N verified customers" is the number of those.

Migration: `prisma/migrations/20261104090000_reviews` (also adds
`SiteSettings.googleReviewUrl`).

## Security

- Admin APIs (`/api/website/reviews/**`) are `OWNER_ONLY`.
- Token: 32 random bytes (base64url, 43 chars); only its SHA-256 is stored;
  looked up by hash and compared again in constant time.
- **Single use is atomic**: one conditional `UPDATE … WHERE usedAt IS NULL AND
  expiresAt > now()` claims the link; only the request that claimed it creates
  the review, in the same transaction (tested with 5 concurrent submits).
- Public POSTs (`/api/public/reviews`, `/api/public/reviews/photo`): per-IP
  token bucket (best effort, per instance), same-origin check
  (`Sec-Fetch-Site`, else `Origin` = `Host`), JSON-only submit with a 16 KB cap,
  allow-listed fields (a client cannot set status or name).
- Photo: same pipeline as product photos (type sniffed from bytes, re-encoded
  to WebP ≤ 1200 px, **all metadata incl. GPS stripped**), 10 MB cap checked
  before reading, only for an open piece link; the key is never returned to the
  client. It is public (`/api/images/public/…`) only when the review is
  APPROVED, the customer consented and the piece is public
  (`isPublicImageKey`); otherwise 404. Like product photos, browsers may keep a
  photo for up to 5 minutes (`max-age=300`) after it is unpublished. Stored
  bytes are not deleted with a review (keys are content-hashed; nothing serves
  them once the review is gone).
- Comments and replies are stored as normalised plain text and rendered as
  React text (escaped), never as HTML or links. JSON-LD escapes `<`.
- Nothing about a review is public before approval; the public DTO
  (`toPublicReview`) is an allow-list (stars, comment, name, date, reply,
  consented photo) and returns null for anything not APPROVED.

## Caching

One argument-free cache entry (`src/lib/storefront/cached.ts`, key
`storefront/reviews`) holds every approved review of a public piece and the
aggregates. Tags: `storefront`, `storefront:reviews`, `storefront:products`,
`storefront:categories`, 60 s backstop. Approve / hide / unpublish / reply /
delete call `revalidateStorefront({ reviews: true })`.

## Code

- `src/lib/reviews/` – rules (validation, display name, word list), token,
  invites (create / read / photo / submit), moderation, aggregate (wording),
  links (URL + WhatsApp message), same-origin, structured data.
- `src/lib/storefront/reviews.ts` – public index; `dto.ts` `toPublicReview`.
- `src/app/api/website/reviews/**`, `src/app/api/public/reviews/**`.
- `src/app/site/review/[token]/page.tsx`, `src/components/storefront/reviews/*`.
- `src/app/(admin)/website/reviews/page.tsx`, `src/components/ReviewLinkCreator.tsx`,
  `src/components/usePendingReviews.ts`.
- Tests: `tests/reviews-rules.test.ts`, `tests/reviews-db.test.ts`.
