# Popularity score and feed ranking (ZP-506)

Owner decision (2026-11-01): "Let's automate the featured – based on
popularity. The reordering manages the featured." The landing feed is
ordered by a popularity score computed every night, and the same score picks
the **Featured** pieces. There is no manual Featured precedence while ranking
is automatic.

## Where it runs

```
nightly job (npm run analytics:rollup)
  1. analytics rollups (yesterday + the day before)        src/lib/analytics/rollup.ts
  2. ranking step                                           src/lib/ranking/job.ts  (runRanking)
       AnalyticsDailyPiece distinct-visit columns (28 days)
       + ProductLove (deduplicated hearts) + approved Review stars
         → score per public piece with a photo              src/lib/ranking/score.ts
         → today's order + automatic Featured               src/lib/ranking/order.ts
         → ProductPopularity (replaced) + Product.featured
  3. review photo cleanup (ZP-508)
storefront feed
  getFeedRanking() (one cached entry: mode + rank per public ref) → orderFeedByRanking   src/lib/ranking/feed-order.ts
```

- **Steps are independent** (`src/lib/ranking/nightly.ts`): each runs in its
  own try/catch and prints one JSON line; a failing step never skips the
  others (the review-photo cleanup always runs, the ranking runs on whatever
  rollups exist if the rollup failed); the job exits 1 at the end if any step
  failed. Bad arguments exit 1 before anything runs.
- The ranking step needs nothing but the database. `--no-rank` skips it
  (`npm run analytics:rollup -- --no-rank`). Its line:
  `{"job":"ranking","day":…,"mode":…,"pieces":…,"totalViews":…,"ranked":…,"featuredChanged":…,"ms":…}`.
- **Idempotent:** one transaction; the table is replaced; the result depends
  only on the rollups, the hearts, the reviews, the products and the
  analytics day (Harare). Sums are added in a fixed (piece, day) order, so a
  rerun gives bit-identical rows and changes no Featured flag (tested,
  also with three concurrent runs).
- **Concurrency:** `pg_advisory_xact_lock(506001)` at the start of the
  transaction serialises runs (nightly job, the owner's switch, manual runs),
  and the `SiteSettings` row is locked `FOR UPDATE` for the whole run. The
  settings `PUT` takes the same row lock, so an owner's switch waits for a
  running ranking and is never overwritten by a run that read the old mode
  (tested).
- The owner switching back to "Rank automatically" runs the step at once
  (`PUT /api/website/settings`).
- **Only pieces the feed shows** are ranked: public **and with a photo**, so
  every exploration slot holds a piece that is really in the feed.

## The score (`src/lib/ranking/score.ts`)

All weights and thresholds are named constants in that one file.

| constant | value | meaning |
|---|---|---|
| `RANKING_WINDOW_DAYS` | 28 | days of rollups: the 28 analytics days ending yesterday |
| `RANKING_HALF_LIFE_DAYS` | 14 | a day counts half after 14 days (exponential decay, `0.5^(age/14)`) |
| `RANKING_MIN_VIEWS` | 50 | smoothing strength (visits that saw the look); also ends the cold start |
| `RANKING_MIN_TOTAL_VIEWS` | 200 | fewer visits that saw a look in the window (all ranked pieces, daily distinct visits summed) → newest first |
| `SCORE_WEIGHTS` | attention 0.40, curiosity 0.35, intent 0.25 | the three parts |
| `CURIOSITY_WEIGHTS` | ⅓ each | share of visits that swiped to a 2nd photo / showed details / opened the piece |
| `INTENT_WEIGHTS` | enquiries 0.35, restocks 0.15, shares 0.15, loves 0.20, stars 0.15 | per visit, plus review stars |
| `RANK_DWELL_CAP_SECONDS` (rollup.ts) | 60 | one visit's dwell on a piece counts for at most 60 s a day |
| `SIGNAL_INDEX_CAP` | 3 | no signal counts for more than 3× the average |
| `STARS_PRIOR_REVIEWS` | 5 | stars are smoothed as if each piece had 5 extra average reviews |
| `COLD_START_DAYS` / `COLD_START_BOOST` | 7 / 40 | new-piece boost (score points), fading to 0 over 7 days |
| `EXPLORATION_EVERY` | 5 | every 5th feed slot is an exploration slot |
| `AUTO_FEATURED_COUNT` | 6 | pieces Featured automatically |

**Signals: distinct visits, not events** (review: forged events). The
rollup (`ROLLUP_SELECTS.piece` in `src/lib/analytics/rollup.ts`) groups each
day's events by piece AND visit first, so a visit that repeats an event (or
sends 450 forged ones) counts once. Numerators count only visits that also
had a `look_view` of the piece that day (`viewers`, the denominator), so
every rate is at most 1. Columns (migration
`20261108090000_ranking_visit_rollups`): `dwellVisits`, `dwellVisitSeconds`,
`swipeVisits`, `detailsVisits`, `openVisits`, `enquiryVisits`,
`restockVisits`, `shareVisits`. Each is summed over the window with the decay
weight:

