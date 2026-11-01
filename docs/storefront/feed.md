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
| `src/components/storefront/feed/FlipFeed.tsx` | Client: the feed, top bar, collection pill, clean view, keyboard, end slide, URL state, menu. |
| `src/components/storefront/feed/FeedSlide.tsx` | Client: one look (photos, progress bars, "Show details" eye, caption, rail). |
| `src/components/storefront/feed/CollectionSheet.tsx` | Client: the collections bottom sheet. |
| `src/components/storefront/feed/StorefrontFrame.tsx` | Layout flag: no header/footer on the landing page. |
| `src/lib/storefront/feed-guide.ts` | Pure (ZP-509): guide "seen" storage, when it opens, `?guide=1`, steps and copy, ring position. Tested in `tests/storefront-feed-guide.test.ts`. |
| `src/components/storefront/feed/FeedGuide.tsx` | Client (ZP-509): the first-visit guide dialog. |
| `src/lib/storefront/feed-media.ts` | Pure (ZP-502): strip / gallery item list with the video first, autoplay and preload rules. Tested in `tests/storefront-feed-media.test.ts`. |
| `src/components/storefront/video/*` | Client (ZP-502): `FeedVideo` (strip item), `GalleryVideo` (product page), `useVideoPlayback`. See `docs/storefront/videos.md`. |
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
- ZP-502: the slide DTO also carries the piece's public video
  (`video: { src, poster, width, height } | null`, copied field by field
  with `pickVideo`; nothing else from the DTO).

## Order (`orderFeed`, `feedProducts`)

Input is the catalogue's "newest" sort (newest published first). Output:

1. available featured pieces,
2. the other available pieces (newest first),
3. sold-out pieces (featured first there too).

## Collections (`feedTabs`, `filterFeed`, `resolveFeedTab`)

- **New in** (every piece, in feed order) plus one collection per published
  category that has at least one piece, in category display order, each with
  its number of looks (`looksLabel`: "1 look", "N looks").
- There is no tab row on the photo. The top bar's right side is a small
  rounded pill with the current collection's name and a chevron ("NEW IN ▾",
  `aria-haspopup="dialog"`, named "Collection: New in. Change collection").
  It opens a cream bottom sheet (`CollectionSheet`, a native modal dialog):
  a "Collections" heading (which labels the dialog), one row per collection
  with "N looks", the current one highlighted and `aria-current="true"`.
  Opening it focuses the current row; focus stays in the sheet and returns
  to the pill when it closes. Picking a row closes the sheet and switches the
  feed. Escape closes it, and so does a tap on the backdrop (only when both
  pointerdown and click land on the backdrop, so a drag that starts inside
  the sheet never closes it). The pill is hidden when there is only New in.
- Visit us is in the menu and on the end slide (and on the rail when no
  WhatsApp number is set); the top bar no longer has the pin.
- The tab is in the URL: `?c=<category-slug>` (none for New in). An unknown
  value falls back to New in.
- Switching collection is client-side: a server action returns the first page of
  that collection and `history.replaceState` updates `?c=`. The pill and
  the current row change only when the looks arrive, so collection and
  looks never disagree; if the action fails, the page falls back to a full load of `/?c=<tab>`.
- A soft navigation to the page (new server props, or `?c=` changed by a
  link) resets the feed to that tab and its first slide.

## Paging (`feedPage`)

- The first 12 slides are rendered on the server (`FEED_PAGE_SIZE`).
- Three slides before the end, the next 12 are fetched with
  `loadFeedAction`. A "Loading more looks" slide sits at the end until the
  last page has arrived; then the end slide shows.
- `through: <slug>` extends a load by whole pages until it contains that
  slide (used when returning to a slide beyond the first page), capped at
  `FEED_MAX_THROUGH` (96 pieces, 8 pages) per load. A remembered slide
  further down is not restored; the feed opens at the start of that load.
- If "load more" fails, the loading slide shows "We could not load more
  looks" and a **Try again** button. After a deploy ("Failed to find Server
  Action"), the page reloads the current URL instead.
- The action checks its input (tab string, finite offset, valid slug) and
  clamps offset/limit (max 48).

## Slide

- Photos side by side with horizontal scroll snap; thin progress bars just
  under the top bar (68px from the top) when there is more than one photo;
  on mouse devices, previous/next photo buttons.
- A look goes back to its first photo once it is fully off screen: each
  slide has an IntersectionObserver, and when its intersection ratio drops
  to 0 its own strip is set to `scrollLeft = 0` (instant) and its progress
  bars reset. Nothing changes halfway through a swipe, and a swipe that
  snaps back keeps the photo. Coming back to a look always starts on photo 1.
  Switching collection remounts the slides (keyed per collection), so they
  start on photo 1 too.
