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
| `src/lib/storefront/feed-sheet.ts` | Pure (ZP-510): details sheet URL / history rules (`?d=`), height, drag, "More" pill, extras DTO, content model. Tested in `tests/storefront-feed-sheet.test.ts`. |
| `src/lib/storefront/feed-sheet-data.ts`, `feed-sheet-actions.ts` | Server (ZP-510): the sheet's extras for one piece, and the server action that returns them. |
| `src/components/storefront/feed/DetailsSheet.tsx` | Client (ZP-510): the details bottom sheet. |
| `src/components/storefront/feed/StorefrontFrame.tsx` | Layout flag: no header/footer on the landing page. |
| `src/lib/storefront/feed-guide.ts` | Pure (ZP-509): guide "seen" storage, when it opens, `?guide=1`, steps and copy, ring position. Tested in `tests/storefront-feed-guide.test.ts`. |
| `src/components/storefront/feed/FeedGuide.tsx` | Client (ZP-509): the first-visit guide dialog. |
| `src/lib/storefront/feed-media.ts` | Pure (ZP-502): strip / gallery item list with the video first, autoplay and preload rules. Tested in `tests/storefront-feed-media.test.ts`. |
| `src/components/storefront/video/*` | Client (ZP-502): `FeedVideo` (strip item), `GalleryVideo` (the /site/preview component gallery), `useVideoPlayback`. See `docs/storefront/videos.md`. |
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

ZP-506: the feed is ordered by the nightly **popularity ranking**
(`docs/storefront/ranking.md`): available pieces by today's rank (pieces
published since the last run first), sold-out pieces last. With the admin
switch on "Newest first", or while there is too little data, it is newest
first (sold-out last). Featured no longer has precedence: it is itself set
automatically by the ranking. Input is the catalogue's "newest" sort;
`feedProducts(products, ranking)` with the cached `getFeedRanking()`.

Before ZP-506 (still `orderFeed`, used without a ranking):

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
  under the top bar (68px from the top) when there is more than one photo.
  Previous / next photo buttons on every device (`photoNav`): small round
  pills beside the progress bars (82px from the top, left and right edge),
  so they never sit under the rail; "Next photo" only when there is a next
  item, "Previous photo" only after the first. Swiping stays the main gesture.
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
  (nothing in the server HTML). "Seen" is
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

- The feed opens on the clothes: no caption, no bottom scrim, and a short
  rail (owner, after the Samsung test): the WhatsApp button (WhatsApp / Restock,
  or Visit us), Call (ZP-510, when a phone is set), the heart and the eye. The eye at the bottom right reads
  **Show details**. Its accessible
  name is always "Show details" and `aria-pressed` gives the state.
  Tapping it shows the caption, Share and Details on every slide; the visible text
  then reads **Hide** (`aria-pressed="true"`).
- The choice is kept in `sessionStorage` (`vyra:feed:details`, "shown" or
  "hidden"; read and written in try/catch, `parseDetailsPreference`), so it
  holds while browsing and when coming back from a product page. A new
  session starts in clean view.
- In clean view each slide's first photo link is in the tab order and named
  "<name>, <price>[, <tag>]. View details" (`photoLinkLabel`), and an
  sr-only `<h2>` keeps the look's heading, so keyboard and screen reader
  users still get the name, price and tag and reach the product page.
- "Swipe up for the next look" (a small chevron and text, 80% cream with a
  text shadow) shows at the bottom of **every** look, always (owner), not on
  the end slide. It sits on the safe bottom (`max(env(safe-area-inset-bottom),
  12px)`); the caption and the rail sit 38–40px above it, in clean view and
  with details.

### With details

- Caption at the very bottom (16px from the left, clear of the rail): the
  name on one line in serif (21px, ellipsis), then price or "Ask for price",
  tag (Sold out, else Few left, else New) and "· Tap for details". The whole
  caption is one link to the product page.
- A light, short bottom scrim (190px, up to 72% ink; at least 62% behind the
  caption, plus a text shadow).
