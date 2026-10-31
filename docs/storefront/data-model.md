# Storefront data model (VYRA website)

ZP-482. This is the data the public VYRA showcase site needs. Customers
browse products and enquire on WhatsApp. There is no cart. The admin tools
(ZP-483) and the public data layer (ZP-484) build on this model.

- Schema: `prisma/schema.prisma` (`Product`, `Category`, `ProductImage`,
  `ProductSlugRedirect`, enum `PriceDisplay`)
- Migration: `prisma/migrations/20261101090000_storefront_website_fields`
- Rules (pure, no database): `src/lib/storefront-model/index.ts`
  (`slug.ts`, `rules.ts`). Safe to import anywhere.
- Prisma helpers (server only): `src/lib/storefront-model/db.ts`
- Tests: `tests/storefront-model.test.ts` (pure),
  `tests/storefront-model-db.test.ts` (database),
  `tests/migration-storefront-website-fields.test.ts` (opt-in migration test)

The migration does not change stock or cost data. Every existing `Product`
column is unchanged, and the migration test checks this with a checksum.

## Product: new columns

All of these columns are optional or have a default, so existing rows stay
valid. A product is not public until `published = true`.

| Column | Type | Default | Meaning |
| --- | --- | --- | --- |
| `published` | Boolean | `false` | Shown on the public site. |
| `publishedAt` | DateTime? | null | When the product was **first** published. Set with `nextPublishState`. It is kept when the product is unpublished or republished. |
| `publicName` | String? | null | Public name. Falls back to `productName` (`displayName()`). |
| `slug` | String? unique | null | URL slug. Generated from the display name (`ensureProductSlug`) and editable (`setProductSlug`). |
| `publicDescription` | String? | null | Public description text. |
| `categoryId` | Int? → `Category` | null | Category. `onDelete: Restrict`. |
| `priceDisplay` | `PriceDisplay` | `ASK_FOR_PRICE` | `SHOW_PRICE` or `ASK_FOR_PRICE`. |
| `featured` | Boolean | `false` | Featured on the home page. |
| `sortOrder` | Int | `0` | Manual order. Lower numbers come first. |
| `colours` | String? | null | Free text, for example "black, cream". Real variants come later. |
| `sizes` | String? | null | Free text, for example "S-XL". Real variants come later. |

**Public price.** Only `sellingPriceUsd` is ever public, and only with
`SHOW_PRICE`. `publicPriceUsd()` returns the price, or `null` for "ask for
price". A price of 0 (not set yet) returns `null` even with `SHOW_PRICE`.
Cost, RMB and wholesale prices are never public.

**Availability.** `getAvailability(currentQuantity, threshold = 3)` returns:

- `SOLD_OUT` when the quantity is 0 or less (or missing)
- `FEW_LEFT` when the quantity is between 1 and the threshold
- `IN_STOCK` otherwise

The public site shows the label, never the quantity.

### Decision: new arrivals are derived, not stored

There is no `isNewArrival` column. `isNewArrival(product, now,
days = NEW_ARRIVAL_DAYS)` is true when the product is published and was
first published within the last `NEW_ARRIVAL_DAYS` (30) days.

- Reason: products arrive in trips and are published as they come in. A
  derived flag needs no admin work and never goes stale. A manual flag would
  have to be cleared by hand.
- `publishedAt` is set only the first time a product is published. This
  stops an old product from becoming "new" again when it is unpublished and
  republished. Use `nextPublishState(current, publish, now)` to compute
  `published` and `publishedAt`.
- If the owner later wants a manual override, add a column then.

## Category

| Column | Type | Default |
| --- | --- | --- |
| `id` | Int | autoincrement |
| `name` | String | |
| `slug` | String unique | |
| `description` | String? | |
| `heroImageKey` | String? | Storage key, `products/<32 hex>.webp` |
| `sortOrder` | Int | `0` |
| `published` | Boolean | `false` |
| `createdAt`, `updatedAt` | DateTime | |

You cannot delete a category while any product references it
(`Product.categoryId` uses `onDelete: Restrict`, so Postgres raises a
foreign-key error). Move or clear those products first. Use `slugify` and
`uniqueSlug` for category slugs too. Categories have no redirect table.

## ProductImage (gallery)

| Column | Type | Default |
| --- | --- | --- |
| `id` | Int | autoincrement |
| `productId` | Int → `Product` | `onDelete: Cascade` |
| `imageKey` | String | Storage key, `products/<32 hex>.webp` |
| `alt` | String? | |
| `sortOrder` | Int | `0` |
| `isPrimary` | Boolean | `false` |
| `createdAt`, `updatedAt` | DateTime | |

Constraints:

- Unique `(productId, imageKey)`: the same picture appears at most once per
  product.
- Partial unique index `ProductImage_one_primary_per_product` on
  `(productId) WHERE "isPrimary"`: at most one primary image per product.
  Prisma 6 cannot declare partial indexes, so this index exists only in the
  migration SQL. `prisma migrate diff` does not report it as drift.
- Gallery order: primary first, then `sortOrder`, then `id`
  (`compareGalleryImages`, `getGallery`).

`imageKey` is the storage object key, not a URL. Convert it with
`imageUrlForKey(key)` from `src/lib/storage/keys.ts`, which gives
`/api/images/<32 hex>.webp`. The picture bytes live in local `.data/uploads`
or in GCS, as before. Deleting a `ProductImage` row does not delete the
bytes. Picture files are content-hashed and can be shared between products.

