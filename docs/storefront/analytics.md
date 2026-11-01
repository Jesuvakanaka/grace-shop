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
- **Bots dropped.** Crawlers, link-preview fetchers, HTTP tools, headless and
  automated browsers (`navigator.webdriver`, `HeadlessChrome`) are filtered in
  the browser and again on the server.
- **Preview pages** (`/preview/...`, `?preview=`) are never collected.
- **Retention.** Raw events 90 days; daily rollups 25 months.
- The public notice is `src/app/site/privacy/page.tsx` (`/privacy`). Change it
  whenever what is collected changes.

## Pipeline

```
component ──track()──▶ client queue ──sendBeacon / fetch keepalive──▶ POST /api/public/events
                                                                         │ validate, drop, store
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
| `events.ts` | the event catalogue and strict schema (shared with the server) |
| `provider.tsx` | `<AnalyticsProvider />`, mounted in `src/app/site/layout.tsx` |

- **Batching:** events wait in memory and are sent every **10 s**, as soon as
  **20** are queued, and when the page hides (`visibilitychange` hidden or
  `pagehide`). Anything tracked while the page is hidden is sent at once.
  Transport: `navigator.sendBeacon` (a string body, so `text/plain`, no CORS
  preflight); if it is missing or refuses, `fetch(..., { keepalive: true,
  credentials: 'omit' })`. At most 200 events are held if sending keeps failing.
- **Visit:** `vyra:analytics:visit` in sessionStorage (id, last activity,
  visible ms, looks seen, last event). A reload or full navigation in the same
  tab continues the visit; **30 min** without activity starts a new one.
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
    { "type": "look_view", "at": 1793527200000, "page": "/", "slug": "linen-dress",
      "collection": "new", "props": { "position": 0 } }
  ] }
```

| check | answer |
|---|---|
| `Origin` missing / not this host, or `Sec-Fetch-Site` not `same-origin` | 403 |
| GPC / DNT header, bot or headless user agent / client hint | 204, nothing stored |
| more than 120 requests burst / 2 per s per IP (in memory, IP never stored) | 429 + Retry-After |
| content type not `text/plain` / `application/json` | 415 |
| body over 32 KB (Content-Length or actual) | 413 |
| not JSON, unknown field / type / prop, wrong type, out of range, too long, > 50 events, bad ids | 400 (`{ error }`), nothing stored |
| more than 30 requests burst / 1 per 5 s per visit id | 429 |
| an event's `slug` is not a published piece (published, slug, published category) | that event dropped, the rest stored |
| stored | 204, no body, `Cache-Control: no-store` |

`at` is the client clock (ms). If it is more than 24 h in the past or 5 min
in the future the server time is used. Rate limits are per Cloud Run
instance (same caveat as `/api/public/products`, see
`src/lib/storefront/rate-limit.ts` for the load-balancer note).

## Event catalogue

Every event: `type`, `at`, `page` (path only, no query string, `/site` prefix
removed), optional `slug` (the piece) and `collection` (feed tab: `new` or a
category slug), and `props` exactly as below (anything else is a 400).
`slug`: **req** = required, **opt** = optional, – = not allowed.
Text props are trimmed, 1..max characters, no control characters.

| type | slug | props |
|---|---|---|
| `visit_start` | – | `ref` instagram/tiktok/whatsapp/facebook/google/direct/other; `refDomain`? host; `campaign`? tag ≤ 64 `[a-z0-9._-]`; `device` phone/tablet/desktop; `vw`, `vh` 0..20000; `lang`? BCP 47; `landing` path; `returning` bool |
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
| `size_select` | req | `size` text ≤ 24 |
| `colour_select` | req | `colour` text ≤ 32 |
| `whatsapp_enquire` | opt | `screen` (below); `size`? ≤ 24; `colour`? ≤ 32 |
| `restock_request` | req | `size`? ≤ 24; `screen`? |
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
| `action_failed` | opt | `action` tag ≤ 40 `[a-z0-9._-]` (e.g. `feed_load`) |

`screen`: feed/product/menu/visit/about/collection/shop/new/other.

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
- `campaign`: `?src=`, else `utm_campaign`, else `utm_source`, lowercased,
  `[a-z0-9._-]`, ≤ 64.
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
  right type and range, or **the server rejects the whole batch**. Omit
  optional props rather than sending `null` (`undefined` values are dropped).
- `image` is the stored file name `<32 hex>.webp` (the last path segment of
  the public image URL), not the URL.