- The rail, top to bottom (`railItems`): **Share**, **Details** (with details
  only), the WhatsApp button, the **heart** (ZP-507: "Love", or the number from
  3 loves; see `docs/storefront/hearts.md`), the **eye**. The WhatsApp button,
  heart and eye always show; the eye stays at the bottom, so it never moves
  (the guide's step 3 ring measures the real eye, so it follows).
- The WhatsApp button: **Enquire** (wa.me link from `buildWhatsAppLink` with the owner's
  enquiry template, via `productEnquiryHref`), or **Restock** for sold-out
  pieces (`RESTOCK_TEMPLATE`: "Hi VYRA, please let me know when the
  {product} is back in stock. ({url})", also through `buildWhatsAppLink`).
  No WhatsApp number set: **Visit us** (link to `/visit`) instead. **Share**
  (Web Share API, else copy link; hidden when there is no absolute URL).
  **Details**.
- The photos, the caption and Details are real `<a href>` links to
  `/p/<slug>` (via `sitePath`). ZP-510: a plain tap on any of them opens the
  details sheet instead (below); a middle / modifier click still opens the
  full page in a new tab, and without JavaScript the links work as before.

### Rail: WhatsApp and Call (ZP-510, owner-approved)

- The rail on **every** look, clean view too, top to bottom (`railItems`):
  [Share, Details: with details only], **WhatsApp**, **Call**, the heart, the eye.
- WhatsApp: the official WhatsApp logo (`WhatsAppLogoIcon`, Simple Icons
  "whatsapp" path, CC0) in white on a 50px #25D366 circle with a subtle
  shadow, labelled **WhatsApp** (**Restock** for sold-out pieces,
  `railWhatsAppLabel`). No WhatsApp number set: **Visit us** as before.
- Call: a round phone button labelled **Call** (accessible name "Call VYRA"),
  a real `<a href="tel:+…">` from the site settings phone (`telHref`:
  formatting stripped; a leading `+` or the international `00` gives
  E.164 `+<digits>`). Hidden when no phone is set. Tracks `call`
  (`screen: feed`).
- Every "Enquire on WhatsApp" / "Ask about restock" / "Chat on WhatsApp"
  text button (sheet footer, product page bar and inline button, menu) keeps
  the VYRA olive background and uses the white WhatsApp logo as its icon.
- **WhatsApp links open the app on phones**: they stay
  `https://wa.me/<digits>?text=…` (Android app links / iOS universal links
  hand them to the installed app; without it, WhatsApp's web / install page).
  They are plain anchors: no `target="_blank"` (on some Android browsers it
  forces the in-browser page instead of the app) and no `window.open`.

## Details sheet (ZP-510)

Tapping **Details** (rail), the **caption** or the **photo** opens a bottom
sheet over the current look instead of navigating; the feed does not move.

- **Content** (details only, no photos): collection label, serif name, price
  or "Ask for price", tag; star summary + review count ("4.7 · 3 reviews") and
  the heart pill ("Love it" / "Loved by N"); colour and size chips (the same
  `ProductEnquiryProvider` / `ProductOptions` the old product page used, so the
  chosen size goes into the WhatsApp message, with the public ref);
  description; "Try it on in store" (`StoreVisitRow`: today's hours, the week,
  address, directions; every missing part hidden, never "TBC"); the first 2
  approved reviews (no review photos) and the VYRA shop rating. ZP-512:
  "See all N reviews" (only when there are more) opens the rest **inside the
  sheet**, 5 at a time ("Show more reviews (k)", `reviewsMore`; the extras
  carry every approved review, at most 100). There is no full-page link any
  more: the product page is gone (owner, ZP-512; see the end of this file).
- **Pinned footer**: **Enquire on WhatsApp** (or **Ask about restock** with
  the restock message for sold-out pieces; **Visit us** without a WhatsApp
  number), **Call** (when a phone is set), **Share** (when there is a share URL).
- **Height**: at most 62% of the visible viewport (CSS `62dvh`, `62vh`
  fallback, and from JS `visualViewport.height × 0.62`, again on resize,
  `sheetMaxHeight`), so the top of the look stays visible; inner scroll;
  light backdrop (18% ink); safe-area bottom padding on the footer. On
  computers it is as wide as the phone-shaped column and sits at its bottom.
- **More**: while content continues below (`sheetHasMore`, 24px slack), a
  bottom fade and a "More: store & reviews ⌄" pill (nudging chevron; still
  with reduced motion). Its text names only the sections that exist
  ("More: store", "More: reviews", else "More"; `morePillText`) and is its
  accessible name. The pill scrolls ~70% of the visible height
  (smooth; an instant jump where a browser does not run smooth scrolling).
  Both hide at the end.
- **Close**: drag the handle row down more than 90px (pointer events, pointer
  capture, `touch-action: none` on the handle; less snaps back), a tap on
  the backdrop (pointerdown and click both on it), ✕, Escape (the dialog's
  `cancel` is taken over), and the browser / Android back button. Focus
  returns to the link that opened it (else the feed).
- **URL and history**: opening pushes `?d=<slug>` (other parameters and the
  `#look-` hash kept; history state `{ vyraSheet: slug }`). The sheet is
  open exactly while the URL has a `d` of a loaded look, so back simply pops
  that entry. Closing from the sheet's own controls calls `history.back()`
  (the feed entry is behind it), so back / forward stay clean. A page
  opened with `?d=<slug>` (shared link, reload) scrolls to (and if needed
  loads through) that look; once the look is loaded it replaces its entry
  with the feed without `d` and pushes the sheet entry (`landingAction`), so
  back closes the sheet instead of leaving the site; when it is our own entry
  (back from the full page) nothing is added. This history work runs from a
  timer, after Next.js has patched `history` (its effect runs after the
  feed's), so the entries carry Next's state and forward / back never
  reload. A `d` for a piece that is not in the feed (unknown, unpublished,
  beyond the load) is removed in place and nothing is pushed; the
  first-visit guide is held back only while the sheet opens or may open.
  If the push fails, closing replaces the URL (never `history.back()`).
  `replaceState` calls pass only our part of the entry state
  (`customHistoryState`): a state carrying Next's `__NA` makes Next skip its
  router sync.
- **Video**: the look's playing video pauses while its sheet is open and
  resumes when it closes.
- **Short screens** (height ≤ 700px, e.g. 360×580): the rail tightens
  (44px rings, smaller gaps, no text under Call and the eye; their
  aria-labels stay), so it stays below the photo arrows.
- **Semantics**: a native `<dialog>` with `showModal` (the feed behind is
  inert), labelled by the name heading, which takes the focus on open; ✕ is
  "Close details"; Details, the caption, the photo and video links have
  `aria-haspopup="dialog"`. The handle drag reacts to the primary button /
  touch / pen only.
- **Data**: the slide's `FeedItem` fields show at once; the rest
  (description, colours / sizes, ref, availability, the WhatsApp settings,
  top 2 reviews with summary and shop rating, store visit) is the public
  `SheetExtras` DTO from the server action `loadSheetExtrasAction`, fetched
  once per slug per page load (client cache; a failure retries on the next
  open and sends `action_failed` `details_sheet`). The action checks the
  slug and only reads the cached catalogue, reviews index and site
  settings: never the item number, stock, the phone number or review photos.
- **Analytics**: `details_sheet_open` / `details_sheet_close` (`reason`),
  see `docs/storefront/analytics.md`; the rollup counts a sheet open as a
  product open for the funnel and per piece.

## End slide

"You have seen every look in *<collection>*", WEAR DIFFERENT., "Back to the
first look" (scrolls to the top) and "Visit our store". With no published
pieces: "New looks are on their way" and "Visit our store".

## Returning to the same slide

The current slide is kept in the URL hash, `#look-<slug>` (each slide has
that id), written with `history.replaceState` 250 ms after the slide stops
changing (not for every slide crossed: Safari throws after 100 history calls
in 10 seconds; the call is also wrapped in try/catch), and at once when the
visitor leaves the feed (no hash on the first slide). Browser back
to the feed lands on
`/?c=<tab>#look-<slug>`; on mount the feed switches to that tab if needed,
loads through that slug if it is beyond the first page, and jumps there
without animation. A shared `/#look-<slug>` link opens on that look. The
current slide is then read from the scroll position (the browser may have
scrolled to the anchor before hydration, which fires no scroll event).

## Phones and computers

- Phones: the feed fills the screen. The frame (`.sf-feed-frame`) is
  `100dvh` high (`100svh`, then `100vh` where unsupported). Where the result
  is still taller than what is on screen (Samsung Internet, some Android
  Chrome bottom toolbars), `StorefrontFrame` pins it from JS to the visible
  height (`frameHeightFix`: `visualViewport.height`, or `innerHeight` while
  pinch-zoomed; checked on mount and on resize only). The document never scrolls (the feed scrolls inside itself and the page locks
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
- "Swipe up for the next look" shows on every look (see Clean view).

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
- Real `<a href>` links to each piece's `/p/<slug>` are in the server HTML
  (a plain tap opens the details sheet instead).
- The page stays `noindex` and takes its title from the layout template.

## Details card content (ZP-513)

The sheet's body, top to bottom (the owner-approved prototype); every part
with no data is left out with no gap:

- **Price row**: price or "Ask for price", tag, and the heart pill on the
  right. Under it the rating ("★★★★☆ 4.7 · 3 reviews", a button that scrolls
  to the reviews) and the **social line** (`socialLine`): "Loved by N · X
  people asked about it this week", real numbers only, each part from 3.
  *Asked* = distinct visits with `whatsapp_enquire` or `restock_request` for
  the piece in the last 7 analytics days (today + 6, Harare) that were also
  shown the piece in the window (a `look_view` or `details_sheet_open` for
  it; once per visit), one grouped query over the raw events on the
  `(day, type)` index (`src/lib/storefront/asked-query.ts`), cached 5 minutes
  for everyone (`asked.ts`). The DTO only gets the number, and only from 3
  (below that it is 0 on the server). Residual risk: a script can still send
  a view and then an enquiry from many visits (the event endpoint is
  anonymous and rate-limited, not authenticated); it is a nicety, never money.
- **Colour · Size** (`colourSizeLabel`): a colour picker only with more than
  one colour, else "Colour: Olive · Size"; the size chips (the chosen size and
  colour go into the WhatsApp message; a piece's only colour goes in too,
  without a picker, `chosenColour`); "Size guide" opens an inline table
  ("Body measurements in cm") of the piece's sizes from its own chart, else
  the default chart (`chartForSizes`); hidden without a chart. The fit note
  under the chips. `size_guide_open` is tracked when it opens.
- **How to buy** (`howToBuy`, a `<ul aria-label="How to buy">`): Reserve on
  WhatsApp – "We hold it for {holdHours} h" (no sub-line until the owner sets
  the hours; default none) (sold out: Ask about restock –
  "We message you when it's back"; only with a WhatsApp number); Pay in store
  – payment methods; Collect in store – today's hours. Cells without data are
  hidden; the strip hides when all are empty.
- **Description** on 2 lines with "More · fabric & care" (or "More" for a long
  text, `descriptionToggle`); open shows the full text and Fabric / Care.
- **Try it on** in one line: "Try it on: open today 09:00–17:30" and
  **Directions** (Google Maps; `directions` tracked).
- **You may also like** ("Available now" on a sold-out piece): up to 4
  published, in-stock pieces with a photo, never the current one; same
  collection first, then the rest; the feed's ranking order inside each group
  (`pickAlsoLike` over the feed order). Small photo (104×132, object-position
  50% 20%), name, price. A tap **closes the sheet** (close reason
  `also_like`) and takes the shopper to that piece's look in the feed, full
  screen on its first photo: a smooth scroll when it is loaded in the current
  collection, else New in (switch, or load through it, like the `#look-`
  restore). The URL becomes `#look-<slug>` (no `?d=`), focus moves to that
  slide, and `also_like_open { slug, to }` is tracked. The feed continues
  normally from there.
- **Reviews**: two, then "See all N reviews" / "Show more reviews" (5 at a
  time) in place.
- The 62% height, the "More" pill (its words name the sections present:
  store = How to buy / Try it on, reviews) and the footer (WhatsApp, Call,
  Share) are unchanged.

Data: product fields `fitNote` (≤ 160), `fabric` (≤ 80), `care` (≤ 80),
`sizeChart` (JSON rows `{ size, bust, waist, hips }`, ≤ 12 rows, validated by
`parseSizeChart`) in the product's Website panel (the chart as one row per
line: `S | 86–90 | 68–72 | 94–98`; a line with more than 4 parts or no
measurement at all is refused, naming the line); site settings `holdHours` (default none,
1–168, empty hides), `paymentMethods` (≤ 80), `defaultSizeChart` in Website
settings ("Details card: how to buy and size guide"). Migration
`20261109090000_details_card`. The public product DTO adds `fit`, `fabric`,
`care`, `sizeChart` (the key is `fit`, not `fitNote`: nothing public may look
like the private `notes`); public settings add `buying`.

## /p/<slug>: the feed on that look (ZP-512)

The separate product page is gone (owner: "it is redundant"). `/p/<slug>`
(`/site/p/<slug>` on UAT; the storefront host's clean path) is still the
piece's URL (Share, the WhatsApp message, collection / shop cards, Google),
but it renders the **flip feed on that look with its details sheet open**,
exactly like `/?d=<slug>`:

- The server loads New in through that look (`loadFeed` with `through`; a
  look further down than one load reaches is put first, `withLandingItem`)
  and renders `FlipFeed` with `landing={ slug, mode: "product" }`. The sheet
  is held open from the first render (its content is in the server HTML
  inside the closed `<dialog>`) and opens as a modal on hydration; the feed
  starts on that look.
- After hydration (from a timer, after Next.js patched `history`) the URL
  becomes the feed's: the /p entry is replaced by `<home>#look-<slug>` and
  `<home>?d=<slug>#look-<slug>` is pushed (`productLandingHistory`; campaign
  parameters kept, `preview` / an old `d` dropped). Closing (✕, drag,
  backdrop, Escape, back) leaves the visitor on that look in the feed; back
  once more leaves as from any page. The first open sends
  `details_sheet_open` with `from: "shared"`. The tab title stays the
  piece's until the next navigation.
- The full-screen frame (no header / footer): the home page from the first
  render (`isFeedFrame`), and any other page because it renders the feed: the
  feed's root carries `data-feed-page` (`FEED_PAGE_ATTR`) and
  `.sf-page:has([data-feed-page])` (globals.css) turns the page frame into the
  feed frame and hides the header and footer, in the server HTML too. A
  /p/<unknown> 404 has no feed, so it keeps them (review: the route segment
  alone never decides it). When the address becomes the feed URL, the tab
  title becomes the feed's (`FEED_DOCUMENT_TITLE`).
- **Per-piece server render** (`generateMetadata`): title, description,
  canonical `/p/<slug>`, Open Graph and Twitter title / description / image
  (the primary photo, absolute URL: WhatsApp / Instagram previews), and
  JSON-LD Product with AggregateRating only when the piece has approved
  reviews (`productReviewsJsonLd`). The name, collection, price and
  description are also in an sr-only summary in the HTML.
- Unknown / unpublished slug without a valid preview token: 404 as before;
  an old slug: 308 to the current one (`decideProductRoute`).
- **Owner preview** (`/p/<slug>?preview=<token>`, unpublished): the feed with
  just that look (`mode: "preview"`), its sheet open with details rendered by
  the server (`buildSheetExtras`, passed in as `extras`; the sheet's action
  only knows published pieces), no heart, no Share, a slim "Preview, not
  public" strip (taps go through to the top bar), and the URL untouched (no
  history writes; closing just closes). noindex / no-referrer /
  `private, no-store` and the enquiry links as before (they only work once
  the piece is published).
- Removed with the page: `ProductView`, `ProductTopBar` + `back-target`,
  `NavMemory`, `ProductTracking` (`product_open` is no longer sent),
  `ProductBottomBar`, `RelatedRow` + `related.ts`, `ShareButton`,
  `ProductReviews` / `ReviewList` / `ShopRatingBox`, `ProductEnquiryButton`,
  the header's product-top-bar rule. Kept: `ProductEnquiry` (provider,
  chips), `StoreVisitRow`, `useShare`, `LoveButton`, `Gallery` /
  `GalleryVideo` (the /site/preview component gallery), the public data
  layer's `listRelatedProducts`.