- Top: a light scrim (130px, 50% ink at the top) behind the slim top bar
  (menu, wordmark, collection pill), which always shows.
- ZP-502: when the piece has a video, it is the **first item** of the strip,
  then the photos; the progress bars count it. Muted, looping, inline; only
  the visible slide's visible strip item plays. Details (preload, poster as
  LCP, reduced motion / Save-Data, fallbacks) in `docs/storefront/videos.md`.

## First-visit guide (ZP-509)

On the first visit, over the first look, a native modal `<dialog>`
(`FeedGuide`, `showModal`) with a see-through dark layer (70% ink backdrop)
and an animated finger (SVG, the design's `vy-anim-*` keyframes, hoisted
once with a React `<style href precedence>`):

| Step | Phones | Computers (md and up, fine pointer) | Finger |
| --- | --- | --- | --- |
| 1 | **Swipe up** – "Flick up for the next look, down to go back." | **Next look** – "Scroll or press ↓ for the next look" | moves up |
| 2 | **Swipe sideways** – "Swipe left and right for more photos of the same piece." | **More photos** – "Click the arrows or swipe for more photos" | moves sideways |
| 3 | **Tap for details** – "Tap the eye for the price and buttons. Tap the photo to open the piece." | **Click for details** – "Click the eye for the price and buttons. Click the photo to open the piece." | taps the eye |

- Step 3: the fingertip and a pulsing ring are placed on the **real** eye
  button of the look on screen (its `[data-feed-eye]` rect, measured, again
  on resize; `guideRing`), not hard-coded.
- Controls: "1 of 3" (lime-200), dots, **Skip**, **Next** / **Got it**
  (olive). Tapping the layer advances; doing the step's gesture on it (a
  swipe up on step 1, sideways on step 2, the mouse wheel down on step 1)
  completes that step (the click that ends a recognised mouse drag is
  ignored, so a drag advances one step; the dialog has `touch-action: none`
  and `overscroll-behavior: contain`). A `close` event that arrives while the
  dialog is open again (dev Strict Mode re-running the mount effect) is ignored.
- Dialog semantics: labelled by the step title, described by "n of 3" and
  the body (an `aria-live` region, so step changes are announced); focus
  moves to Next and stays in the dialog; the feed behind is inert;
  **Escape skips**; focus returns where it was (else to the feed).
- `prefers-reduced-motion`: no animation; a still finger with arrows
  (up / left-right), the ring stays still.
- Contrast: cream text and the lime-200 step label stay above 4.5:1 even
  over a white photo (70% ink layer plus a text shadow); Next is cream on olive.
- **When**: only on the landing feed (`FlipFeed`), decided after hydration
  (nothing in the server HTML; the swipe hint waits for it). "Seen" is
  `localStorage` `vyra:feed:guide` = `seen`, written when the guide is
  finished, skipped or closed (read and written in try/catch: storage
  unavailable means it shows again next time). Never when the page opens on
  a `#look-<slug>` hash (shared look, back from a product page) and never
  when there are no looks.
- **Replay** (contract with the menu, ZP-503): `/?guide=1` (also a soft
  navigation while on the page) scrolls to the first look and opens the
  guide even if seen, then removes `guide` from the URL with the safe
  `replaceState` wrapper (other parameters and the hash kept).

### Clean view and "Show details"

- The feed opens on the clothes alone: no caption, no rail, no bottom scrim.
  An eye button at the bottom right reads **Show details**. Its accessible
  name is always "Show details" and `aria-pressed` gives the state.
  Tapping it shows the caption and the rail on every slide; the visible text
  then reads **Hide** (`aria-pressed="true"`).
- The choice is kept in `sessionStorage` (`vyra:feed:details`, "shown" or
  "hidden"; read and written in try/catch, `parseDetailsPreference`), so it
  holds while browsing and when coming back from a product page. A new
  session starts in clean view.
- In clean view each slide's first photo link is in the tab order and named
  "<name>, <price>[, <tag>]. View details" (`photoLinkLabel`), and an
  sr-only `<h2>` keeps the look's heading, so keyboard and screen reader
  users still get the name, price and tag and reach the product page.
- The first-slide swipe hint shows after the first-visit guide (below),
  until the first scroll. While it shows, the caption and the rail sit higher (48px from the bottom) so they
  never touch it.

### With details

- Caption at the very bottom (16px from the left, clear of the rail): the
  name on one line in serif (21px, ellipsis), then price or "Ask for price",
  tag (Sold out, else Few left, else New) and "· Tap for details". The whole
  caption is one link to the product page.