- `useDwell(ref, onDwell, { enabled, threshold, root, key })`: `root` is a ref
  to a scroll container (horizontal carousel); `key` restarts the tracker.
  `createDwellTracker(el, { onDwell })` / `createDwellTimer({ onDwell })` are
  the framework-free versions.
- Never put free text the visitor typed, phone numbers, or URLs with a query
  into props (the schema refuses them anyway).
- `track()` is cheap (an array push); do not call it from scroll handlers.
- Hearts (ZP-507) can read the same device id: `localStorage['vyra:analytics:device']`
  (`DEVICE_STORAGE_KEY` in `client-core.ts`). It is absent when the visitor
  opted out (GPC / DNT) or storage is blocked.

## Tables

Migration `20261103090000_analytics_events`. No foreign keys (deleting a
product never blocks on analytics). Days are **analytics days in
Africa/Harare** (`analyticsDay()` in `events.ts`), stored as `DATE`.

### `AnalyticsEvent` (raw, 90 days)

| column | meaning |
|---|---|
| `id` | bigint |
| `occurredAt` / `receivedAt` | event time (client clock, sanity-checked) / server receive time |
| `day` | analytics day of `occurredAt` |
| `visitId`, `deviceId` | UUIDs (`deviceId` null if storage blocked) |
| `type` | event type |
| `slug`, `productId` | the piece; `productId` resolved at ingest (slug renames keep history) |
| `page` | path, no query |
| `collection` | feed tab |
| `props` | JSONB, per-type schema above |

Indexes: `(day, type)`, `(productId, day)`, `(visitId)`.

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

Visit and source rows are by the day the visit **started** (a `visit_end`
or enquiry after midnight still counts for it); piece, photo and video rows
by the day of the event.

Hints for ZP-506 ranking: sum a window (e.g. 14 days) per `productId` of
`AnalyticsDailyPiece` (views, viewers, dwellSeconds/dwellCount, enquiries,
loveOn − loveOff, shares, exits) and of `AnalyticsDailyPhoto` (cover photo =
highest dwell per view). All in one indexed range scan.

## Rollup job

`npm run analytics:rollup` (`scripts/analytics-rollup.ts`, logic in
`src/lib/analytics/rollup.ts`, tested in `tests/analytics-rollup-db.test.ts`).

```
npm run analytics:rollup                                        # yesterday (Harare), then prune
npm run analytics:rollup -- --date 2026-11-01                   # redo one day
npm run analytics:rollup -- --from 2026-11-01 --to 2026-11-30   # backfill (≤ 762 days)
npm run analytics:rollup -- --no-prune
```

- Each day is replaced in one transaction: running it again is safe.
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
   max retries 1, task timeout 10 min. Redeploy it with every new image: add a
   "Deploy analytics rollup job" step (deploy only, no execute) next to the
   migrate job in `.github/workflows/deploy-uat.yml`.
2. Cloud Scheduler job `grace-shop-uat-analytics-rollup-nightly`: cron
   `30 2 * * *`, time zone `Africa/Harare` (02:30, after late beacons from
   just before midnight have arrived), HTTP POST to
   `https://run.googleapis.com/v2/projects/project-f4cd7300-6eb7-46cc-be3/locations/africa-south1/jobs/grace-shop-uat-analytics-rollup:run`
   with an OAuth token of a service account that has `roles/run.invoker`
   (or `run.jobs.run`) on that job only.
3. After the first deploy, backfill once from the first day of data:
   `gcloud run jobs execute grace-shop-uat-analytics-rollup --args=run,analytics:rollup,--,--from,<first day>,--to,<yesterday> --wait`.

The migration (`npm run migrate` job) must run before the new web image
serves traffic, as usual.

## Tests

| file | covers |
|---|---|
| `tests/analytics-events.test.ts` | catalogue, allow-list, every type's props, limits, ids, pages, bots, GPC/DNT, referrer buckets, campaign, device class, host routing |
| `tests/analytics-dwell.test.ts` | dwell rules with a fake clock / visibility / IntersectionObserver |
| `tests/analytics-client.test.ts` | batching, transport fallback, visit/device ids, idle, opt-out, storage failures, no-op on the server |
| `tests/analytics-endpoint-db.test.ts` | the endpoint end to end against the DB (accept, drop, 400/403/413/415/429) |
| `tests/analytics-rollup-db.test.ts` | rollups, idempotency, backfill, retention, job arguments |
