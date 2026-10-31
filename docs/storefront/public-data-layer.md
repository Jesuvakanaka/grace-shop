# Storefront public data layer (VYRA website)

ZP-484. This is the security boundary between the private back office and
the public site. Public pages (`src/app/site/**`) and public API routes read
products and categories **only** through `@/lib/storefront`. They never
import Prisma directly.

- Public surface (server only, `import 'server-only'`): `src/lib/storefront/index.ts`
- DTOs and allow-list: `src/lib/storefront/dto.ts`
- Uncached queries (take a Prisma client, used by tests and scripts): `src/lib/storefront/queries.ts`
- Sorting and paging: `src/lib/storefront/listing.ts`
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
| `images` | `[{ url, alt, width, height }]`, primary first, then gallery order. `url` is `/api/images/public/<32 hex>.webp`. `alt` falls back to the name. `width` and `height` are `null` because dimensions are not stored yet. Pictures are at most 1200px on the longest side. Invalid keys are dropped. |
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
| `publicImageUrl(key)` | `/api/images/public/<32 hex>.webp`. Throws for an invalid key. |
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
also has `revalidate: 3600` as a backstop. It bounds a missed revalidation
and keeps `isNew` at most an hour late.

**The admin (ZP-483) must call `revalidateStorefront` from its Route
Handlers after every write that can change public data.** Without that
call, the cached lists keep showing an unpublished product for up to an
hour. The manual proof below confirms this.

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
by up to an hour.

## Public images: `GET /api/images/public/<32 hex>.webp`

No sign-in is needed. The route serves the bytes only when the key is one
of these:

- the `imageKey` of a `ProductImage` of **any** public product. Keys are
  content-hashed and shared between products (7 August pictures are), so a
  key used by both a published and an unpublished product is served.
- the `heroImageKey` of a published category

Everything else returns the same plain `404` with `Cache-Control: no-store`:
a malformed or traversal key, an unknown key, a picture that is not public,
or bytes missing from storage. It never returns 401 or 403, so it does not
reveal whether a private picture exists. The key is checked with the same
strict validator as the private route (`imageKeyFromFileName`: only
`<32 lowercase hex>.webp`).

The visibility check reads the database on every request and is not
cached, so the route itself stops serving a picture as soon as it is
unpublished.

Headers on a `200`:

```
Content-Type: image/webp
Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
```

### How long an unpublished picture stays visible

Keys are content-hashed, so a new photo always gets a new URL. Long caching
never shows an old photo. It only delays the removal of an **unpublished**
one.

| Where it is cached | How long it may still show an unpublished picture |
| --- | --- |
| The route itself | Never. The check is not cached. |
| A browser | Up to 5 minutes (`max-age=300`) |
| A shared cache or CDN, if one is added | Up to 1 hour (`s-maxage=3600`). After that, at most one more stale response while it revalidates in the background (`stale-while-revalidate`). It then receives the uncacheable 404. Cloud Run has no CDN in front today. |
| **The Next image optimiser (`/_next/image`)** | **Up to 4 hours.** It caches each resized variant for the larger of the upstream `max-age` (300) and `images.minimumCacheTTL`. The Next 16 default for that is 14400. Next has no way to invalidate it. |

**Gap: the optimiser's 4-hour cache.** To bring it down to 5 minutes, set
`images.minimumCacheTTL: 300` in `next.config.ts`. That file was outside
this issue's scope. The manual proof below confirms the gap: after an
unpublish, a variant that was already cached is still served (`HIT`), and a
variant that was not cached yet returns 404.

### Responsive sizes

Use `next/image` with `src="/api/images/public/<key>"`.
`images.localPatterns` already allows `/api/images/**` with no query string.
The optimiser fetches the picture internally without cookies, so it can
only resize public pictures. A picture that is not public returns 404.

- Widths must be one of the configured sizes. With the default
  `deviceSizes`/`imageSizes` these are 16, 32, 48, 64, 96, 128, 256, 384,
  640, 750, 828, 1080, 1200, 1920, 2048 and 3840. For example, `w=800`
  returns 400. Pictures are never enlarged beyond their stored size (at most
  1200px).
- Pre-generated sizes in GCS were not chosen. They would need a schema or
  storage change and a backfill, and the optimiser already caches each
  variant.

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
