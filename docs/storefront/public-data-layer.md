# Storefront public data layer (VYRA website)

ZP-484. This is the security boundary between the private back office and
the public site. Public pages (`src/app/site/**`) and public API routes read
products and categories **only** through `@/lib/storefront`. They never
import Prisma directly.

- Public surface (server only, `import 'server-only'`): `src/lib/storefront/index.ts`
- DTOs and allow-list: `src/lib/storefront/dto.ts`
- Uncached queries (take a Prisma client, used by tests and scripts): `src/lib/storefront/queries.ts`
- Cached reads (exactly two entries): `src/lib/storefront/cached.ts`
- In-memory catalogue (filter, sort, page, slug and related lookup): `src/lib/storefront/catalogue.ts`
- Sorting and paging: `src/lib/storefront/listing.ts`
- Image URLs, widths and srcset (pure, client-safe): `src/lib/storefront/image-sizes.ts`
- Resized-picture LRU: `src/lib/storefront/resize-cache.ts`
- Cache tags and revalidation: `src/lib/storefront/cache-tags.ts`
- Public image route: `src/app/api/images/public/[key]/route.ts` (logic in `src/lib/storefront/public-image.ts`)
- JSON route: `src/app/api/public/products/route.ts`
- Tests: `tests/storefront-public-dto.test.ts` (pure), `tests/storefront-public-db.test.ts` (database), `tests/storefront-public-cache.test.ts` (cache entries stay bounded), `tests/next-image-config.test.ts`

The internal modules (`queries.ts`, `public-image.ts`) also throw if they
are loaded in a browser. They do not import `server-only` because the
node:test runner cannot resolve it. Only `index.ts` does.

## What is public

A **product** is public when all of these are true:

- `published = true`
- it has a slug
- its category is set and that category is published

A **category** is public when `published = true`.

Products without a category, products in an unpublished category and
unpublished products are never returned. This includes requests through an
old slug.

## Public product DTO

`PublicProduct` has exactly these keys. `tests/storefront-public-dto.test.ts`
checks the key set.

