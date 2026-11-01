# Storefront listing pages (ZP-489)

The product listings of the VYRA site: `/shop`, `/collections`, `/collections/<slug>`
and `/new`. Brand rules: `docs/storefront/brand-refinements.md`. Shared plumbing:
`docs/storefront/shell.md`. Data: `docs/storefront/public-data-layer.md`.

## Routes

| Route | Page file | Shows |
|---|---|---|
| `/shop` | `src/app/site/shop/page.tsx` | Every published product. Header photo: lookbook `olive-print-jumpsuit`. |
| `/collections` | `src/app/site/collections/page.tsx` | Published categories as photo tiles (category hero, else a lookbook photo), with a piece count. Empty state when there are none. |
| `/collections/<slug>` | `src/app/site/collections/[slug]/page.tsx` | One published category: name, description, hero image (hidden when not set). |
| `/new` | `src/app/site/new/page.tsx` | New arrivals only (`isNew`: first published within `NEW_ARRIVAL_DAYS`). Header photo: lookbook `chartreuse-fringe-knit-set`. |

On the admin/UAT host these are served under `/site/...`; every link goes
through `sitePath(base, SITE_ROUTES.x)`.

## Query (`?sort=newest&soldout=hide&page=2`)

| Param | Values | Default |
|---|---|---|
| `sort` | `featured`, `newest`, `price-asc`, `price-desc` | `featured` |
| `soldout` | `hide` | shown |
| `page` | `1`-`1000` | `1` |

- Parsing is lenient (`parseListingQuery`): unknown parameters are ignored and any
  invalid value (`sort=name`, `page=abc`, `page=0`, `soldout=1`) falls back to its
  default. A repeated parameter uses its first value. Never a 400 or 500.
- Links omit defaults and use a fixed order (`listingHref`).
- **Out-of-range page: redirect (307) to the last page**, keeping sort and filter
  (page 1 without `page` when the list is empty). Chosen over 404 so an old
  `page=3` link still lands somewhere useful after pieces sell or are unpublished.
- **Price sorts** are offered, and applied, only when every product in view
  (the filtered set across all pages, after "Hide sold out") shows a price
  (`PublicProductPage.allPriced`). Otherwise a `price-*` URL silently falls
  back to `featured`, so the order never hints at a hidden price.
- **Unknown, invalid or unpublished category slug: `notFound()`** (storefront 404).
  Categories have no slug redirects in the data model, so there is no redirect case.
- The canonical URL (`alternates.canonical`) is the page's path on the site base,
  absolute from the request Host / `X-Forwarded-Proto`, and never carries the query.

## Page layout

1. Header (`ListingHeader`): lime rule, small label, serif title, optional
   description; the photo sits beside it on desktop and as a 16:10 band on phones,
   cropped toward the top. The photo is the eager (LCP) image.
2. Filter row (`ListingFilters` on the shared `FilterBar`): category chips
   (All, New arrivals, each published category; links that keep sort and filter,
   horizontal scroll on phones), the piece count, a "Hide sold out" link-toggle and
   the sort select. The select navigates with JavaScript; a `<noscript>` row of
   sort links replaces it without JavaScript. The row is hidden when the listing is
   empty, unless "Hide sold out" is on (so it can be turned off).
3. Grid: `ProductGrid` (2 / 3 / 4 columns) of `ProductCard` (NEW, Few left,
   Sold out badges; price or ASK FOR PRICE), linking to
   `sitePath(base, SITE_ROUTES.product(slug))`.
4. Pages of 24 (`LISTING_PAGE_SIZE`): `Pagination` with Previous / numbered /
   Next plain links (first, last, current ±1, gaps), hidden for one page.
5. Empty state (`ListingEmpty`): "New pieces are on their way. Ask us on
   WhatsApp what's arriving." with an "Ask on WhatsApp" button
   (`shell.whatsappHref`, i.e. `buildWhatsAppLink`), hidden when no number is set.

## Data and caching

All data comes from the public data layer: `listPublishedProducts` and
`getPublishedCategory` (`src/lib/storefront`), plus `getShellData()` for the
categories, base and WhatsApp link. Filtering, sorting and paging run in memory
over the one cached catalogue entry; no request adds a cache entry or runs a
database query of its own (checked in `tests/storefront-collection-db.test.ts`).
The `/collections` counts are `listPublishedProducts({ categorySlug, pageSize: 1 }).total`
(same cached entry).

## Files

| File | What |
|---|---|
| `src/lib/storefront/listing-query.ts` | Pure: query parsing, `listingHref`, sort options and the price rule, `resolvePage`, `pageWindow`, `canonicalUrl`, `requestOrigin`, `loadListing` (notFound / redirect / ok). |
| `src/lib/storefront/listing-page.ts` | Server: `getListingView` (calls `notFound()` / `redirect()`, builds chips), `listingMetadata` (title, description, canonical). |
| `src/components/storefront/collection/*` | `ListingPage`, `ListingHeader`, `ListingFilters` (client), `Pagination`, `ListingEmpty`, `CollectionTiles`. |
| `tests/storefront-collection.test.ts` | Pure tests (parsing, links, price rule, paging, redirects, 404 for unknown slugs). |
| `tests/storefront-collection-db.test.ts` | DB: unknown and unpublished categories 404; bounded cache entries. |

Shared files changed (additive): `src/lib/storefront/catalogue.ts` (`allPriced` on
`PublicProductPage`, so also in `GET /api/public/products`),
`src/components/storefront/FilterBar.tsx` (chips with `href` render as links;
optional `extra` slot).
