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
`shopOnly`, `productId`, `customerHint`, `expiresAt` (+30 days), `usedAt`,
`photoKey` (an uploaded photo not yet submitted), `photoUploads` (capped at
`REVIEW_PHOTO_MAX_UPLOADS` = 5), `createdBy`.

`Review`: `inviteId` (unique), `shopOnly`, `productId`, `stars`, `shopStars`
(piece reviews only), `comment`, `displayName`, `photoKey` (only with consent),
`photoConsent`, `status` (`PENDING` / `APPROVED` / `HIDDEN`), `flagged`,
`ownerReply`, `privateNote`, `approvedAt`, `moderatedBy`, timestamps. CHECK
constraints guard stars (1–5), comment length (10–1000), no shop stars on a
shop-only review, and a non-negative upload count.

**Deleting a product never deletes reviews** (owner decision): both
`Review.productId` and `ReviewInvite.productId` are `ON DELETE SET NULL`.
`shopOnly` keeps a shop review apart from a review whose piece was deleted.
Such a review is no longer shown on a product page but keeps counting towards
the shop rating; an unused piece link for a deleted product stops working
("invalid").

**Shop rating** (owner decision) = the `stars` of ALL approved shop-only
reviews plus the `shopStars` of ALL approved piece reviews, whether the piece
is still published or even still exists; "N verified customers" is the number
of those. Piece lists and piece ratings only show for pieces that are public now.

Migration: `prisma/migrations/20261104090000_reviews` (also adds
`SiteSettings.googleReviewUrl`).

## Photo lifecycle

Stored pictures are content-hashed and shared (the same bytes uploaded as a
product photo get the same key), so a review photo's file is only deleted once,
after its own reference is cleared, nothing references the key any more
(`ProductImage`, `Product.imageUrl`, category hero, current settings pictures,
other reviews or links: `isImageKeyReferenced` in `src/lib/reviews/photos.ts`).

| When | What happens |
|---|---|
| Customer taps "Remove photo" | `DELETE /api/public/reviews/photo` clears the link's photo and deletes the file |
| Customer uploads another photo | the previous one is deleted (max 5 uploads per link) |
| Review sent without the photo, or **without consent** | the photo is detached and deleted at submit (it is never kept without consent) |
| Owner deletes the review | its photo is deleted |
| Nightly | `cleanupReviewPhotos`: photos left on links that expired (or were used), and any review photo without consent |

The nightly sweep runs at the end of the analytics rollup Cloud Run job
(`scripts/analytics-rollup.ts`, scheduled by `.github/workflows/analytics-rollup.yml`),
and on its own with `npm run reviews:cleanup`. In production it refuses to run
unless `GRACE_IMAGE_STORAGE` is set (the job is deployed with
`GRACE_IMAGE_STORAGE=gcs` and `GRACE_IMAGE_BUCKET`); the runtime service
account needs `storage.objects.delete` on the images bucket. If a storage
delete fails after the reference was cleared, the file stays orphaned (logged;
not served by anything).

## Security

- Admin APIs (`/api/website/reviews/**`) are `OWNER_ONLY`.
- Token: 32 random bytes (base64url, 43 chars); only its SHA-256 is stored;
  looked up by hash and compared again in constant time.
- **Single use is atomic**: one conditional `UPDATE … WHERE usedAt IS NULL AND
  expiresAt > now()` claims the link; only the request that claimed it creates
  the review, in the same transaction (tested with 5 concurrent submits).
- **The token never reaches analytics**: the review page does not start the
  analytics client (`AnalyticsProvider` skips it, and the client is disabled on
  that path), and `/review/<anything>` is recorded as `/review` both by the
  client (`normalizePage`) and again by the server (`validateEvent`, also for
  the `landing` prop).
- **Referer / caching**: the page sets `<meta name="referrer" content="no-referrer">`
  and the proxy adds `Referrer-Policy: no-referrer`, `Cache-Control: private,
  no-store` and `X-Robots-Tag: noindex` to `/review/*` and `/site/review/*`.
- **Request logs**: Cloud Run request logs (and any HTTP access log) still
  record the full path, so they contain review tokens. Mitigation: a link works
  once and for 30 days; anyone with log access could at most submit an unused
  review, which the owner still moderates. Keep log access to the owner and
  operators.
- Public POSTs (`/api/public/reviews`, `/api/public/reviews/photo`): per-IP
  token bucket (best effort, per instance), same-origin check
  (`Sec-Fetch-Site`, else `Origin` = `Host`), JSON-only submit with a 16 KB cap,
  allow-listed fields (a client cannot set status or name).
- Photo endpoint: the token comes in the `X-Review-Token` header; the request
  needs a `Content-Length` ≤ 10 MB (+ multipart headroom) and an open piece link
  with uploads left, all checked BEFORE the body is read. Only JPEG, PNG and
  WebP are accepted (sniffed from the bytes); the picture is re-encoded to WebP
  ≤ 1200 px with **all metadata incl. GPS stripped**. The key is never returned
  to the client. It is public (`/api/images/public/…`) only when the review is
  APPROVED, the customer consented and the piece is public
  (`isPublicImageKey`); otherwise 404. Like product photos, browsers may keep a
  photo for up to 5 minutes (`max-age=300`) after it is unpublished.
- `googleReviewUrl`: https only, exact hosts `g.page`, `search.google.com`,
  `maps.app.goo.gl`, or `www.google.com` / `google.com` under `/maps`.
- Comments and replies are stored as normalised plain text and rendered as
  React text (escaped), never as HTML or links. JSON-LD escapes `<`.
- Nothing about a review is public before approval; the public DTO
  (`toPublicReview`) is an allow-list (stars, comment, name, date, reply,
  consented photo) and returns null for anything not APPROVED.
- Star pictures show the whole part of an average (4.8 → ★★★★☆) next to the
  exact number, never more stars than earned.

## Caching

One argument-free cache entry (`src/lib/storefront/cached.ts`, key
`storefront/reviews`) holds every approved review (piece lists only for public pieces) and the
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
