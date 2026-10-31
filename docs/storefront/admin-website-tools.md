# Admin "Website" tools (ZP-483)

The owner prepares products for the public VYRA site inside the back office.
Everything here is **OWNER only**. Staff see no Website UI, and every
`/api/website/**` route returns 403 for them (`tests/api-permissions.test.ts`).
The tools build on the data model in [data-model.md](./data-model.md) (ZP-482).

## Where it lives

| What | Path |
| --- | --- |
| Website section in the product editor | `src/app/(admin)/products/WebsiteSection.tsx` |
| Products list: Website column, filters, bulk bar | `src/app/(admin)/products/page.tsx` |
| Categories page | `src/app/(admin)/website/categories/page.tsx` (`/website` redirects here) |
| Nav entry "Website" (owner only) | `src/components/Sidebar.tsx`, `src/components/MoreSheet.tsx` |
| Server logic | `src/lib/website/products.ts`, `categories.ts` |
| Validation (allow-lists) | `src/lib/website/validation.ts` |
| Wording, limits, statuses (client-safe) | `src/lib/website/labels.ts` |
| Preview tokens | `src/lib/website/preview-token.ts`, `preview-config.ts` |
| Cache revalidation shim | `src/lib/website/revalidate.ts` |
| Admin product routes → gallery sync | `src/lib/website/product-image-sync.ts` |
| Tests | `tests/website-admin-api.test.ts`, `tests/website-preview-token.test.ts`, `tests/website-revalidate.test.ts` |

`website` was added to `ADMIN_PAGE_SECTIONS` in `src/lib/host-routing.ts`, so
`/website/**` is a 404 on the storefront host (the host-routing test enforces
this for every admin section).

## Product status

| Status | Meaning |
| --- | --- |
| Published | `published = true`. |
| Draft | Not published, nothing missing ("Ready to publish"). |
| Not ready | Not published and something is missing: a photo, a category or a name. |

List filters: **Published**, **Draft** (everything not published) and
**Ready to publish** (Draft status only). The existing "Needs details" filter
(cost, prices, stock) is separate and still works; both can be combined.

## Rules

- **Publishing goes only through `publishProduct`.** No route accepts
  `published` or `publishedAt` from the client; PATCH refuses them with 400.
  Not ready → `422 { error, missing }`, nothing written.
- **Bulk publish/unpublish** calls `publishProduct` once per product. One
  failure never stops the rest. The response lists each product, with
  `missing` (not ready) or `error` ("Product not found", conflict).
- **Unknown fields are refused** (allow-lists in `validation.ts`). Text is
  trimmed; empty means "not set" (null). Limits: public name 120, description
  2000, colours/sizes 200, alt text 200, category name 80.
- **Slugs.** Product slugs go through `setProductSlug` (reserved words,
  duplicates, old-slug redirects). A refused slug returns
  `400 { error, field: 'slug' }` and nothing else in that request is saved.
  An untouched slug is not sent; `publishProduct` generates a unique one.
  Category slugs use `slugify`/`uniqueSlug` (generated) or the same reserved
  and duplicate checks (typed). Categories have no redirects.
- **A published product keeps a category and at least one photo.** Clearing
  the category or deleting the last photo of a published product is refused
  (400 "Unpublish it first").
