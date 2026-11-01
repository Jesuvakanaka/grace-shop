# First-party analytics (ZP-493)

Anonymous, first-party event collection for the whole shopper journey on the
VYRA storefront: what people see, for how long, what they tap, where they
come from and where they drop off. It feeds the Insights page (ZP-505) and
the popularity ranking of the feed (ZP-506).

Wave 1 (this change) is the backend and the client library, plus
`visit_start` / `visit_end` on every storefront page. The feed and product
components are instrumented in wave 2 (see "How to instrument").

## Privacy ground rules

- **Anonymous.** No names, phone numbers, emails, accounts, IP addresses,
  user agents or full referrer URLs are stored. `visitId` (sessionStorage)
  and `deviceId` (localStorage) are random UUIDs made in the browser.
- **No cookies.** Storage is `sessionStorage` / `localStorage` only.
- **First-party.** Stored in grace-shop's own database. No third-party
  scripts, pixels or tools. Not sold or shared.
- **Opt-out respected.** Global Privacy Control or Do Not Track (browser
  signal or `Sec-GPC: 1` / `DNT: 1` header): nothing is collected or stored.
- **Bots dropped.** Crawlers, link-preview fetchers (incl. TelegramBot,
  Discordbot), HTTP tools, headless and automated browsers
  (`navigator.webdriver`, `HeadlessChrome`) are filtered in the browser and
  again on the server. Telegram / Discord **in-app browsers** are real people
  and are kept.
- **Staff are not visitors.** A request carrying a valid back-office session
  cookie (`auth-token`, verified like the admin API does) is answered 204 and
  nothing is stored. On UAT the site lives under `/site` on the admin host, so
  this covers the owner and staff checking the site while signed in. (On a
  separate storefront host the admin cookie, which is host-only, is never
  sent; staff browsing there signed out count as visitors.) A forged or
  expired token counts as a normal visitor.
- **IP addresses** are used only in server memory for rate limiting
  (`src/lib/analytics/limits.ts`) and are never written to the database or
  to logs by this code. (Cloud Run's own request logs are separate; the
  privacy page mentions them under "Technical logs".)
- **Preview pages** (`/preview/...`, `?preview=`) are never collected.
- **Retention.** Raw events 90 days; daily rollups 25 months.
- The public notice is `src/app/site/privacy/page.tsx` (`/privacy`). Change it
  whenever what is collected changes.

## Pipeline

```
component ──track()──▶ validate + queue ──sendBeacon / fetch keepalive──▶ POST /api/public/events
                                                                            │ validate, limit, drop, store once
                                                                            ▼
                                                        AnalyticsEvent (raw, 90 days)
                                                                            │ npm run analytics:rollup (nightly)
                                                                            ▼
                           AnalyticsDailyVisits / Source / Piece / Photo / Video (25 months)
```

### Client (`src/lib/analytics/`)

| file | what |
|---|---|
| `client.ts` | the API for components: `track`, `flushAnalytics`, `initAnalytics`, `useDwell`, `useActiveDwell`, `createDwellTracker`, `createDwellTimer` |
| `client-core.ts` | the tracker, with every browser API injected (tested with a fake browser) |
| `dwell.ts` | dwell rules, IntersectionObserver tracker, page visibility |
| `context.ts` | referrer bucket, campaign tag, device class, page path |
| `privacy.ts` | GPC / DNT, bot and headless detection (client and server) |
| `events.ts` | the event catalogue, `validateEvent` / `validateBatch` (shared with the server) |
| `limits.ts` | the server's in-memory abuse limits |
| `provider.tsx` | `<AnalyticsProvider />`, mounted in `src/app/site/layout.tsx` |

- **Validation before queueing:** `track()` gives each event a random UUID
  (`id`) and runs the shared `validateEvent`. An invalid event is dropped
  (with a `console.warn` in development, silently in production), so one bad
  call can never cost the other events of a batch.
