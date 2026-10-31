# Storefront public data layer (VYRA website)

ZP-484. This is the security boundary between the private back office and
the public site. Public pages (`src/app/site/**`) and public API routes read
products and categories **only** through `@/lib/storefront`. They never
import Prisma directly.

- Public surface (server only, `import 'server-only'`): `src/lib/storefront/index.ts`
- DTOs and allow-list: `src/lib/storefront/dto.ts`
- Uncached queries (take a Prisma client, used by tests and scripts): `src/lib/storefront/queries.ts`
- Sorting and paging: `src/lib/storefront/listing.ts`
- Image URLs, widths and srcset (pure, client-safe): `src/lib/storefront/image-sizes.ts`
- Resized-picture LRU: `src/lib/storefront/resize-cache.ts`
- Cache tags and revalidation: `src/lib/storefront/cache-tags.ts`
- Public image route: `src/app/api/images/public/[key]/route.ts` (logic in `src/lib/storefront/public-image.ts`)
- JSON route: `src/app/api/public/products/route.ts`
- Tests: `tests/storefront-public-dto.test.ts` (pure), `tests/storefront-public-db.test.ts` (database)

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
| `listPublishedProducts({ categorySlug?, newOnly?, featuredOnly?, hideSoldOut?, sort?, page?, pageSize?, fewLeftThreshold?, includeItemNumber? })` | `{ items, total, page, pageSize, pageCount }` |
| `getPublishedProductBySlug(slug, { fewLeftThreshold?, includeItemNumber? })` | `{ product }`, or `{ redirectTo: <current slug> }` for an old slug (`ProductSlugRedirect`) of a public product, or `null` |
| `listRelatedProducts(slug, limit = 4)` | Products from the same category first, then the rest of the catalogue, in the default order. It never includes the product itself or sold-out products. At most 12. |
| `listPublishedCategories()` | Published categories by `sortOrder`, then name |
| `getPublishedCategory(slug)` | `PublicCategory` or `null` |
| `publicImageUrl(key)`, `publicImageSrc(key, w?)` | `/api/images/public/<32 hex>.webp`, with `?w=<w>` if a width is given. Throws for an invalid key or width. |
| `publicImageSrcSet(key)` | The `srcset` value for `<img>` |
| `revalidateStorefront(scope?)` | See [Caching](#caching-and-revalidation) |

The few-left threshold is a parameter for now. Its default is
`FEW_LEFT_THRESHOLD` (3). ZP-486 will read it from site settings.

**Sorts** (`sort`):

- `featured` (default): featured first, then `sortOrder` ascending, then
  `publishedAt` newest first
- `newest`: `publishedAt` newest first
- `price-asc` and `price-desc`: only public prices count. Products without a
  public price come last, in the default order, so the order never hints at
  a hidden price.
- `name`: display name A to Z

`pageSize` is clamped to 1–48 (default 24) and `page` to at least 1.
Filters run in the database. Sorting and paging run in memory over the
filtered set, which is fine for a catalogue of a few hundred products.

## Caching and revalidation

The project does not enable Cache Components (`cacheComponents` in
`next.config.ts`), so `'use cache'` is not available. The functions use
`unstable_cache` with tags, as the Next 16 guide "Caching without Cache
Components" describes.

| Entry | Tags |
| --- | --- |
| product lists | `storefront`, `storefront:products`, `storefront:categories` |
| product by slug, related | the same three plus `storefront:product:<slug>` |
| category list | `storefront`, `storefront:categories` |
| category by slug | the same two plus `storefront:category:<slug>` |

Product entries also carry `storefront:categories`, because they embed the
category name and depend on whether the category is published. Every entry
also has `revalidate: 60` (`STOREFRONT_REVALIDATE_SECONDS`) as a backstop.

**The Next data cache is per instance.** `revalidateTag` only clears the
cache of the Cloud Run instance that handled the admin request, and UAT runs
up to 2 instances. Other instances see a change only when their entry
reaches the 60 s backstop.

| Change (publish, unpublish, edit) | When public data reflects it |
| --- | --- |
| On the instance that handled the change | Immediately, once the admin calls `revalidateStorefront` |
| On other instances | ≤60 s across instances. An entry older than 60 s is refreshed in the background, so the first request after that may still get the old data once. |
| No `revalidateStorefront` call (a missed call, or a stock change from sales) | ≤60 s on every instance |
| `isNew` turning false 30 days after the first publish | ≤60 s late |
| `GET /api/public/products` in a browser or CDN | Up to another 60 s (`max-age=60, s-maxage=60`) on top of the above |

In short: ≤60 s across instances; immediate on the instance that handled
the change. Public **images** are not in this cache. Their visibility is
checked on every request (see below).

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
revalidateStorefront()                                     // everything (e.g. after an import)
```

- `productSlugs` expires `storefront:products` (every product entry) and
  each `storefront:product:<slug>`.
- `categorySlugs` expires `storefront:categories` (every category entry and
  every product entry) and each `storefront:category:<slug>`.
- No argument expires `storefront`.

It uses `revalidateTag(tag, { expire: 0 })`. The next request recomputes
instead of serving stale data, which is what you want when something is
unpublished. Invalid slugs are skipped. It returns the list of tags it
expired.

Stock changes (sales, stock movements) change `availability`. Until those
routes call `revalidateStorefront({ productSlugs })`, availability can lag
by up to 60 s.

## Public images: `GET /api/images/public/<32 hex>.webp[?w=<width>]`

No sign-in is needed. The route serves a picture only when the key is one
of these:

- the `imageKey` of a `ProductImage` of **any** public product. Keys are
  content-hashed and shared between products (7 August pictures are), so a
  key used by both a published and an unpublished product is served.
- the `heroImageKey` of a published category

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
Cache-Control: public, max-age=300, s-maxage=300, stale-while-revalidate=86400
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
  sizes="(min-width: 1024px) 25vw, 50vw" // the component knows its layout
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

`next.config.ts` keeps `images.minimumCacheTTL: 300`
(`tests/next-image-config.test.ts`). The default is 4 hours. The setting
is harmless and limits any accidental use of the optimiser. It does not
fix the retention described above.

### How long an unpublished picture stays visible

Keys are content-hashed, so a new photo always gets a new URL. Long caching
never shows an old photo. It only delays the removal of an **unpublished**
one.

| Layer | How long it may still show an unpublished picture |
| --- | --- |
| The origin (this route, every size) | **Never.** Visibility is checked on every request, before the resize cache. |
| A browser | Up to 300 s (`max-age=300`) |
| A shared cache or CDN, if one is added | Up to 300 s (`s-maxage=300`). After that, at most one more stale response while it revalidates in the background (`stale-while-revalidate`); it then receives the uncacheable 404. Cloud Run has no CDN in front today. |
| The Next image optimiser (`/_next/image`) | Indefinitely for a size it has already cached (see above). This is why storefront photos must not go through it. |

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
- Rate limit: an in-memory token bucket per client IP, with a burst of 60
  and a refill of 1 request per second. Over the limit it returns 429 with
  `Retry-After`. The limit is **best effort**: each Cloud Run instance has
  its own buckets, and they reset on restart. The client IP is the **last**
  `X-Forwarded-For` entry, which Cloud Run appends. If a load balancer is
  ever put in front, revisit this. At most 10,000 IPs are tracked; the least
  recently used are dropped first.
- `Cache-Control: public, max-age=60, s-maxage=60`.
- On the storefront host only `/api/public/*` and `/api/images/public/*` are
  reachable under `/api` (ZP-485).
