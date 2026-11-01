# Landing page: the flip feed (ZP-500)

The storefront landing page (`/` on a storefront host, `/site` on UAT) is a
full-screen vertical feed: **one published piece per screen**. Flick up or
down to move one look at a time; swipe sideways through that piece's photos.
It replaces the ZP-488 home sections (the files in
`src/components/storefront/home/*` are no longer used by the page; their
pure model and tests stay).

## Files

| File | What it does |
| --- | --- |
| `src/app/site/page.tsx` | Server page: reads `?c=`, loads the first 12 slides, renders `FlipFeed`. |
| `src/lib/storefront/feed.ts` | Pure: order, tabs, tab filter, paging, slide DTO, URL state. Tested in `tests/storefront-feed.test.ts`. |
| `src/lib/storefront/feed-data.ts` | Server only: builds the feed from the cached catalogue, categories and settings. |
| `src/lib/storefront/feed-actions.ts` | Server action `loadFeedAction` for "load more" and tab switches. |
| `src/components/storefront/feed/FlipFeed.tsx` | Client: the feed, overlay, tabs, keyboard, end slide, URL state, menu. |
| `src/components/storefront/feed/FeedSlide.tsx` | Client: one look (photos, progress bars, info, rail). |
| `src/components/storefront/feed/StorefrontFrame.tsx` | Layout flag: no header/footer on the landing page. |
| `src/components/storefront/ShellMenu.tsx` | The storefront menu dialog, moved out of `Header` so the feed opens the same menu (ZP-503 redesigns it). |
| `src/components/storefront/product/useShare.ts` | Share logic (Web Share API, else copy link), shared by `ShareButton` and the feed. |

## Data

- Public DTOs and the cached catalogue only (`listPublishedProducts`,
  `listPublishedCategories`, `getPublicSiteSettings`). No new cache entries,
  no per-visitor database query, no private fields. The slide DTO
  (`FeedItem`) carries only slug, name, category name, display price, tag,
  sold-out flag, photo `src`/`srcSet`/`alt`, product link, absolute share URL
  and the WhatsApp link.
- Pieces without a photo are left out (the feed is photo-first).
- No dependency on the product video field (ZP-501).

## Order (`orderFeed`, `feedProducts`)

Input is the catalogue's "newest" sort (newest published first). Output:

1. available featured pieces,
2. the other available pieces (newest first),
3. sold-out pieces (featured first there too).

## Tabs (`feedTabs`, `filterFeed`, `resolveFeedTab`)

- **New in** (every piece, in feed order) plus one tab per published category
  that has at least one piece, in category display order. The tabs row is
  hidden when there is only New in.
- The tab is in the URL: `?c=<category-slug>` (none for New in). An unknown
  value falls back to New in.
- Switching tabs is client-side: a server action returns the first page of
  that tab and `history.replaceState` updates `?c=`.

## Paging (`feedPage`)

- The first 12 slides are rendered on the server (`FEED_PAGE_SIZE`).
- Three slides before the end, the next 12 are fetched with
  `loadFeedAction`. A "Loading more looks" slide sits at the end until the
  last page has arrived; then the end slide shows.
- `through: <slug>` extends a load by whole pages until it contains that
  slide (used when returning to a slide beyond the first page).
- The action checks its input (tab string, finite offset, valid slug) and
  clamps offset/limit (max 48).

## Slide

- Photos side by side with horizontal scroll snap; thin progress bars when
  there is more than one photo; on mouse devices, previous/next photo buttons.
- Overlay: category label, serif name, price or "Ask for price", tag
  (Sold out, else Few left, else New), "View details".
- Rail: **Enquire** (wa.me link from `buildWhatsAppLink` with the owner's
  enquiry template, via `productEnquiryHref`), or **Restock** for sold-out
  pieces (`RESTOCK_TEMPLATE`: "Hi VYRA, please let me know when the
  {product} is back in stock. ({url})", also through `buildWhatsAppLink`).
  No WhatsApp number set: **Visit us** (link to `/visit`) instead. **Share**
  (Web Share API, else copy link; hidden when there is no absolute URL).
  **Details**.
- The photo, "View details" and Details are real `<a href>` links to
  `/p/<slug>` (via `sitePath`).

## End slide

"You have seen every look in *<collection>*", WEAR DIFFERENT., "Back to the
first look" (scrolls to the top) and "Visit our store". With no published
pieces: "New looks are on their way" and "Visit our store".

## Returning to the same slide

The current slide is kept in the URL hash, `#look-<slug>` (each slide has
that id), written with `history.replaceState` as the visitor scrolls (no hash
on the first slide). Browser back from a product page lands on
`/?c=<tab>#look-<slug>`; on mount the feed switches to that tab if needed,
loads through that slug if it is beyond the first page, and jumps there
without animation. A shared `/#look-<slug>` link opens on that look.

## Phones and computers

- Phones: the feed fills the screen. The frame is `100svh` high and the
  document never scrolls (the feed scrolls inside itself and the page locks
  `html` overflow while mounted), so on iOS the URL bar does not collapse
  and nothing jumps.
- md (768px) and up: the same feed in a centred phone-shaped column (9:16,
  viewport height minus 32px) on cream, with up/down buttons beside it.
- Scroll snap: `scroll-snap-type: y mandatory` with
  `scroll-snap-stop: always` (one look per flick, wheel or trackpad).
- Keyboard: the feed is focusable (`tabindex=0`, labelled region). Up/Down,
  Page Up/Down, Space (on the feed itself), Home and End move between
  slides. Keys are handled on the feed element only (no global keydown).
- `prefers-reduced-motion`: every programmatic scroll is instant.
- "Swipe up for the next look" shows until the first scroll.

## Header and footer

The landing page has no site header or footer. `StorefrontFrame`
(`src/app/site/layout.tsx`) drops them when `useSelectedLayoutSegment()` is
null and the pathname is a home path (`/site` or `/`). It is decided from the
router tree on the server and the client alike, so there is no flash. Every
other storefront page, including the 404, keeps the header and footer. The
menu button in the feed opens the same storefront menu (`ShellMenuDialog`).

## Accessibility

Each slide is a `<section>` labelled by its name, with "Look n of N" for
screen readers; the end slide is labelled by its heading. The wordmark is
the page's `<h1>`. Tabs are buttons with `aria-pressed`. All controls are
real links/buttons with the storefront focus ring. Scrims keep at least 65%
ink behind every line of overlay text, so cream text is at least 4.5:1 on
any photo.

## Performance and SEO

- Only the first slide's first photo is eager with `fetchpriority="high"`;
  every other photo is `loading="lazy"`.
- Real `<a href>` links to each product page are in the server HTML.
- The page stays `noindex` and takes its title from the layout template.