| signal | value | part |
|---|---|---|
| dwell | `dwellVisitSeconds / dwellVisits`: mean seconds per visit, each visit's day capped at 60 s (a mean, not a median) | Attention |
| photoSwipe | `swipeVisits / viewers` (reached a 2nd photo) | Curiosity |
| details | `detailsVisits / viewers` (Show details) | Curiosity |
| open | `openVisits / viewers`; "opened" = `OPEN_TYPES` (`product_open`, and ZP-510's `details_sheet_open`) | Curiosity |
| enquiries | `enquiryVisits / viewers` (WhatsApp) | Intent |
| restocks | `restockVisits / viewers` | Intent |
| shares | `shareVisits / viewers` | Intent |
| loves | hearts still there (`ProductLove` rows: one per device, an un-love deletes it), by the Harare day they were made, decayed, per `viewers`. Never `love_on` events | Intent |
| stars | mean stars of the piece's approved reviews (any date) | Intent (small quality factor) |

The event counts (`views`, `detailsShows`, `enquiries`, …) stay as they were
for the Insights page. Note for ZP-510: the details sheet replaces
navigating to the product page, so "opened" now also counts sheet opens, and
the meaning of `details_show` (the feed's eye) may shift relative to opens.

**Index of a signal.** Compared with the catalogue mean `p` (pooled over all
public pieces): raw index = `min(3, value / p)`, then smoothed toward 1 with
the Bayesian / credibility weight `n / (n + 50)`, where `n` is the signal's
decayed denominator (visits that saw it, or visits with a dwell):
`index = 1 + n/(n+50) · (raw − 1)`. Without the cap this is exactly the
smoothed rate `(x + 50·p) / (n + 50)` divided by `p`. A piece with no views
has index 1 everywhere (score 100); 3 lucky views barely move it ("no early
stars"); a signal nobody has (e.g. no restock requests anywhere) is 1 for all.
Stars use `count / (count + 5)` and the catalogue's mean stars.

**Score** = `100 × (0.40·Attention + 0.35·Curiosity + 0.25·Intent)`, where
Attention = the dwell index, Curiosity and Intent the weighted means of their
indices. **100 = an average look**; 130 = 30% better than average.

**Fair to position.** Only rates and mean dwell are used, never raw views, so
the first slide (which always gets the most views) gains nothing from its
place. The rollups do not keep the feed position of a view, so dwell is not
normalised by position (possible later: `look_view.position` is collected).

Stored in `ProductPopularity.parts` (JSON) for transparency: the three part
indices, `evidence` (`n/(n+50)` of the decayed views) and every signal's raw
value and index.

## Today's order (`src/lib/ranking/order.ts`)

1. **Effective score** = score + cold-start boost. A piece published less
   than 7 days ago with fewer than 50 visits in the window gets
   `40 × (1 − age/7)` points. The age is measured at the **start of the
   analytics day** (midnight Harare, `analyticsDayStart`), not at the time of
   the run, so the night run, a rerun and the owner's switch give the same
   order all day.
2. Available pieces by effective score (ties: newest first).
3. **Exploration:** slots 5, 10, 15, … take a random lower-ranked piece
   instead of the next best. The random generator is seeded with the
   analytics day (`vyra-feed:YYYY-MM-DD`, FNV-1a + mulberry32), so the order
   is the same all day for every visitor (cacheable) and the ranking cannot
   freeze.
4. Sold-out pieces last, by effective score (unchanged rule).
5. **Too little data** (fewer than 200 look views in the window): newest
   first, sold-out last, **no ranks stored** (`rank` null).

`ProductPopularity.rank` = the position in that order (1 = first). Rows
also say `coldStart` and `featured` (picked).

## Feed order on the storefront (`src/lib/ranking/feed-order.ts`)

- One cached entry (`getFeedRanking` in `src/lib/storefront/cached.ts`, the
  fourth argument-free entry): `{ mode, ranks: { ref: rank } }` for public
  pieces only, keyed by the public ref ("V-0099", from the product id, like
  `PublicProduct.ref`), not the slug, so a piece renamed since the cached
  answer keeps its place instead of jumping to the top as "new". Scores and parts never leave the server through it. Tags
  `storefront`, `storefront:ranking`, `storefront:settings`,
  `storefront:products`, `storefront:categories`; 60 s backstop.
- **AUTO:** available pieces by rank; pieces published since the nightly run
  (no rank yet: new, so cold start) come first, newest first; then sold-out
  pieces by rank. Availability is today's, so a piece that sold out during
  the day moves to the end at once.
- **NEWEST, or no ranks** (too little data): newest first, sold-out last.
  Featured gives no precedence.
- Collections (`?c=`) filter the same order.
- `feedProducts(products, ranking)` (`src/lib/storefront/feed.ts`); the menu's
  "N looks" counts call it without a ranking (order does not matter there).

**When a nightly change shows:** the job runs outside Next.js and cannot
expire the cache, so the new order and Featured flags appear when the cached
entries expire (60 s backstop; the first request after that still gets the
old answer while it refreshes, so allow about a minute or two). The settings
switch is an admin request and expires the whole storefront at once.

## Automatic Featured

- With "Rank automatically", every night the top `AUTO_FEATURED_COUNT` (6)
  public, **available** pieces **with a photo**, by **score** (no cold-start
  boost, no exploration), get `featured = true`; every other product (also
  unpublished ones) gets `false`. Only rows whose flag changes are written.
  With too little data: the 6 newest such pieces.
- Featured drives the shop's default "Featured" sort (Featured first).
- **Admin:** in the product editor's Website section the Featured box is
  disabled and reads "Featured automatically by popularity (score N, #R in
  today's feed)". The editor no longer sends `featured`.
- **API:** `PATCH /api/website/products/:id` refuses a `featured` value that
  differs from the current one with 400 (`field: "featured"`, "Featured is
  set automatically by popularity…") and saves nothing of that request; the
  same value is accepted and ignored (older forms). The bulk API
  (`parseBulkBody`) has no Featured action and refuses unknown fields. No
  other route writes `featured`. `GET` returns `featuredAuto` and
  `popularity { score, rank, computedAt }`.
- With "Newest first" the step leaves Featured alone and the owner sets it
  by hand again (the box is editable, the API accepts it).

## Admin switch (Website settings → "Feed order")

`SiteSettings.feedRanking`: `AUTO` "Rank automatically" (default) or
`NEWEST` "Newest first" (emergency fallback). Validated in
`src/lib/site-settings/validate.ts`. A change expires the whole storefront
(`settingsRevalidateScope` returns no scope). Switching to `AUTO` runs the
ranking step immediately (a failure there is logged; the switch is saved and
the nightly job ranks again). Not part of the public settings DTO.

## Insights (`docs/admin/insights.md`)

- **Top looks → Score:** the stored score (latest nightly run, last 28 days,
  not the selected range) with today's feed position (`#3`); sortable. Tapping
  a score opens "why it ranks there": Attention / Curiosity / Intent as ×
  the average with their weights and raw rates, how much is its own data,
  rank, new-piece boost, Featured. A note above the table says whether the
  feed is ranked, newest first (switch) or waiting for data, and when it was
  last calculated.
- **Top photos → Best cover photo:** "Use as first photo" moves that photo to
  the front of the gallery with the existing `PUT
  /api/website/products/:id/images` (`coverFirstOrder`); the first photo is the
  primary photo, the storefront cache is expired by that route.

## Data

Migration `20261107090000_popularity_ranking`: enum `FeedRanking`,
`SiteSettings.feedRanking` (default `AUTO`) and table `ProductPopularity`
(`productId` PK → Product, cascade; `day`, `score`, `parts` JSONB, `views`,
`rank`, `coldStart`, `featured`, `computedAt`). No data changes. Until the
first nightly run there are no rows, so the feed is newest first.

Migration `20261108090000_ranking_visit_rollups`: the eight distinct-visit
columns of `AnalyticsDailyPiece` (defaults 0, no data changes).

### After deploying

Days rolled up before `20261108090000` have zeros in the new columns, so
their visits would count with no dwell, swipes or enquiries. Re-roll the
ranking window once (raw events are kept 90 days), then the job ranks:
`npm run analytics:rollup -- --from <28 days ago> --to <yesterday>` (the
Cloud Run job with those args, see `docs/storefront/analytics.md`).

## Manipulation and residual risk

Anyone can send analytics events (anonymous, no sign-in), so the ranking
must not be cheap to buy.

**What is closed (simulation in `tests/ranking-manipulation-db.test.ts`):**
20 pieces with a week of honest traffic (6 visits per piece per day). Before
the review fix, **one visit with 450 forged events** (views, 60 s dwells,
details, opens, WhatsApp, shares, `love_on`) moved the 19th piece to **#1 by
score and into Featured** (event counts, `love_on` hearts). Now it stays
near the bottom (it counts as one visit with capped dwell), never #1, never
Featured. `love_on` events never count; hearts come from `ProductLove` (one
per device; the hearts endpoint allows 15 new device ids per IP per hour).

**What remains:** many *separate* forged visits. Each needs its own random
visit id and a full set of events (view, dwell, swipe, details, open,
WhatsApp, share). In the simulation, about **10 such scripted visits on top
of the 450-event one** put a low-traffic piece (42 honest visits in the week)
into Featured, because its own numbers are few and every forged visit "does
everything". On UAT-sized traffic that is cheap for someone who scripts it.
Limits that bound it: the events endpoint allows 300 new visit ids per IP
per hour, the per-visit and per-IP event budgets (`docs/storefront/analytics.md`),
the index cap (3×), smoothing (50 visits), the 28-day decayed window, and
pieces with more honest traffic need proportionally more forged visits.
**Mitigations for the owner:** Insights shows why a piece ranks (a piece
whose WhatsApp share is far above the real enquiries the owner receives is
suspicious); the "Newest first" switch stops ranking and automatic Featured
at once. **Not done (possible follow-ups):** dropping visits with abnormal
event rates (> N events per minute) or without a `visit_start`, which only
raises the cost of a script slightly; attributing visits to a hashed IP
bucket at ingest to cap visits per address per piece and day (no IP stored,
but a privacy-notice change).

## Tests

| file | covers |
|---|---|
| `tests/ranking.test.ts` | constants, decay and window, score maths per part (distinct-visit rates), hearts from ProductLove, review stars, cap, rates not views, input order (bit-identical), smoothing (3 lucky visits vs 300), decay (recent beats old), the 200-visit fallback, cold-start boost from the day start, exploration slots and per-day determinism, sold-out last, newest-first fallback, Featured top N, storefront order by public ref (AUTO / NEWEST / no ranks / unranked new pieces / renamed piece), the Featured policy, cover order |
| `tests/ranking-db.test.ts` | the nightly step against the DB (rows, ranks, parts, cold start, only pieces with a photo, Featured on/off incl. unpublished, idempotent), too little data, "Newest first" leaves Featured alone, the cached entry and feed order, the admin API (read-only Featured, same value accepted, manual with Newest first, no bulk path), the settings switch (validation, immediate ranking), hearts from ProductLove not `love_on`, concurrent runs (advisory lock), the settings save waiting for the row lock, `--no-rank` |
| `tests/ranking-rollup-db.test.ts` | the distinct-visit rollup columns vs raw events: one count per visit, only visits that saw the look, dwell capped at 60 s per visit, `OPEN_TYPES` incl. `details_sheet_open` |
| `tests/ranking-manipulation-db.test.ts` | the forged-event simulation above (< 6,000 events) |
| `tests/ranking-nightly.test.ts` | the job's steps: each in its own try/catch, the cleanup always runs, exit 1 when any failed |