- A light, short bottom scrim (190px, up to 72% ink; at least 62% behind the
  caption, plus a text shadow).
- ZP-507: a **heart** sits directly above the eye, in clean view too ("Love",
  or the number from 3 loves; see `docs/storefront/hearts.md`). The eye stays
  at the bottom of the rail, so it does not move when details open.
- Rail, above the heart: **Enquire** (wa.me link from `buildWhatsAppLink` with the owner's
  enquiry template, via `productEnquiryHref`), or **Restock** for sold-out
  pieces (`RESTOCK_TEMPLATE`: "Hi VYRA, please let me know when the
  {product} is back in stock. ({url})", also through `buildWhatsAppLink`).
  No WhatsApp number set: **Visit us** (link to `/visit`) instead. **Share**
  (Web Share API, else copy link; hidden when there is no absolute URL).
  **Details**.
- The photos, the caption and Details are real `<a href>` links to
  `/p/<slug>` (via `sitePath`).

## End slide

"You have seen every look in *<collection>*", WEAR DIFFERENT., "Back to the
first look" (scrolls to the top) and "Visit our store". With no published
pieces: "New looks are on their way" and "Visit our store".

## Returning to the same slide

The current slide is kept in the URL hash, `#look-<slug>` (each slide has
that id), written with `history.replaceState` 250 ms after the slide stops
changing (not for every slide crossed: Safari throws after 100 history calls
in 10 seconds; the call is also wrapped in try/catch), and at once when the
visitor opens a product page (no hash on the first slide). Browser back
from a product page lands on
`/?c=<tab>#look-<slug>`; on mount the feed switches to that tab if needed,
loads through that slug if it is beyond the first page, and jumps there
without animation. A shared `/#look-<slug>` link opens on that look. The
current slide is then read from the scroll position (the browser may have
scrolled to the anchor before hydration, which fires no scroll event).

## Phones and computers

- Phones: the feed fills the screen. The frame is `100svh` high (`100vh`
  where svh is unsupported) and the document never scrolls (the feed scrolls inside itself and the page locks
  `html` overflow while mounted), so on iOS the URL bar does not collapse
  and nothing jumps.
- md (768px) and up: the same feed in a centred phone-shaped column (9:16,
  viewport height minus 32px) on cream, with up/down buttons beside it.
- Scroll snap: `scroll-snap-type: y mandatory` with
  `scroll-snap-stop: always` (one look per flick, wheel or trackpad).
- Keyboard: the feed is focusable (`tabindex=0`, labelled region) and is
  focused on load on computers (fine pointer, md and up) without scrolling.
  Up/Down,
  Page Up/Down, Space (on the feed itself), Home and End move between
  slides. Keys are handled on the feed element only (no global keydown).
- `prefers-reduced-motion`: every programmatic scroll is instant.
- "Swipe up for the next look" shows once the first-visit guide is done (or
  was not shown), until the first scroll.

## Header and footer

The landing page has no site header or footer. `StorefrontFrame`
(`src/app/site/layout.tsx`) drops them when `useSelectedLayoutSegment()` is
null and the pathname is a home path (`/site` or `/`). It is decided from the
router tree on the server and the client alike, so there is no flash. Every
other storefront page, including the 404, keeps the header and footer. The
menu button in the feed opens the same storefront menu (`ShellMenuDialog`).

## Accessibility

The top bar (menu, wordmark, collection pill) comes before the feed in DOM
and tab order, and is drawn on top. Each slide is an `<article>` labelled by
its name (not a landmark), with "Look n of N" for screen readers; the end and
loading slides are labelled groups. Photo links fall back to "<name>, photo
n of N" when a photo has no alt text. Over the cream end slide (also with no
pieces at all) the overlay turns ink. The wordmark is
the page's `<h1>`. The eye button uses `aria-pressed`; the current
collection row uses `aria-current`. All controls are real links/buttons with the storefront focus
ring. Small text on the photo sits on at least 60% ink (the caption on the
bottom scrim, the pill on the top scrim plus its own tint), so cream text
stays at least 4.5:1 on light photos.

## Performance and SEO

- With a video first, its poster `<img>` takes the first photo's place
  (eager, and `fetchpriority="high"` on slide 1: the LCP), and the video
  itself is `preload="none"` in the server HTML.
- The first slide's first photo is eager with `fetchpriority="high"`; the
  second slide's first photo is eager (normal priority), ready for the first
  flick; every other photo is `loading="lazy"`.
- Real `<a href>` links to each product page are in the server HTML.
- The page stays `noindex` and takes its title from the layout template.