- **Batching:** events wait in memory and are sent every **10 s**, as soon as
  **20** are queued (`MAX_BATCH_EVENTS`), and when the page hides.
  While the page is hidden, sends are **coalesced** to the end of the current
  task (a microtask): `visit_end` and the dwell events that the same hide
  makes the slides emit go out in **one** beacon. `pagehide` (the page is
  being unloaded) sends synchronously.
  Transport: `navigator.sendBeacon` (a string body, so `text/plain`, no CORS
  preflight); if it is missing or refuses, `fetch(..., { keepalive: true,
  credentials: 'same-origin' })` (same-origin so a staff cookie reaches the
  server). At most 200 events are held if sending keeps failing.
- **Visit:** `vyra:analytics:visit` in sessionStorage (id, last activity,
  visible ms, looks seen, last event). A reload or full navigation in the same
  tab continues the visit; it ends with the tab / browser session, and
  **30 min** without activity starts a new one.
- **Device:** `vyra:analytics:device` in localStorage. If it already existed,
  `visit_start.returning` is `true`.
- **Storage blocked** (private mode, settings): every access is in
  try/catch; the visit id then lives in memory for this page, and no device
  id is sent.
- **Performance:** no scroll handlers. Visibility comes from
  IntersectionObserver and `visibilitychange`; the only listeners are
  `visibilitychange`, `pagehide`, `pageshow`.
- **Non-browser:** on the server and in node tests every export is a no-op.

### Endpoint: `POST /api/public/events`

`src/app/api/public/events/route.ts` → `src/lib/analytics/ingest.ts`.
Allowed on the storefront host by the existing `/api/public/` prefix in
`src/lib/host-routing.ts` (no change needed; covered by a test).

Body (JSON, `text/plain` or `application/json`):

```json
{ "v": 1,
  "visit": "<uuid v4>",
  "device": "<uuid v4, optional>",
  "events": [
    { "id": "<uuid v4>", "type": "look_view", "at": 1793527200000, "page": "/",
      "slug": "linen-dress", "collection": "new", "props": { "position": 0 } }
  ] }
```

| check (in this order) | answer |
|---|---|
| `Origin` missing / not this host, or `Sec-Fetch-Site` not `same-origin` | 403 |
| GPC / DNT header, bot or headless user agent / client hint, valid staff session cookie | 204, nothing stored |
| per-IP event budget: 1 token for the request | 429 + Retry-After |
| content type not `text/plain` / `application/json` | 415 |
| body over 32 KB (Content-Length or actual) | 413 |
| bad envelope: not JSON, unknown top-level field, version, visit / device id, no events, **more than 20 events** | 400 (`{ error }`), nothing stored |
| per-IP event budget: 1 token per event; new visit ids per IP per hour; per-visit event budget; events per visit per day | 429 + Retry-After |
| an invalid event (unknown type / field / prop, wrong type, out of range, too long, bad `id`) | **that event dropped**, the rest stored |
| an event's `slug` is not a published piece (published, slug, published category) | that event dropped |
| `size` / `colour` not one of that piece's own published options (case-insensitive) | that prop dropped (the event is kept); a matching value is stored in the piece's spelling |
| an event id already stored (retry, replay, duplicate in the batch) | skipped (`createMany skipDuplicates`, unique `eventId`) |
| stored | 204, no body, `Cache-Control: no-store` |

`at` is the client clock (ms). If it is more than 24 h in the past or 5 min
in the future the server time is used.

### Limits (in memory, per Cloud Run instance)

`src/lib/analytics/limits.ts`, tested in `tests/analytics-limits.test.ts`.
Budgets are counted **in events**, not requests; every event sent counts,
valid or not. Keys are the client IP bucket (`clientKey`: IPv4, or the IPv6
/64) and the visit id. Maps are bounded (oldest forgotten); everything resets
when an instance restarts. Same load-balancer caveat as
`/api/public/products` (see `src/lib/storefront/rate-limit.ts`).

