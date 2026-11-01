# Storefront shell (ZP-487)

The frame every public VYRA page renders in: header, nav, footer, the
storefront 404 and error pages, the privacy page, and the shared plumbing
the page builders (home ZP-488, collections ZP-489, product ZP-490,
about/visit ZP-491) use. Brand rules: `docs/storefront/brand-refinements.md`
(mandatory) and `docs/brand/vyra-brand-kit.md#storefront`.

## Files

| File | What |
|---|---|
| `src/app/site/layout.tsx` | The shell. Skip link, `<Header>`, `<main id="main">`, `<Footer>` (landmarks: banner, main, contentinfo). Cream ground. Fonts and `globals.css` come from the root layout. `robots: noindex` until launch. Wraps the page in `<SiteBaseProvider>`. |
| `src/app/site/not-found.tsx` (+ `not-found-content.tsx`) | Storefront 404, "This piece has moved on.", links to New Arrivals and Home (base from `useSitePath()`). Note: in Next 16.4.3 any `notFound()` page (also the admin's) is sent as a 404 whose body React renders on the client, so the 404 needs JavaScript to show; unmatched admin URLs still server-render the root 404. |
| `src/app/site/[...missing]/page.tsx` | Calls `notFound()`, so an unknown storefront URL gets the storefront 404 inside the shell (not the admin 404). Real pages are static segments and always win over it. |
| `src/app/site/error.tsx` | Client error boundary. Never shows the message, digest or stack. "Try again" (`retry()`) and "Back to home". |
| `src/app/site/privacy/page.tsx` | Short privacy notice; contact details from settings. |
| `src/lib/storefront/paths.ts` | Pure: `SITE_ROUTES`, `sitePath`, `siteBaseForHost`, `SiteBase`. Client-safe. |
| `src/lib/storefront/site-base.ts` | Server: `getSiteBase()` from the request Host header. |
| `src/lib/storefront/shell-model.ts` | Pure: `buildShellModel`, `formatOpeningHours`, `splitAddress`, `VYRA_TAGLINE`. |
| `src/lib/storefront/shell.ts` | Server: `getShellData()`. |
| `src/components/storefront/SiteBase.tsx` | Client: `SiteBaseProvider`, `useSiteBase()`, `useSitePath()`. |
| `src/components/storefront/lookbook.ts` | Typed manifest of the five lookbook photos, `lookbookImage`, `lookbookSrcSet`. |
| `src/components/storefront/LookbookImage.tsx` | `<LookbookImage stem>`: plain `<img srcset>` with width/height and alt. |
| `src/components/storefront/SocialIcons.tsx` | Row of 44px social icon links (footer, phone menu). |
| `tests/storefront-shell.test.ts` | Unit tests for the pure parts and the manifest. |
| `src/components/storefront/ShellMenu.tsx` | ZP-503: `ShellMenuProvider` (menu content for every page, set by the layout) and `ShellMenuDialog` (the full-screen menu used by the header and the landing feed). See "The menu" below. |
| `src/components/storefront/VisitDetails.tsx` | ZP-503: today's hours, week, holiday note, address, directions (menu "Visit us" and product "Try it on in store"). |
| `src/lib/storefront/menu-model.ts` | ZP-503, pure: `buildMenuModel`, `buildStoreVisit`, `todayLine`, `aboutExcerpt`, `GUIDE_PARAM`. |
| `src/lib/storefront/menu-data.ts` | ZP-503, server: `getMenuData()` (cached reads only). |
| `src/components/storefront/product/NavMemory.tsx` | ZP-503: rendered by the layout; remembers the previous in-app pathname for the product page's back button. |

## The menu (ZP-503)

`ShellMenuDialog` is a native modal `<dialog>` (rest of the page inert, Esc
closes it, the opener returns focus to its button in `onClose`). It reads its
content from `ShellMenuProvider`, which `src/app/site/layout.tsx` fills with
`getMenuData()`, so the landing feed (which has no header) and the header
show the same menu without passing data down. Content, top to bottom:

- Close button and wordmark.
- "Collections": New in (the landing feed) and each published category that
  has looks, with "N looks" (the feed's own counts: `feedProducts` +
  `feedTabs`). Every row links to the landing page, categories as
  `/?c=<slug>` (the feed follows `?c=`), from every page.
- "About VYRA": expands to the first paragraph of the About story (cut at
  180 characters) and a link to /about. No story: a plain link to /about.
- "Visit us": expands to today's hours (highlighted; worked out in the
  browser when opened, shop time zone), the week, holiday note, address,
  "Get directions" and a link to /visit. Nothing set: a plain link to /visit.
  Placeholders such as "TBC" are never shown.
- "How to use VYRA": the landing page with `?guide=1` (the feed opens the
  guide and removes the parameter, ZP-509).
- "Chat on WhatsApp" (general enquiry, `buildWhatsAppLink`); hidden without a
  number.
- A marked slot for the shop rating line (ZP-508); nothing is shown yet.
- WEAR DIFFERENT. and the social icons.

Without a provider the dialog falls back to the plain `nav` links.

## 1. Links: always `sitePath(base, SITE_ROUTES.x)`

Storefront pages live in `src/app/site/**`. On the admin/UAT host they are
served at `/site/...`; on a storefront host (`GRACE_STOREFRONT_HOSTS`) the
proxy rewrites clean paths onto them. No storefront host is configured yet,
so UAT uses `/site`. Never hard-code `/site/...` or a bare `/shop`.

