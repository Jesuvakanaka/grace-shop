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
       AnalyticsDailyPiece (28 days) + approved Review stars
         → score per public piece                           src/lib/ranking/score.ts
         → today's order + automatic Featured               src/lib/ranking/order.ts
         → ProductPopularity (replaced) + Product.featured
  3. review photo cleanup (ZP-508)
storefront feed
  getFeedRanking() (one cached entry: mode + rank per slug) → orderFeedByRanking   src/lib/ranking/feed-order.ts
```

- The step needs nothing but the database. `--no-rank` skips it
  (`npm run analytics:rollup -- --no-rank`). Its output is one JSON line:
  `{"job":"ranking","day":…,"mode":…,"pieces":…,"totalViews":…,"ranked":…,"featuredChanged":…}`.
  A failure fails the job (exit 1) after the rollups were written.
- **Idempotent:** one transaction; the table is replaced; the result depends
  only on the rollups, the reviews, the products and the analytics day
  (Harare). Running it again the same day gives identical rows and changes no
  Featured flag (tested).
- The owner switching back to "Rank automatically" runs the step at once
  (`PUT /api/website/settings`).

## The score (`src/lib/ranking/score.ts`)

All weights and thresholds are named constants in that one file.

| constant | value | meaning |
|---|---|---|
| `RANKING_WINDOW_DAYS` | 28 | days of rollups: the 28 analytics days ending yesterday |
| `RANKING_HALF_LIFE_DAYS` | 14 | a day counts half after 14 days (exponential decay, `0.5^(age/14)`) |
| `RANKING_MIN_VIEWS` | 50 | smoothing strength; also ends the cold start |
| `RANKING_MIN_TOTAL_VIEWS` | 200 | fewer look views in the window (all public pieces) → newest first |
| `SCORE_WEIGHTS` | attention 0.40, curiosity 0.35, intent 0.25 | the three parts |
| `CURIOSITY_WEIGHTS` | ⅓ each | photo-swipe rate, Show details per view, product opens per view |
| `INTENT_WEIGHTS` | enquiries 0.35, restocks 0.15, shares 0.15, loves 0.20, stars 0.15 | per view, plus review stars |
| `SIGNAL_INDEX_CAP` | 3 | no signal counts for more than 3× the average |
| `STARS_PRIOR_REVIEWS` | 5 | stars are smoothed as if each piece had 5 extra average reviews |
| `COLD_START_DAYS` / `COLD_START_BOOST` | 7 / 40 | new-piece boost (score points), fading to 0 over 7 days |
| `EXPLORATION_EVERY` | 5 | every 5th feed slot is an exploration slot |
| `AUTO_FEATURED_COUNT` | 6 | pieces Featured automatically |

**Signals** (from `AnalyticsDailyPiece`, every numerator and denominator
summed over the window with the decay weight):

| signal | value | part |
|---|---|---|
| dwell | `dwellSeconds / dwellCount` (mean seconds per look view; rollups keep sums, so a mean, not a median) | Attention |
| photoSwipe | `photoSwipers / viewers` | Curiosity |
| details | `detailsShows / views` | Curiosity |
| open | `productOpens / views` | Curiosity |
| enquiries | `enquiries / views` (WhatsApp) | Intent |
| restocks | `restockRequests / views` | Intent |
| shares | `shares / views` | Intent |
| loves | `max(0, loveOn − loveOff) / views` | Intent |
| stars | mean stars of the piece's approved reviews (any date) | Intent (small quality factor) |

**Index of a signal.** Compared with the catalogue mean `p` (pooled over all
public pieces): raw index = `min(3, value / p)`, then smoothed toward 1 with
the Bayesian / credibility weight `n / (n + 50)`, where `n` is the signal's
decayed denominator (views, viewers or dwell count):
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
   than 7 days ago with fewer than 50 views in the window gets
   `40 × (1 − age/7)` points.
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
  fourth argument-free entry): `{ mode, ranks: { slug: rank } }` for public
  pieces only. Scores and parts never leave the server through it. Tags
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

## Tests

| file | covers |
|---|---|
| `tests/ranking.test.ts` | constants, decay and window, score maths per part, net loves, review stars, cap, rates not views, smoothing (3 lucky views vs 300), decay (recent beats old), the 200-view fallback, cold-start boost, exploration slots and per-day determinism, sold-out last, newest-first fallback, Featured top N, storefront order (AUTO / NEWEST / no ranks / unranked new pieces), the Featured policy, cover order |
| `tests/ranking-db.test.ts` | the nightly step against the DB (rows, ranks, parts, cold start, Featured on/off incl. unpublished, idempotent), too little data, "Newest first" leaves Featured alone, the cached entry and feed order, the admin API (read-only Featured, same value accepted, manual with Newest first, no bulk path), the settings switch (validation, immediate ranking), `--no-rank` |