### Decision: `ProductImage` is the source of truth, `Product.imageUrl` stays

- **The storefront reads only `ProductImage`.**
- `Product.imageUrl` stays the admin's single picture, so the admin UI does
  not change.
- Invariant: if a product has gallery images, exactly one of them is primary
  and `Product.imageUrl` is that image's URL.

Helpers in `src/lib/storefront-model/db.ts` keep the two in sync. Each one
accepts a `PrismaClient` or an open transaction, and runs in a transaction:

| Helper | Use it when | Effect |
| --- | --- | --- |
| `syncGalleryFromImageUrl(db, productId, imageUrl)` | `Product.imageUrl` was changed (admin form, import). Call it in the same transaction. | A stored picture URL becomes the primary image and replaces the previous primary row. Other gallery images stay. `null`/`""` removes the primary row, promotes the next image and writes its URL back to `imageUrl` (or `null`). A URL that is not from our storage leaves the gallery alone and returns `synced: false`. |
| `setPrimaryImage(db, productId, imageId)` | The gallery editor picks a new primary (ZP-483). | Demotes the old primary and keeps it in the gallery. Writes the new primary's URL to `imageUrl`. Throws if the image belongs to another product. |
| `ensurePrimaryImage(db, productId)` | After images are added or removed, or to backfill one product. | Repairs "no primary" or "several primaries", and syncs `imageUrl`. A product with no gallery images but a stored `imageUrl` gets it as its primary image, by the same rule as the migration. Idempotent. |

Callers today:

- The August import (`src/lib/import/august-trip/prisma-store.ts`) calls
  `syncGalleryFromImageUrl` when it creates a product with a picture or
  attaches one.
- **Not yet wired up:** the admin product create (POST) and edit (PATCH)
  routes in `src/app/api/products/**`. They were outside ZP-482's scope.
  Until ZP-483 calls `syncGalleryFromImageUrl` there, a picture changed in
  the admin does not reach the gallery. `ensurePrimaryImage` repairs any
  product afterwards.

### Migration backfill

The migration inserts one primary `ProductImage` (`sortOrder 0`) for each
product whose `imageUrl` matches `/api/images/%`. The key is extracted as
`'products/' || substring(imageUrl from 13)`. The SQL also requires the
exact storage format `^/api/images/[a-f0-9]{32}\.webp$`, so every `imageKey`
is valid for `src/lib/storage/keys.ts`. Any other `imageUrl` is left alone.

The backfill is idempotent. It skips products that already have a gallery
image, and the `(productId, imageKey)` unique index turns a repeat into a
no-op. The statement sits between `-- BEGIN backfill` and `-- END backfill`
in the migration. The migration test runs it a second time and checks that
it inserts 0 rows.

## ProductSlugRedirect

| Column | Type |
| --- | --- |
| `id` | Int |
| `oldSlug` | String unique |
| `productId` | Int → `Product` (`onDelete: Cascade`) |
| `createdAt` | DateTime |

Rules (`planSlugChange` holds the pure logic, `setProductSlug` applies it):

- Slugs are lowercase ASCII words joined by single hyphens, at most 80
  characters (`slugify`, `isValidSlug`). Accents are folded ("Crème" →
  "creme"). Other scripts are dropped. A name with nothing usable, such as a
  Chinese-only name, gives `""`, and `uniqueSlug` then falls back to
  `product`.
- `uniqueSlug(base, exists)` appends `-2`, `-3`, and so on, and stays within
  80 characters. `exists` must cover live slugs **and** old redirect slugs.
  `ensureProductSlug` does this.
- When a slug changes, the previous slug becomes a redirect to the
  **product**, not to a slug. Redirects therefore never chain. After several
  renames, every old slug still points at the product's current slug.
- No slug is ever both live and a redirect. When a product goes back to one
  of its own old slugs, that redirect is deleted. This prevents loops.
- A slug that another product uses, live or as an old address, is refused.
  This keeps other products' old links working. A deleted product's
  redirects are deleted with it (cascade), so its slugs become free.
- Setting the current slug again does nothing.
- `resolveProductSlug(db, slug)` returns `{ productId, slug, redirected }`,
  where `slug` is the canonical slug to redirect to, or `null`. It does
  **not** check `published`. The public data layer (ZP-484) must check it.

## Publish readiness

`getPublishReadiness({ productName, publicName, images, category })` returns
`{ ready, missing }`. `missing` lists, in this order:

- `'display name'`: `publicName` and `productName` are both blank.
- `'image'`: there is no `ProductImage`. `imageUrl` alone does not count.
- `'category'`: the category relation is not loaded or not set.

Load `images` and `category` with the product. The function does not check
whether the category itself is published. The public site should hide
products whose category is unpublished.

This check is separate from the admin's "needs details" check in
`src/lib/product-completeness.ts`. That check is about cost, retail price,
wholesale price and quantity, and this one does not change it.

## Delete behaviour

- Deleting a product cascades to its `ProductImage` and
  `ProductSlugRedirect` rows.
- The existing admin `DELETE /api/products/:id` still fails for any product
  with stock movements or sale items. Those foreign keys are unchanged, and
  in practice they block most deletes.
- Deleting a category that products reference fails (`Restrict`).