- **Concurrency.** `publishProduct`, `ensureProductSlug` and `setProductSlug`
  (ZP-482 helpers, changed in ZP-483's review) and the gallery editor lock the
  product row (`SELECT … FOR UPDATE`) for the transaction. Parallel publishes
  of one product therefore agree on one `publishedAt` and the base slug, with
  no stray redirect (`tests/storefront-publish-race.test.ts`).
- **Conflicts.** P2002 (unique), P2034 (write conflict) and P2003 (foreign
  key) return `409 "Someone else just changed this – try again"`.
- **Categories** can only be deleted when empty: `409 "Move N products first"`
  with `productCount`. Publishing a category is a plain flag on the category.
  The hero image is an uploaded picture, stored as `heroImageKey`.

## Gallery

- Photos are uploaded through the existing pipeline (`POST /api/upload`: sniff,
  re-encode to WebP, content-hashed key), then added with
  `POST /api/website/products/:id/images { urls }`. The server checks the
  object exists in storage and that each URL is a stored picture.
- **The first photo is the main (primary) photo.** Moving a photo to the top
  makes it primary; "Make main" moves it to the top. The order shown is the
  storefront's (`compareGalleryImages`).
- Every change goes through the storefront-model helpers (`setPrimaryImage`,
  `ensurePrimaryImage`, `syncGalleryFromImageUrl`), so `Product.imageUrl`
  always equals the primary photo. Deleting a photo removes the gallery row
  only; files are content-hashed and may be shared.
- The product form follows the main photo chosen in the Website section, and
  its PUT sends `imageUrl` only when the picture was changed in that form, so
  a stale value cannot overwrite the main photo.
- Guidance shown: "4:5 portrait, at least 1600px, plain background". Note
  the pipeline stores at most 1200px on the longest side.

## Admin product routes (`src/app/api/products/**`)

- `PUT /api/products/:id` with `imageUrl` updates the product and calls
  `syncGalleryFromImageUrl` in the same transaction. Without `imageUrl`
  (undefined) the gallery is untouched and the behaviour is as before.
- Clearing the picture (`imageUrl: null` or `""`, the form's "Remove image")
  of a published product whose gallery would become empty is refused with
  400 "Unpublish the product before removing its last photo". With more
  photos, the next one becomes the main photo.
- `POST /api/products` with `imageUrl` now stores the picture (before, the
  create silently dropped it) and creates the primary gallery image.
- An `imageUrl` that is not a stored picture (`/api/images/<32 hex>.webp`) is
  refused with 400 on both routes. `null`/`""` clears as before.

## Preview

`POST /api/website/products/:id/preview-token` (OWNER) ensures the product has
a slug and returns `{ token, expiresAt, url }`, where `url` is
`/site/p/<slug>?preview=<token>`. The token is a JWT
`{ productId, purpose: 'preview' }`, HS256 with the session secret
(`getJwtSecret`), valid 30 minutes. `verifyPreviewToken(token)` returns
`{ productId }` or null (expired, tampered, wrong purpose, no expiry, wrong
secret). A preview token is never a valid session and vice versa.

**The storefront product page is ZP-490 and does not exist yet, so the link
404s.** `STOREFRONT_PRODUCT_PAGE_READY` in `src/lib/website/preview-config.ts`
is `false`, and the button reads "Preview (available once the product page
ships)". ZP-490 should:

- resolve the slug to a product, then call
  `verifyPreviewTokenFor(token, product.id)`, which is false for a token
  issued for another product (or expired, tampered, wrong purpose);
- send `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`
  on the preview response, so the token never lands in a shared cache or in
  another site's Referer header;
- flip `STOREFRONT_PRODUCT_PAGE_READY` to `true`.

## Revalidation

After every successful change the routes call `revalidateStorefront(scope)`
from `src/lib/website/revalidate.ts`. It is a **temporary shim** that mirrors
ZP-484's `src/lib/storefront/cache-tags.ts` exactly: the same tags
(`storefront`, `storefront:products`, `storefront:product:<slug>`,
`storefront:categories`, `storefront:category:<slug>`), the same scope
(`productSlugs`, `categorySlugs`, old **and** new slug after a rename) and
`revalidateTag(tag, { expire: 0 })`. It also never throws (outside a request,
for example in unit tests, it does nothing).

**Consolidate once ZP-484 is on master:** make the shim call ZP-484's
`revalidateStorefront`, keep the try/catch wrapper, and delete the duplicated
tag code. The admin product PUT and DELETE routes also revalidate the
product's slug. The stock adjustment route (`/api/stock-movements/adjust`) is
outside ZP-483's paths and does not revalidate yet, so an availability change
appears on the site when the cache entry is next recomputed.

## API

All routes: `authorize(request, OWNER_ONLY)`, then input validation.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/api/website/products` | | Status of every product: `{ id, status, missing, categoryName, … }[]` |
| POST | `/api/website/products/bulk` | `{ action: 'publish' \| 'unpublish', ids }` or `{ action: 'set-category', ids, categoryId }` | `{ results, succeeded, failed }` or `{ updated }` |
| GET | `/api/website/products/:id` | | Website fields, gallery, readiness, status, `newUntil` (no cost or stock) |
| PATCH | `/api/website/products/:id` | `publicName, slug, publicDescription, categoryId, priceDisplay, colours, sizes, featured` | Same as GET |
| POST | `/api/website/products/:id/publish` | `{ publish: boolean }` | `publishProduct` result, or 422 `{ missing }` |
| POST | `/api/website/products/:id/preview-token` | | `{ token, expiresAt, url }` |
| POST | `/api/website/products/:id/images` | `{ urls }` | `{ images }` |
| PUT | `/api/website/products/:id/images` | `{ order }` (every image id) | `{ images }` |
| PATCH | `/api/website/products/:id/images/:imageId` | `{ alt?, primary?: true }` | `{ images }` |
| DELETE | `/api/website/products/:id/images/:imageId` | | `{ images }` |
| GET | `/api/website/categories` | | Categories with `productCount` |
| POST | `/api/website/categories` | `{ name, slug?, description?, heroImageUrl?, published? }` | 201 category |
| PUT | `/api/website/categories` | `{ order }` (every category id) | Categories |
| PATCH | `/api/website/categories/:id` | same fields as POST | Category |
| DELETE | `/api/website/categories/:id` | | `{ success }`, or 409 "Move N products first" |

## New arrivals

Derived (ZP-482): shown as New for 30 days after the **first** publish. The
editor shows it read-only, for example "Shown as New until 1 Dec".