| Key | Source |
| --- | --- |
| `slug` | `Product.slug` |
| `name` | `displayName()`: `publicName`, or `productName` if that is blank |
| `description` | `publicDescription` (trimmed; `null` if blank) |
| `category` | `{ slug, name }` |
| `colours`, `sizes` | free text, or `null` |
| `availability` | `getAvailability(currentQuantity, fewLeftThreshold)`: `IN_STOCK`, `FEW_LEFT` or `SOLD_OUT`. The quantity itself is never included. |
| `images` | `[{ url, srcSet, alt, width, height }]`, primary first, then gallery order. `url` is the original, `/api/images/public/<32 hex>.webp`. `srcSet` lists every allowed width up to 1200 (see [Use <img srcset>](#use-img-srcset-not-nextimage)). `alt` falls back to the name. `width` and `height` are `null` because dimensions are not stored yet. Pictures are at most 1200px on the longest side. Invalid keys are dropped. |
| `isNew` | `isNewArrival()`: first published within 30 days |
| `featured` | `Product.featured` |
| `priceUsd` | `publicPriceUsd()`. Only with `SHOW_PRICE` and a price greater than 0, otherwise `null` ("ask for price"). |
| `itemNumber` | **Only** when the caller passes `includeItemNumber: true`. It is off by default. |

These are **never** included: `unitCost*`, `sellingPriceRmb`, `wholesale*`,
`currentQuantity`, `openingQuantity`, `source*`, `notes`, `createdBy`,
`updatedBy`, and database ids. The queries select an explicit column list,
and `toPublicProduct` builds a new object field by field, so a new private
column can never leak through a spread. The test also checks that no key,
at any depth, matches
`/cost|wholesale|quantity|source|note|createdBy|updatedBy|itemNumber/i`.

`PublicCategory` has these keys: `{ slug, name, description, heroImage }`.
`heroImage` is a `PublicImage` or `null`.

## Functions (`@/lib/storefront`)

| Function | Returns |
| --- | --- |
| `listPublishedProducts({ categorySlug?, newOnly?, featuredOnly?, hideSoldOut?, sort?, page?, pageSize?, includeItemNumber? })` | `{ items, total, page, pageSize, pageCount }` |
| `getPublishedProductBySlug(slug, { includeItemNumber? })` | `{ product }`, or `{ redirectTo: <current slug> }` for an old slug (`ProductSlugRedirect`) of a public product, or `null` |
| `listRelatedProducts(slug, limit = 4)` | Products from the same category first, then the rest of the catalogue, in the default order. It never includes the product itself or sold-out products. At most 12. |
| `listPublishedCategories()` | Published categories by `sortOrder`, then name |
| `getPublishedCategory(slug)` | `PublicCategory` or `null` |
| `publicImageUrl(key)`, `publicImageSrc(key, w?)` | `/api/images/public/<32 hex>.webp`, with `?w=<w>` if a width is given. Throws for an invalid key or width. |
| `publicImageSrcSet(key)` | The `srcset` value for `<img>` |
| `revalidateStorefront(scope?)` | See [Caching](#caching-and-revalidation) |

The cached catalogue takes its few-left threshold from site settings
(`fewLeftThreshold`, read with `readFewLeftThreshold` in
`src/lib/site-settings/db.ts`). If the settings row is missing, it uses
`FEW_LEFT_THRESHOLD` (3). When a settings save changes the threshold,
`PUT /api/website/settings` calls `revalidateStorefront()` with no scope.
Every product DTO embeds the threshold, so the whole storefront is expired.
Other settings changes expire only `storefront:settings` and
`storefront:home`. The uncached functions in `queries.ts` still take a
`fewLeftThreshold` option, for tests and scripts.

**Sorts** (`sort`):

- `featured` (default): featured first, then `sortOrder` ascending, then
  `publishedAt` newest first
- `newest`: `publishedAt` newest first
- `price-asc` and `price-desc`: only public prices count. Products without a
  public price come last, in the default order, so the order never hints at
  a hidden price.
- `name`: display name A to Z

`pageSize` is clamped to 1–48 (default 24) and `page` to at least 1.
`newOnly` means `isNew`.

## Caching and revalidation

The project does not enable Cache Components (`cacheComponents` in
`next.config.ts`), so `'use cache'` is not available. Caching uses
`unstable_cache` with tags, as the Next 16 guide "Caching without Cache
Components" describes.

### Exactly two cache entries

Anonymous requests must not be able to grow the cache. `unstable_cache`
keys an entry by its arguments, so caching each function call would add
one entry for every distinct category, page, sort or unknown slug. A
security review measured 200 distinct categories creating 200 cache files.
Instead, `src/lib/storefront/cached.ts` caches only these two values, and
their keys take no arguments:

| Entry | Contents | Tags |
| --- | --- | --- |
| `storefront/catalogue/v1` | Every public product as an allow-listed DTO (in the default order, with the public sort key and the item number kept beside the DTO), and old slug → current slug for public products | `storefront`, `storefront:products`, `storefront:categories` |
| `storefront/categories/v1` | Every published category as a DTO | `storefront`, `storefront:categories` |

The catalogue also carries `storefront:categories` because product DTOs
embed the category name and depend on whether the category is published.

Every function answers in memory from those two values
(`src/lib/storefront/catalogue.ts`): filtering, sorting, paging, slug and
redirect lookup, related products and category lookup. An invalid slug
returns before any cache read. An unknown slug reads the existing entry and
creates nothing. `tests/storefront-public-cache.test.ts` checks that the set
of cache keys stays at two across 200 distinct categories, many sorts and
pages, and unknown slugs. The catalogue holds a few hundred products, so
this is small. The cached value contains no cost, wholesale, quantity,
source, notes or createdBy/updatedBy data. The item number is kept beside
the DTO and is added only when a caller passes `includeItemNumber: true`.

Both entries have `revalidate: 60` (`STOREFRONT_REVALIDATE_SECONDS`) as a
backstop. Bump `CACHE_VERSION` in `cached.ts` when the cached shape
changes.

### When a change shows

**The Next data cache is per instance.** `revalidateTag` only clears the
cache of the Cloud Run instance that handled the admin request, and UAT runs
up to 2 instances.

| Change (publish, unpublish, edit) | When public data reflects it |
| --- | --- |
| On the instance that handled the change | Immediately, once the admin calls `revalidateStorefront` |
| On other instances | After the 60 s backstop. On a low-traffic instance the first request after expiry can still get the old data once (stale-while-revalidate); the requests after it get fresh data. |
| No `revalidateStorefront` call (a missed call, or a stock change from sales) | The same as other instances, on every instance |
| `isNew` turning false 30 days after the first publish | The same: after the 60 s backstop |
| `GET /api/public/products` in a browser or CDN | Up to another 60 s (`Cache-Control: public, max-age=60, s-maxage=60`) on top of the above |

In short: immediate on the instance that handled the change. Other
instances refresh after the 60 s backstop. On a low-traffic instance the
first request after expiry can still get the old data once
(stale-while-revalidate), then fresh data. A shared cache handler is the
full fix and is tracked for launch hardening (ZP-495). Public **images**
are not in this cache: their visibility is checked on every request (see
below).

**The admin (ZP-483) must call `revalidateStorefront` from its Route
Handlers after every write that can change public data.** Without that
call, even the instance that handled the write keeps showing an
unpublished product until the 60 s backstop. A production-build check
confirmed that the cached list still showed the product right after it
was unpublished.

```ts
import { revalidateStorefront } from '@/lib/storefront'

revalidateStorefront({ productSlugs: [oldSlug, newSlug] }) // publish, unpublish, edit, slug change, images, stock
revalidateStorefront({ categorySlugs: [slug] })            // category edit, publish, unpublish, hero image
revalidateStorefront({ settings: true })                   // site settings (storefront:settings, storefront:home)
revalidateStorefront()                                     // everything (e.g. after an import or a few-left threshold change)
```

This is the only implementation of the tags. Route Handlers call it through
`src/lib/website/revalidate.ts` (`revalidateStorefront`, or
`revalidateStorefrontSafely` for the list of failed tags). That wrapper
never throws. It ignores only the "static generation store missing"
error, which happens outside a request (unit tests, scripts), and logs any
other error. `src/lib/site-settings/revalidate.ts` uses the same wrapper.
The `getPublicSiteSettings()` entry carries `storefront` and
`storefront:settings`, so a call with no scope also clears it.

- `productSlugs` expires `storefront:products` (the catalogue).
- `categorySlugs` expires `storefront:categories` (the category list and
  the catalogue).
- No argument expires `storefront` (both).
- The helper also expires `storefront:product:<slug>` and
  `storefront:category:<slug>` for each valid slug. No entry carries those
  tags today, so they have no effect. They are kept so that callers never
  need to change if per-slug entries come back.

It uses `revalidateTag(tag, { expire: 0 })`. The next request recomputes
instead of serving stale data, which is what you want when something is
unpublished. Invalid slugs are skipped. It returns the list of tags it
expired.

## Public images: `GET /api/images/public/<32 hex>.webp[?w=<width>]`

No sign-in is needed. The route serves a picture only when the key is one
of these:

- the `imageKey` of a `ProductImage` of **any** public product. Keys are
  content-hashed and shared between products (7 August pictures are), so a
  key used by both a published and an unpublished product is served.
- the `heroImageKey` of a published category
- one of the **current** site settings pictures (hero desktop, hero mobile,
  about and default share image; `settingsImageKeys()` in
  `src/lib/site-settings/dto.ts`, checked by `isSettingsImageKey`). When the
  owner replaces one, the old key is a 404 at once, unless a public product
  or published category still uses it.

The visibility check reads the database on **every** request, sizes
included, before any cache is read. The origin therefore stops serving an
unpublished picture at once.

| Request | Response |
| --- | --- |
| Malformed or traversal key (strict `imageKeyFromFileName`: only `<32 lowercase hex>.webp`) | `404`, `Cache-Control: no-store` |
| Any query other than a single `w` from the allow-list (`w=800`, `w=abc`, `w=640&w=320`, `q=75`, …) | `400`, `no-store`. This is checked before the database, and the answer is the same for every key, so it reveals nothing. |
| Unknown key, picture not public, or bytes missing | `404`, `no-store`. It is never 401 or 403. |
| Public, no `w` | `200`, the stored original (WebP, at most 1200px on the longest side) |
| Public, `w` in {320, 480, 640, 828, 1080, 1200, 1600} | `200`, a WebP resized to that width (quality 80, as the upload pipeline). It is never upscaled: `w=1600` on a 1200px picture gives 1200px. |
| A picture that cannot be decoded | `500`, `no-store` |

Headers on a `200`:

```
Content-Type: image/webp
Cache-Control: public, max-age=300, s-maxage=300, stale-while-revalidate=60
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
Content-Length: <bytes>
```

### Resizing and the resize cache

Resizing uses sharp, loaded lazily (`await import('sharp')`) as the upload
pipeline does, so routes that never resize do not load it. Concurrent
requests for the same key and width share one resize.

**Decision: resized bytes live in an in-process LRU, not in storage.**
`src/lib/storefront/resize-cache.ts` holds them, bounded to 64 MB per
instance (`RESIZE_CACHE_BYTES`) and keyed by `<key>|<width>`.

- The route is unauthenticated. Writing to the bucket from it would let
  anonymous traffic create objects (cost and abuse), and the public path
  would need write access to storage.
- The set of entries is small: public keys times 7 widths. Resizing a
  1200px WebP takes milliseconds, so a cold or restarted instance simply
  recomputes.
- The cache never decides what is public. It is read only **after** the
  visibility check. `tests/storefront-public-db.test.ts` caches a size
  while the product is published, unpublishes it, and gets 404 for that
  size, for other sizes and for the original.

### Use `<img srcset>`, not `next/image`

Storefront components (ZP-481, ZP-489) **must not** use `next/image` for
product or category photos. The Next image optimiser
(`/_next/image?url=…`) keeps serving a size it has cached after the
picture is unpublished. When the cached size expires, it serves it
`STALE` and revalidates. The revalidation gets a 404, and Next 16's
response cache (`retainPreviousCacheEntry` in
`next/dist/server/response-cache/index.js`) keeps the old image and
retries every 30 seconds, with no expiry. This was measured on a
production build:

| Time (UTC) | `/_next/image?url=/api/images/public/<key>&w=640` |
| --- | --- |
| 21:12:00 | `200`, `max-age=300`, `MISS`, then `HIT` |
| 21:12:11 | product unpublished: still `200 HIT`, while the route itself returns `404` |
| 21:17:36 | `200 STALE`; the server logs `internal image response failed ... 404` |
| 21:17:38 to 21:18:24 | `200 HIT`, `max-age=30` |

Use plain `<img>` with the helpers from `@/lib/storefront`. They come from
`src/lib/storefront/image-sizes.ts`, which is pure, so client components
can import that file directly.

```tsx
<img
  src={image.url}                 // or publicImageSrc(key, 640)
  srcSet={image.srcSet}           // or publicImageSrcSet(key)
  sizes={CARD_SIZES}              // "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw" for ProductCard
  alt={image.alt}
  loading="lazy"
  decoding="async"
/>
```

- `publicImageSrc(key, w?)` gives `/api/images/public/<hex>.webp`, or the
  same with `?w=<w>`. It throws for an invalid key or a width outside the
  allow-list.
- `publicImageSrcSet(key)` gives
  `"…?w=320 320w, …?w=480 480w, …?w=640 640w, …?w=828 828w, …?w=1080 1080w, …?w=1200 1200w"`.
  1600 is accepted by the route but not listed, because no stored picture
  is wider than 1200.
- Every DTO image (`PublicImage`) already carries `url` (the original) and
  `srcSet`. `sizes` depends on the layout, so the component supplies it.

**The optimiser cannot reach public pictures.** In `next.config.ts`,
`images.localPatterns` allows `{ pathname: '/api/images/*', search: '' }`.
That is one path segment, so the private `/api/images/<hex>.webp` is
allowed and `/api/images/public/**` is not. A
`/_next/image?url=/api/images/public/<key>` request returns 400.
`tests/next-image-config.test.ts` checks both paths. It also checks that
every `next/image` use in `src` is `unoptimized` or a literal `/brand/`
asset. Today these are the admin dashboard and `ProductPicture`, which
are both `unoptimized`, and the `/site` lockup. `images.minimumCacheTTL:
300` stays. The default is 4 hours. The setting is harmless and limits
any accidental optimiser use.

### How long an unpublished picture stays visible

Keys are content-hashed, so a new photo always gets a new URL. Long caching
never shows an old photo. It only delays the removal of an **unpublished**
one.

| Layer | How long it may still show an unpublished picture |
| --- | --- |
| The origin (this route, every size) | **Never.** Visibility is checked on every request, before the resize cache. |
| A browser | Up to 300 s (`max-age=300`) |
| A shared cache or CDN, if one is added | Up to 300 s (`s-maxage=300`). For up to 60 s after that (`stale-while-revalidate=60`), it may serve one more stale copy while it revalidates in the background. It then receives the uncacheable 404. Cloud Run has no CDN in front today. |
| The Next image optimiser (`/_next/image`) | Not applicable: `localPatterns` refuses `/api/images/public/**` (400). Before that change it kept a cached size indefinitely (see above). |

`s-maxage` is 300, not the 3600 the issue first proposed. It bounds shared
caches to the same 5 minutes as browsers. The optimiser also reads
`s-maxage` in preference to `max-age`, so with 3600 it cached sizes for an
hour.

## `GET /api/public/products` (JSON)

This route is for client components (filters and "load more", ZP-489). It
returns the same `PublicProductPage` as `listPublishedProducts`.

- Allowed parameters, each at most once: `category` (slug), `new`,
  `featured`, `hideSoldOut` (each `1`, `0`, `true` or `false`), `sort`,
  `page` (1–1000) and `pageSize` (1–48). Any other parameter, a repeated
  parameter or a malformed value is a 400.
- Rate limit: an in-memory token bucket per client, with a burst of 60
  and a refill of 1 request per second. Over the limit it returns 429 with
  `Retry-After`. The limit is **best effort**: each Cloud Run instance has
  its own buckets, and they reset on restart. At most 10,000 buckets are
  tracked; the least recently used are dropped first.
  - The client address is the **last** `X-Forwarded-For` entry, which Cloud
    Run appends. Earlier entries come from the client and are ignored.
  - IPv4 addresses get one bucket each. IPv6 addresses are bucketed by
    their **/64** (`2001:db8:1:2::/64`), because one subscriber usually
    holds a whole /64 and could otherwise rotate addresses to get fresh
    buckets. IPv4-mapped IPv6 (`::ffff:a.b.c.d`) counts as the IPv4
    address.
  - **Load-balancer caveat:** behind an external HTTP(S) load balancer, the
    last entry is the balancer's own address, so every client would share
    one bucket. If one is added, switch `clientKey` to the entry the
    balancer appends for the client (second from last).
- `Cache-Control: public, max-age=60, s-maxage=60`. Browsers and any CDN
  may reuse a page of results for 60 s. That comes on top of the data
  cache's 60 s backstop, so a publish or unpublish can take up to about
  2 minutes to show through this route on another instance. Errors (400,
  429, 500) are `no-store`. The data comes from the cached catalogue, so
  query parameters never create cache entries.
- On the storefront host only `/api/public/*` and `/api/images/public/*` are
  reachable under `/api` (ZP-485).