Zimbabwean mobile carriers put many phones behind one public address
(carrier-grade NAT). The per-IP numbers are sized for **~30 people browsing
the feed at the same time behind one IP**: an actively scrolling visitor
sends about 0.5 events/s, and a full batch costs 21 tokens (request + 20).

| limit | value | why |
|---|---|---|
| per IP, burst | 640 events | 30 people × a full batch (30 × 21 = 630) |
| per IP, sustained | 20 events/s | 30 × 0.5 = 15, plus headroom |
| new visit ids per IP per hour | 300 | 30 people × a few visits / tabs each |
| per visit, burst | 200 events | ten full batches |
| per visit, sustained | 2 events/s | 4× an active visitor |
| per visit per analytics day (24 h window) | 3,000 events | a normal visit sends ~50 |

## Event catalogue

Every event: `id` (UUID v4, made by the client), `type`, `at`, `page` (path
only, no query string, `/site` prefix removed), optional `slug` (the piece)
and `collection` (feed tab: `new` or a category slug), and `props` exactly as
below (anything else makes the event invalid).
`slug`: **req** = required, **opt** = optional, – = not allowed.
Text props: zero-width characters (U+200B–U+200D, U+2060, U+FEFF) are
removed, then trimmed; 1..max characters; no control characters.

| type | slug | props |
|---|---|---|
| `visit_start` | – | `ref` instagram/tiktok/whatsapp/facebook/google/direct/other; `refDomain`? host; `campaign`? tag ≤ 40 `[a-z0-9_-]`; `device` phone/tablet/desktop; `vw`, `vh` 0..20000; `lang`? BCP 47; `landing` path; `returning` bool |
| `visit_end` | opt (last look) | `duration` visible s 0..86400; `looks` int; `last`? event type |
| `look_view` | req | `position`? 0..10000 (index in the feed) |
| `look_dwell` | req | `seconds` 0.5..60 |
| `photo_view` | req | `index` 1..50, `of` 1..50 (index ≤ of), `image`? `<32 hex>.webp` |
| `photo_dwell` | req | as `photo_view` + `seconds` 0.5..60 |
| `video_start` | req | – |
| `video_progress` | req | `pct` 25/50/75/100 |
| `video_replay` | req | – |
| `video_seconds` | req | `seconds` 0..600 (watched in this viewing) |
| `details_show`, `details_hide` | req | – |
| `collection_switch` | – | `from`, `to` collection keys |
| `feed_load_more` | – | `loaded`? 0..10000 |
| `feed_end_reached` | – | `looks`? 0..10000 |
| `product_open` | req | `from` feed/collection/shop/new/related/shared/other |
| `size_select` | req | `size` text ≤ 24 (kept only if it is one of the piece's sizes) |
| `colour_select` | req | `colour` text ≤ 32 (kept only if it is one of the piece's colours) |
| `whatsapp_enquire` | opt | `screen` (below); `size`? ≤ 24; `colour`? ≤ 32 (same option check) |
| `restock_request` | req | `size`? ≤ 24 (same option check); `screen`? |
| `call` | opt | `screen`? |
| `share` | opt | `method` native/copy/whatsapp/facebook/other; `screen`? |
| `directions`, `visit_us` | – | `screen`? |
| `gallery_zoom` | req | `index`? 1..50 |
| `guide_shown`, `guide_completed`, `guide_replayed` | – | – |
| `guide_step` | – | `step` 1..20 |
| `guide_skipped` | – | `step`? 1..20 |
| `love_on`, `love_off` | req | – |
| `load_error` | opt | `what` image/video/feed/page/other |
| `slow_load` | – | `lcp` ms 0..600000 (send when LCP > 4000) |
| `action_failed` | opt | `action` tag ≤ 40 `[a-z0-9_-]` (e.g. `feed_load`) |

`screen`: feed/product/menu/visit/about/collection/shop/new/other.
Size / colour options are the piece's free-text `sizes` / `colours` split
like the product page does (`splitOptions`: commas, semicolons, pipes, new
lines).

Derived (not sent): **bounce** = a visit that ended under 5 visible seconds
having seen at most one look; **last look before leaving** = `slug` of the
latest `visit_end`.

### Visit context (sent once, with `visit_start`)

- `ref`: from `document.referrer`'s host. instagram.com / ig.me, tiktok.com,
  whatsapp.com / wa.me, facebook.com / fb.com / messenger.com, google.*; the
  own host or no referrer = `direct`; anything else = `other` (+
  `refDomain`). In-app browsers usually send no referrer, so with no
  referrer a `?src=` / `utm_source` tag like `ig`, `instagram-bio`, `tt`,
  `wa-status`, `fb` sets the bucket. **Use `?src=` on every link the shop
  posts** (e.g. `https://…/?src=ig-bio`).
- `campaign`: `?src=`, else `utm_campaign`, else `utm_source`; zero-width
  characters removed, lowercased, anything else than `[a-z0-9_-]` becomes
  `-`, at most 40 characters.
- `device`: from the user agent (iPadOS via touch points).

`visit_end` is sent **every time the page hides** (app switch, lock, tab
close) with the cumulative visible duration; a visit can therefore have
several. The rollup uses the largest.

## Dwell rules

`src/lib/analytics/dwell.ts`, tested in `tests/analytics-dwell.test.ts`.

- Counts only while the element is **≥ 60% visible** AND the page is visible.
  Screen lock / app switch / tab switch pause it.
- Emitted when it leaves the view, when the page hides (then resumes from 0
  if it comes back), and when the tracker stops (unmount, slide changes).
- **< 0.5 s is ignored** (flicked past). **One dwell is capped at 60 s.**
- Seconds have 2 decimals.

## How to instrument (wave 2)

All from `@/lib/analytics/client`, in client components only:

```tsx
import { track, useDwell, useActiveDwell } from '@/lib/analytics/client'

// A feed slide: view once when it becomes the current slide, dwell while on screen.
const slideRef = useRef<HTMLElement>(null)
useDwell(slideRef, (seconds) => track('look_dwell', { slug, collection, seconds }), { key: slug })
useEffect(() => { if (isCurrent) track('look_view', { slug, collection, position }) }, [isCurrent])

// The active photo of a carousel (state-driven, no observer needed).
useActiveDwell(isCurrent && photoIndex === i, (seconds) =>
  track('photo_dwell', { slug, index: i + 1, of: photos.length, image, seconds }), `${slug}-${i}`)

// Taps.
track('whatsapp_enquire', { slug, size, screen: 'product' })
track('collection_switch', { from, to })
```

- `slug` and `collection` are lifted onto the event; every other key must be a
  prop of that type in `EVENT_SPECS` (`src/lib/analytics/events.ts`), with the
  right type and range. Otherwise **the event is dropped in the browser**
  (watch the console in development). Omit optional props rather than
  sending `null` (`undefined` values are dropped).
- Send `size` / `colour` exactly as the chip shows them (the product's own
  options); anything else is dropped by the server.
- `image` is the stored file name `<32 hex>.webp` (the last path segment of
  the public image URL), not the URL.
- `useDwell(ref, onDwell, { enabled, threshold, root, key })`: `root` is a ref
  to a scroll container (horizontal carousel); `key` restarts the tracker.
  `createDwellTracker(el, { onDwell })` / `createDwellTimer({ onDwell })` are
  the framework-free versions. They use the same page-visibility source as
  the tracker, which is what lets their hide-time dwell events share the
  `visit_end` beacon.
- Never put free text the visitor typed, phone numbers, or URLs with a query
  into props (the schema refuses them anyway).
- `track()` is cheap (validation + an array push); do not call it from
  scroll handlers.
- Hearts (ZP-507) can read the same device id: `localStorage['vyra:analytics:device']`
  (`DEVICE_STORAGE_KEY` in `client-core.ts`). It is absent when the visitor
  opted out (GPC / DNT) or storage is blocked.

## Where each event is sent (wave 2, ZP-507 branch)

Prop builders are pure and tested in `tests/storefront-tracking.test.ts`
(`src/lib/storefront/tracking.ts`: `imageFileName`, `photoProps`,
`productOpenSource`, `createVideoWatch`). Nothing runs in a scroll handler.

| event | where | notes |
|---|---|---|
| `look_view` | `FeedSlide`, when the slide becomes the current one | `slug`, `collection` (tab), `position` (index in the feed) |
| `look_dwell` | `FeedSlide`, `useDwell` on the slide `<article>` | |
| `photo_view` / `photo_dwell` | `FeedSlide` (the strip's photo on the current slide) and `Gallery` (product page, while the gallery is ≥ 60% visible) | `index` / `of` among the photos (a video first is not counted), `image` file name; `useActiveDwell` keyed per photo |
| `video_start`, `video_progress`, `video_replay`, `video_seconds` | `FeedVideo`, `GalleryVideo` via `useVideoTracking` | a viewing ends when the video leaves the view (the playback hook's 60% observer) or unmounts; a page hide sends the seconds so far; every loop is a replay; 100% on the first loop or `ended` |
| `details_show` / `details_hide` | `FlipFeed` eye | the current look's slug |
| `collection_switch` | `FlipFeed`, a collection picked in the sheet, once its looks arrived | `from`, `to` |
| `feed_load_more` | `FlipFeed`, a next page arrived | `loaded` = looks loaded so far |
| `feed_end_reached` | `FlipFeed`, the end slide reached | once per collection per page load, `looks` |
| `whatsapp_enquire` / `restock_request` | feed rail Enquire / Restock (`screen: feed`); product page enquiry buttons (`screen: product`, with the chosen size / colour) | sold-out pieces send `restock_request` only |
| `share` | feed rail, product top bar and Share button | only when the share sheet completed (`native`) or the link was copied (`copy`) |
| `visit_us` | feed rail (no WhatsApp number) and end slide; product page Visit us | |
| `call`, `directions` | product page (Call buttons, "Get directions") | |
| `product_open` | `ProductTracking`, once per piece shown | `from`: in-app previous path (NavMemory) else same-origin referrer: `/` feed, `/collections…` collection, `/shop`, `/new`, `/p/…` related; no / foreign referrer shared; else other. Covers taps on collection / shop cards without touching them |
| `size_select`, `colour_select` | product page chips (picked, not cleared) | exactly the chip text |
| `gallery_zoom` | `Gallery` full screen | `index` of the photo |
| `guide_shown` / `guide_replayed` | `FlipFeed` (first visit / `?guide=1`; one or the other) | |
| `guide_step`, `guide_completed`, `guide_skipped` | `FeedGuide` | step 1-based; skipped = Skip or Escape, with the step |
| `love_on` / `love_off` | `src/lib/loves/client.ts` (hearts, ZP-507) | |
| `action_failed` | `FlipFeed` | `feed_load` (load more failed), `collection_switch` (fell back to a full load) |

The product page's server-rendered links are tracked by one delegated click
listener in `ProductTracking` (capture phase) through `data-track="enquire" |
"call" | "directions" | "visit_us"` attributes. Preview pages send nothing
(the tracker is disabled there).

## Tables

Migration `20261103090000_analytics_events`. No foreign keys (deleting a
product never blocks on analytics). Days are **analytics days in
Africa/Harare** (`analyticsDay()` in `events.ts`), stored as `DATE`.

### `AnalyticsEvent` (raw, 90 days)

| column | meaning |
|---|---|
| `id` | bigint |
| `eventId` | client-made UUID, **unique**: retries and replays are stored once |
| `occurredAt` / `receivedAt` | event time (client clock, sanity-checked) / server receive time |
| `day` | analytics day of `occurredAt` |
| `visitId`, `deviceId` | UUIDs (`deviceId` null if storage blocked) |
| `type` | event type |
| `slug`, `productId` | the piece; `productId` resolved at ingest (slug renames keep history) |
| `page` | path, no query |
| `collection` | feed tab |
| `props` | JSONB, per-type schema above |

Indexes: unique `(eventId)`, `(day, type)`, `(productId, day)`, `(visitId)`.

### Daily rollups (25 months)

All keyed by `day` first; per-product tables also indexed `(productId, day)`
so "last N days of product X" and "all products over the last N days" are
both index scans.

- **`AnalyticsDailyVisits`** (`day` PK): `visits` (started that day),
  `devices` (distinct device ids), `returningVisits`, `endedVisits` (with a
  `visit_end`), `bounces`, `totalSeconds` (visible), `looksSeen`,
  `enquiringVisits` (≥ 1 `whatsapp_enquire`), `updatedAt`.
  Average visit = `totalSeconds / endedVisits`; bounce rate = `bounces / endedVisits`.
- **`AnalyticsDailySource`** (`day, source, deviceClass, campaign` PK;
  campaign `""` when none): `visits`, `bounces`, `enquiringVisits`, `totalSeconds`.
- **`AnalyticsDailyPiece`** (`day, productId` PK, `slug` latest): `views`
  (`look_view`), `viewers` (distinct visits), `dwellSeconds` / `dwellCount`
  (`look_dwell`), `photoViews`, `videoStarts`, `detailsShows`, `productOpens`,
  `sizeSelects`, `colourSelects`, `galleryZooms`, `enquiries`,
  `restockRequests`, `shares`, `loveOn`, `loveOff`, `exits` (visits whose
  latest `visit_end` that day named this piece).
- **`AnalyticsDailyPhoto`** (`day, productId, photoIndex, image` PK; `image`
  `""` when not sent): `views`, `viewers`, `dwellSeconds`, `dwellCount`.
- **`AnalyticsDailyVideo`** (`day, productId` PK): `starts`, `viewers`,
  `replays`, `reached25/50/75/100`, `watchSeconds`.
- **ZP-505 (Insights)**, migration `20261105090000_analytics_insights_rollups`:
  `AnalyticsDailyPiece.photoSwipers`, and `AnalyticsDailyJourney` (funnel by
  furthest step, feed end, WhatsApp taps per source / device / campaign),
  `AnalyticsDailyDepth` (visits by looks seen), `AnalyticsDailyHour` (visits
  by Harare hour of start), `AnalyticsDailyHealth` (slow loads, load errors,
  failed actions), `AnalyticsDailyOption` (size / colour demand per piece).
  Columns and definitions: `docs/admin/insights.md`. Journey, depth and hour
  rows are by the day the visit started; health and option rows by the day
  of the event.

Visit and source rows are by the day the visit **started** (a `visit_end`
or enquiry after midnight still counts for it); piece, photo and video rows
by the day of the event.

Hints for ZP-506 ranking: sum a window (e.g. 14 days) per `productId` of
`AnalyticsDailyPiece` (views, viewers, dwellSeconds/dwellCount, enquiries,
loveOn − loveOff, shares, exits) and of `AnalyticsDailyPhoto` (cover photo =
highest dwell per view). All in one indexed range scan.

## Rollup job

`npm run analytics:rollup` (`scripts/analytics-rollup.ts`, logic in
`src/lib/analytics/rollup.ts`, tested in `tests/analytics-rollup-db.test.ts`
and, at volume, `tests/analytics-rollup-volume-db.test.ts`: 20,000 events by default, the
500,000-event run is opt-in with `ANALYTICS_VOLUME_EVENTS=500000`).

```
npm run analytics:rollup                                        # the day before yesterday AND yesterday (Harare), then prune
npm run analytics:rollup -- --date 2026-11-01                   # redo one day
npm run analytics:rollup -- --from 2026-11-01 --to 2026-11-30   # backfill (last 90 days only)
npm run analytics:rollup -- --no-prune
```

- **Default: two days.** Every night it re-rolls yesterday and the day
  before, so events that arrive late (a phone that was offline, a beacon
  sent just after midnight, a skewed client clock up to 24 h back) are
  counted on the next night's run.
- Each day is replaced in one transaction (timeout 10 min, max wait 30 s,
  `statement_timeout` 9 min), so running it again is safe and a runaway query
  fails the job instead of hanging. 500,000 events roll up in about 1.5 s
  locally (about 2.5 s with the ZP-505 Insights rollups).
- **Never rebuilds what it cannot.** A day older than 90 days (its raw
  events are pruned) is refused by the arguments and skipped by
  `rollupDay`; a day with no raw events while rollups exist is skipped too.
  Skipped days keep their rollups untouched and are listed as `skipped` in
  the output.
- Then retention: `AnalyticsEvent` rows with `day` older than 90 days, and
  rollup rows older than 25 months, are deleted.
- Prints one JSON line of counts; exit code 1 on failure.

### Scheduling (orchestrator, not done in this change)

Same image as the web service (the Dockerfile header lists the job). Names
must be `grace-shop-*` (the deploy SA's IAM condition denies anything else);
project `project-f4cd7300-6eb7-46cc-be3`, region `africa-south1`. For UAT:

1. Cloud Run job `grace-shop-uat-analytics-rollup`: the current grace-shop
   image (`image@sha256:…`), command `npm`, args `run,analytics:rollup`, the
   same Cloud SQL connection, `DATABASE_URL` / `DIRECT_URL` secrets and
   runtime SA (`grace-shop-uat-run`) as `grace-shop-uat-migrate`; 1 task,
   max retries 1, task timeout 15 min (two days at up to 10 min each would
   be far beyond today's volume). Redeploy it with every new image: add a
   "Deploy analytics rollup job" step (deploy only, no execute) next to the
   migrate job in `.github/workflows/deploy-uat.yml`.
2. Cloud Scheduler job `grace-shop-uat-analytics-rollup-nightly`: cron
   `30 2 * * *`, time zone `Africa/Harare` (02:30). No arguments: the job
   re-rolls the day before yesterday and yesterday. HTTP POST to
   `https://run.googleapis.com/v2/projects/project-f4cd7300-6eb7-46cc-be3/locations/africa-south1/jobs/grace-shop-uat-analytics-rollup:run`
   with an OAuth token of a service account that has `roles/run.invoker`
   (or `run.jobs.run`) on that job only.
3. After the first deploy, if collection ran for more than two days before
   the schedule existed, backfill once (only days within the last 90 days
   are accepted):
   `gcloud run jobs execute grace-shop-uat-analytics-rollup --args=run,analytics:rollup,--,--from,<first day, max 90 days ago>,--to,<yesterday> --wait`.

The migration (`npm run migrate` job) must run before the new web image
serves traffic, as usual.

## Tests

| file | covers |
|---|---|
| `tests/analytics-events.test.ts` | catalogue, `validateEvent` vs envelope, every type's props, batch limit, ids, pages, zero-width, bots (incl. Telegram / Discord in-app), GPC/DNT, referrer buckets, campaign, device class, host routing |
| `tests/analytics-limits.test.ts` | event budgets, per-visit daily cap, new visit ids per IP, the carrier-NAT numbers |
| `tests/analytics-dwell.test.ts` | dwell rules with a fake clock / visibility / IntersectionObserver |
| `tests/analytics-client.test.ts` | validation before queueing, event ids, batching, hidden-page coalescing, transport fallback, visit/device ids, idle, opt-out, storage failures, no-op on the server |
| `tests/analytics-endpoint-db.test.ts` | the endpoint end to end against the DB (accept, per-event drop, option check, dedupe, staff, 400/403/413/415/429) |
| `tests/analytics-rollup-db.test.ts` | rollups, idempotency, backfill, two-day default, never rebuilding pruned / empty days, retention, job arguments |
| `tests/analytics-rollup-volume-db.test.ts` | a busy day rolls up within the transaction limits (20,000 events; `ANALYTICS_VOLUME_EVENTS=500000` for the full run) |