```ts
// Server component (page, layout, generateMetadata)
import { SITE_ROUTES, sitePath } from '@/lib/storefront/paths'
import { getSiteBase } from '@/lib/storefront/site-base'

const base = await getSiteBase()          // "/site" or ""
sitePath(base, SITE_ROUTES.shop)          // "/site/shop" or "/shop"
sitePath(base, SITE_ROUTES.home)          // "/site" or "/"
sitePath(base, SITE_ROUTES.product(slug)) // "/site/p/<slug>" or "/p/<slug>"

// Client component (inside the storefront layout)
import { useSitePath } from '@/components/storefront'
const to = useSitePath()
to(SITE_ROUTES.collection('dresses'))
```

- `SITE_ROUTES`: `home "/"`, `shop "/shop"`, `collections "/collections"`,
  `collection(slug) "/collections/<slug>"`, `newArrivals "/new"`,
  `about "/about"`, `visit "/visit"`, `privacy "/privacy"`,
  `product(slug) "/p/<slug>"`. Slugs are URL-encoded. Build each page at the
  matching folder: `src/app/site/shop/page.tsx`, `src/app/site/collections/[slug]/page.tsx`,
  `src/app/site/new/page.tsx`, `src/app/site/p/[slug]/page.tsx`, and so on.
- `sitePath` keeps `?query` and `#hash`, leaves `https://`, `//`, `mailto:`,
  `tel:` and `#...` links alone, and never prefixes `/site/...` twice.
- `ProductCard` defaults to `/site/p/<slug>` (works on both hosts through a
  308). Pass `hrefFor={(slug) => sitePath(base, SITE_ROUTES.product(slug))}`
  to skip the redirect hop.
- `getSiteBase()` reads `headers()`, so storefront routes render
  dynamically. The data still comes from the cached reads below.

## 2. Shell data: `getShellData()`

```ts
import { getShellData } from '@/lib/storefront/shell'
const shell = await getShellData()
```

Returns `ShellData` = `ShellModel` + `{ settings: PublicSiteSettings, categories: PublicCategory[] }`:

| Field | Meaning |
|---|---|
| `base` | `"/site"` or `""` |
| `homeHref` | Prefixed home link |
| `nav` | `NavItem[]`: Shop · Collections (with `children`: All collections + each published category) · New Arrivals · About · Visit Us, all prefixed |
| `whatsappHref` | `buildWhatsAppLink(settings)` (general enquiry message), or `null` when no number is set: hide WhatsApp UI |
| `social` | `SocialLink[]`, only the profiles that are set (Instagram, Facebook, TikTok) |
| `address`, `hours` | Lines (`[]` when not set). Hours are grouped: `"Mon–Fri 09:00–17:30"`, `"Sun closed"` |
| `holidayNote`, `phone`, `email` | `string \| null` |
| `footerColumns` | Shop (Shop, New Arrivals, Collections), VYRA (About, Visit Us, Privacy) |
| `tagline` | `"WEAR DIFFERENT."` |

It only calls the existing cached reads (`getPublicSiteSettings()`,
`listPublishedCategories()`) plus `getSiteBase()`, and is wrapped in React
`cache()`, so the layout and a page can both call it in one request at no
extra cost. For a product enquiry link use
`buildWhatsAppLink(shell.settings, { product, url })`.

## 3. Brand refinements in the design system

- `Button`: `primary` = olive with white text (the default action colour).
  New `accent` = lime with ink text, for at most one accent action per page.
  Never white text on lime.
- `ColourBlock` now defaults to `tone="olive"`. `lime` stays for rare
  accents; never make whole sections lime. `Section tone="lime"` likewise.
- Tagline: `WEAR DIFFERENT.` (footer, header lockup on desktop, metadata).
  "Style your way" / "Premium fashion. Modern you." are hero campaign copy only.
- Header: wordmark letters on phones; the lockup with WEAR DIFFERENT at 200px
  (the brand-kit minimum) on desktop.
- Images: every frame already paints the quiet cream tile with the VYRA mark
  (`ImageFrame` / `ImageFallback`); a product without a photo shows only that.

## 4. Lookbook photos

```tsx
import { LookbookImage, lookbookImage, LOOKBOOK } from '@/components/storefront'

<LookbookImage stem="lime-pleated-dress" eager sizes="(min-width: 768px) 50vw, 100vw" />
<Hero layout="split" image={lookbookImage('lime-pleated-dress')} ... />
<CategoryTile image={lookbookImage('bronze-pleated-set', { alt: '' })} ... />
```

Stems: `lime-pleated-dress` (home hero), `olive-print-pleated-dress`
(about / brand band), `olive-print-jumpsuit` (visit / collections),
`chartreuse-fringe-knit-set` (collection tile), `bronze-pleated-set`
("Elegant looks" tile). The `-1200` files are not all 1200px wide, so the
srcset uses the real widths from the manifest (checked by the tests). The
photos are portrait (about 2:3 to 9:16): in a 16:9 overlay hero they crop to
a torso band, so `/site/preview` uses the split hero layout. Campaign images,
not products: never link them to a product page.

## Checks

- `/site`, `/site/privacy`, `/site/preview` (needs `GRACE_STOREFRONT_PREVIEW=true`)
  render in the shell; `/site/anything-unknown` returns 404 with the
  storefront 404; admin `/` and an unknown admin URL are unchanged.
