# Storefront home page (ZP-488)

The VYRA home page at `/site` (UAT) and `/` (storefront host). Layout after
`docs/brand/references/vyra-home-mockup.webp`, adapted for a showcase (no
cart, checkout, shipping or newsletter). Brand rules:
`docs/storefront/brand-refinements.md`.

## Files

| File | What |
|---|---|
| `src/app/site/page.tsx` | The page. Renders the blocks below; a block whose data is missing is not rendered. |
| `src/components/storefront/home/home-model.ts` | Pure: `buildHomeModel` and its helpers (section selection, hero image choice, headline accent, today's hours, map link, tile photo fallbacks, tile columns). |
| `src/components/storefront/home/home-data.ts` | Server only: `getHomeModel()`, which reads the cached data and calls `buildHomeModel`. |
| `src/components/storefront/home/HomeHero.tsx` | The hero. |
| `src/components/storefront/home/HomeSections.tsx` | Trust strip, new arrivals, collections, brand band, featured edit, visit teaser. |
| `tests/storefront-home.test.ts` | Unit tests for `home-model.ts`. |

## Blocks, top to bottom

| Block | Data | Hidden when |
|---|---|---|
| Hero | Headline `home.heroHeadline` (default "Style Your Way"), sub-line `home.heroSubline` (default "Premium fashion. Modern you."), photo (below). Buttons: olive "SHOP THE COLLECTION →" to `/shop`, ghost "NEW ARRIVALS" to `/new`. | Never |
| Trust strip | `TrustStrip` with `home.trustLabels` (Premium Quality · Visit Our Store · Enquire on WhatsApp) and thin line icons | Never |
| New arrivals | `listPublishedProducts({ newOnly: true, sort: 'newest', pageSize: 8 })`. Phones: horizontal scroll row; md+: 4-column grid. "VIEW ALL →" to `/new`. | No new arrivals |
| Explore our collections | Published categories (display order) as tall 2:3 photo tiles with the serif name and "EXPLORE →", linking to `/collections/<slug>`. 2 columns on phones; 3 or 4 from md (`collectionColumns`: whichever leaves fewer empty cells). | No published categories |
| Brand band | Cream band: VYRA wordmark, `WEAR DIFFERENT.`, italic "Fashion that fits your vibe." (no settings field exists for this line, so it is a constant, `BRAND_BAND_LINE`), and the `olive-print-pleated-dress` lookbook photo. | Never |
| Colour block | Olive `ColourBlock` with `home.statement` (default "Confidence in every stitch") and one cream button "OUR STORY →" to `/about`. | Never |
| Featured edit | `listPublishedProducts({ featuredOnly: true, pageSize: 4 })` in the default (admin) order: featured, then `sortOrder`, then newest. Editorial split: the large `olive-print-jumpsuit` lookbook photo beside 1 to 4 product cards. "VIEW ALL →" to `/shop`. | No featured products |
| Visit us | Address, today's hours (plus the holiday note), "GET DIRECTIONS" (new tab) and "ENQUIRE ON WHATSAPP" (`buildWhatsAppLink`, general message), "PLAN YOUR VISIT →" to `/visit`. Each piece shows only when set. | No address, no hours and no WhatsApp number |

All links go through `sitePath(base, SITE_ROUTES.x)`, so they work on both
front doors.

## Decisions

- **Hero photo.** Site settings hero pictures if set
  (`home.heroImageUrls`): the mobile picture is the base image and the
  desktop picture is a `<picture>` source from 768px; if only one is set it
  is used everywhere. With neither, the `lime-pleated-dress` lookbook photo.
  It is the page's only eager image (`loading="eager"`, `fetchpriority="high"`);
  every other image is lazy.
- **Hero layout.** The photos are portrait. Phones: the photo at 4:5 with the
  text below on cream (ink text; the italic accent word in olive-700, never
  lime on cream). md and up: left-weighted, after the mock-up. A deep olive
  (olive-900) ground with the text on the left, the photo filling the right
  half at full height (about 4:5 at 1280, so a 2:3 portrait shows head to
  hem, focal point `50% 12%`), and an olive-to-transparent gradient that
  blends the photo's left edge into the ground. White on olive-900 is
  12.6:1; the lime accent word on olive-900 is 5.3:1.
- **Headline accent.** The last word of the headline is set in italic
  (`splitHeadline`). A one-word headline has no accent.
- **Collection tile photo.** The category hero image; else the first photo
  of the category's first public product (default order); else a lookbook
  photo, rotating through `TILE_FALLBACK_STEMS` (chartreuse fringe set,
  bronze pleated set, olive print jumpsuit, olive print dress, lime dress) so
  neighbouring fallback tiles differ and the hero photo comes last. Tiles
  use focal point `50% 15%` so heads are not cropped. White text sits on an
  ink scrim (at least 70% under the text).
- **Today's hours.** Computed in the shop's time zone. Site settings have no
  time zone field, so `SHOP_TIME_ZONE = 'Africa/Harare'` (CAT, UTC+2, no
  daylight saving). An invalid zone falls back to it. The route is dynamic,
  so the day is the request's day.
- **Map link.** The owner's `mapUrl` if set (their exact pin); else a Google
  Maps search URL for the address (`https://www.google.com/maps/search/?api=1&query=<lines joined by ", ">`);
  else the coordinates; else no button.

## Data and freshness

`getHomeModel()` uses only the existing cached reads: `getShellData()`
(site settings and categories, React-`cache()` deduped with the layout) and
`listPublishedProducts()` (answered in memory from the single cached
catalogue entry; the per-category cover lookups are in memory too). There is
no per-visitor database query. The layout reads `headers()`, so the route is
dynamic; that is accepted.

Publishing, unpublishing or editing a product calls
`revalidateStorefront({ productSlugs })`, which expires `storefront:products`
(the catalogue), so the home page shows the change on the next request on
that instance, without a deploy. Category changes expire
`storefront:categories`; settings changes expire `storefront:settings`.
Other instances follow within the 60 s backstop
(`docs/storefront/public-data-layer.md`).
