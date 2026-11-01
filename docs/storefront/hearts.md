# "Love it" hearts (ZP-507)

Anyone can love a look: light social proof and a popularity signal (ZP-506).
No sign-in. One heart per piece per device; un-love is allowed.

## Shopper side

- **Feed** (`FeedSlide`): a round heart button on the rail, directly above the
  eye, also in clean view. Under it: "Love", or the number from 3 loves.
  The rail order, top to bottom, is Enquire / Share / Details (with details),
  then the heart and the eye, so the eye no longer moves when details open.
- **Product page** (`ProductView`): a pill under the price, "Love it", or
  "Loved by 24" from 3 loves. Not shown on an owner preview.
- A real `<button>`, `aria-pressed`, named "Love <piece name>"; the visible
  count is its description. Loving pops the heart once
  (`sf-heart-pop` in `globals.css`, `motion-safe:` only).
- Component: `src/components/storefront/loves/LoveButton.tsx`
  (`variant="rail" | "pill"`).

## On the phone (`src/lib/loves/client.ts`)

- localStorage `vyra:loves`: JSON array of loved slugs (at most 500, most
  recent last; read and written in try/catch, blocked storage means the heart
  lasts for this page only). One store per page, so every heart of a piece
  agrees; other tabs follow through the `storage` event.
- Count shown = the cached server count (`PublicProduct.loves`) + what this
  phone changed since the page loaded (`displayLoves`), never below 0.
- The server is told with `fetch(..., { keepalive: true })`, one request per
  piece at a time (`createLoveSync`): taps while one is in flight only change
  the wanted state, and the final one is sent when it returns.
- Device token: the analytics device id, `localStorage['vyra:analytics:device']`
  (owner decision: hearts reuse it). It is absent with GPC / DNT or blocked
  storage: then the heart is kept on the phone only and nothing is sent.
- Also tracked: `love_on` / `love_off` (analytics).

## Server: `POST /api/public/loves`

`src/app/api/public/loves/route.ts` → `src/lib/loves/ingest.ts`. Body (JSON or
text/plain): exactly `{ "slug": "<slug>", "on": true|false, "device": "<uuid v4>" }`.

| check (in this order) | answer |
|---|---|
| `Origin` missing / not this host, or `Sec-Fetch-Site` not `same-origin` | 403 |
| bot or headless user agent / client hint | 204, nothing stored |
| per IP (in memory, never stored): burst 120, 1/s | 429 + Retry-After |
| content type not JSON / text/plain | 415 |
| body over 1 KB | 413 |
| not exactly `{ slug, on, device }` | 400 |
| per device: burst 30, one every 5 s; then 300 per device per 24 h | 429 |
| not a published piece (published, slug, published category) | 404 |
| stored (or nothing to change) | 204, no body, `Cache-Control: no-store` |

GPC / DNT do not block a heart (it is the visitor's own action; such a
browser has no device id and sends nothing anyway). Staff signed in to the
back office count like anyone. Limits are per instance, like analytics.

## Data

- `Product.loveCount` (int, default 0, `CHECK >= 0`), public as `loves`
  (allow-listed in `toPublicProduct`). Read through the cached catalogue, so
  it is at most 60 s old (`STOREFRONT_REVALIDATE_SECONDS`); a tap never
  expires the cache.
- `ProductLove` (`id`, `productId`, `hash` unique, `createdAt`): one row per
  device and piece. `hash` = HMAC-SHA256(key, `<device id>:<product id>`), hex.
  The product id (not the slug) is hashed so a slug rename keeps the dedupe.
  No device id, IP or user agent is stored, and one phone's hashes cannot be
  linked to each other.
- Key (`src/lib/loves/hash.ts`): `LOVES_HASH_SECRET` (≥ 32 characters) if set,
  else derived from the session secret as HMAC-SHA256(JWT secret,
  "vyra:loves:v1"). Never logged. Changing the secret restarts the dedupe
  (counts stay).
- `setLove` (`src/lib/loves/db.ts`), one transaction: insert the hash with
  ON CONFLICT DO NOTHING and +1 only if it is new; delete it and −1 only if a
  row went and the count is above 0. Concurrent duplicate taps count once.
  The counter is updated with SQL so `Product.updatedAt` is not touched.
- Migration `20261104090000_product_loves`.

## Admin

- Products list: "♥ N" next to the website status (from `GET /api/website/products`, `loves`).
- Product editor, Website section: "Hearts: N" and **Reset** (confirm) →
  `DELETE /api/website/products/:id/loves` (OWNER): count 0, the piece's
  hashes deleted (phones can love it again), the piece's cache expired.

## Privacy

The privacy page (`/privacy`, "Visit and device IDs") says hearts are kept on
the device and counted once per device as an anonymous salted hash.

## Tests

- `tests/loves.test.ts`: hash (salted, per device and piece, key derivation,
  fails closed), body allow-list, count display and the "under 3" rule, the
  stored list, the request sync.
- `tests/loves-endpoint-db.test.ts`: the endpoint end to end (dedupe,
  un-love, unpublished 404, 403/400/413/415, bots, floods per IP / device /
  day), concurrency, never below 0, the CHECK constraint, owner reset, DTO and
  admin fields.
