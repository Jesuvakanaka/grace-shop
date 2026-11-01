# Insights (ZP-505)

Owner-only admin page **Insights** (`/insights`, nav: sidebar and "More" on
the phone) that shows how the VYRA storefront is used. It reads the
anonymous first-party analytics of ZP-493 (`docs/storefront/analytics.md`).

## Where the numbers come from

- **Rollups only.** Every report reads the daily rollup tables, one grouped,
  day-indexed query per table and one product query (no per-piece queries).
  Raw events are never read for a past day.
- **Today is live.** Today has no rollup yet. For today (and for yesterday
  until the nightly job at 02:30 Harare has rolled it up, i.e. no
  `AnalyticsDailyVisits` row but raw events exist) the page runs the **same
  rollup statements** as the nightly job (`rollupDayInTransaction`) inside a
  transaction that is **always rolled back**, then reads the rollup tables in
  that transaction. So "today" shows exactly what the nightly job will store,
  and nothing is written. It is bounded to one or two days of raw events by
  the `(day, type)` index, a 20 s statement timeout and a 30 s transaction
  limit. At 500,000 events a day the rollup takes about 2.5 s locally.
  Live answers are cached in memory for 60 s per range (per instance), so
  reloads and CSV downloads do not redo the work.
- The page says which days were counted live ("counted live just now").

## Date ranges

Analytics days in **Africa/Harare**. Presets end **today and include it**:
Today, 7 days (today + 6 before), 30 days. Custom: any `from`..`to` up to
today, at most 400 days, not older than the 25 months the rollups keep.

API: `GET /api/insights?range=today|7d|30d|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]`
returns the whole report as JSON (`src/lib/insights/types.ts`);
`&csv=<report>` downloads one report as CSV. OWNER only (401 signed out,
403 staff), `Cache-Control: private, no-store`. Not reachable on the
storefront host (`/api/...` and `insights` are blocked there by
`src/lib/host-routing.ts`).

## Reports

| # | Report | Source | Notes |
|---|---|---|---|
| 1 | Overview | Visits, Journey, Piece | visits, new vs returning, looks seen per visit (mean, over visits with a `visit_end`), time on site (mean visible seconds), WhatsApp taps (all taps of the visits, also from the menu), visits that tapped, restock requests, bounce rate, top sources |
| 2 | Top looks | Piece | views, mean dwell, photo-swipe rate (visits that reached a 2nd photo / viewers), Show details per view, opens per view, WhatsApp taps, shares; sortable; cover thumbnail; **Score** column is empty until ZP-506 fills `popularity` |
| 3 | Top photos per piece | Photo, Piece | mean seconds per photo, reach (photo viewers / the piece's viewers, or the most-seen photo's viewers when higher), "Best cover photo" when another photo holds people longer than the cover |
| 4 | Top videos | Video | starts, share of starts reaching 25/50/75/100 %, mean seconds watched per start, replays |
| 5 | Funnel + drop-off | Journey | landed → saw a 2nd look → Show details → opened a piece → chose a size → WhatsApp; % lost per step; by device and by source |
| 6 | Feed depth | Depth, Journey | share of visits reaching look 1…N, end-of-feed rate |
| 7 | Demand | Piece, Option, Product | restock requests per piece with the sizes asked (and whether it is sold out **now**), most-picked sizes / colours per piece, WhatsApp enquiries on pieces currently set to "Ask for price" |
| 8 | Sources & timing | Journey, Hour | visits / WhatsApp taps by source and by campaign (`?src=` tag), hour × weekday heatmap of visit starts (Harare) |
| 9 | Health | Health | slow loads (LCP > 4 s), load errors (image / video / feed / page), failed actions, per day (every day for ranges up to 31 days) |

Definitions worth knowing:

- **Funnel = furthest step.** A visit counts for every step up to the
  furthest one it reached, so steps never go up and "% lost" is meaningful.
  A visit that opened a shared link and tapped WhatsApp without scrolling
  counts as reaching every step. "Saw a 2nd look" = the larger of the
  visit's `visit_end.looks` and its distinct pieces with a `look_view` is ≥ 2.
- **Visit-based rows** (overview, journey, depth, hour) are by the day the
  visit **started**; a tap after midnight still counts for it. Piece, photo,
  video, option and health rows are by the day of the event, so per-piece
  WhatsApp taps can differ slightly from the overview near midnight.
- Rates per view (Show details, opens) can pass 100 % when a piece is opened
  directly (shared link) without a feed view.
- Seconds are **means**, never medians (rollups keep sums and counts).
- Daily distinct counts (viewers) are summed over the days of the range:
  someone who saw a piece on two days counts twice.
- "Ask for price" and "sold out now" are the piece's settings **today**, not
  at the time of the event.

## Small numbers

Below these thresholds (`THRESHOLDS` in `src/lib/insights/types.ts`) a row is
not ranked: it is shown greyed with e.g. "12 views – too few to rank" and
sorted below the ranked rows.

| what | threshold |
|---|---|
| look views (top looks, Ask-for-price rate) | 20 |
| photo dwells (best cover photo needs ≥ 2 photos with enough) | 10 |
| video starts | 10 |
| visits (overview averages, funnel / source segments, depth) | 20 |

## CSV

Every section has a CSV button (`&csv=overview|looks|photos|videos|funnel|depth|demand|sources|heatmap|health`).
UTF-8 with BOM (opens in Excel), CRLF, quoted per RFC 4180; text starting
with `= + - @`, tab or CR gets a leading `'` (no formula injection). Rates
are fractions 0..1, seconds are means. File name
`vyra-insights-<report>-<from>-to-<to>.csv`.

## Privacy

Only totals per day, source, device class, campaign tag, piece, photo and
option. No visit ids, device ids, IPs, private item numbers, costs or stock
quantities are in the API answer or the CSVs (the piece's public name is
used; "sold out now" is a yes/no). See `docs/storefront/analytics.md` for
what is collected at all.

## Rollups added for this page

Migration `20261105090000_analytics_insights_rollups` (new tables + one
column with a default; no data changes). Built by
`src/lib/analytics/rollup.ts`, tested in `tests/analytics-insights-rollup-db.test.ts`,
kept 25 months like the others:

- `AnalyticsDailyPiece.photoSwipers`: distinct visits with a `photo_view`
  at index ≥ 2.
- `AnalyticsDailyJourney` (`day, source, deviceClass, campaign`): visits,
  `reachedSecondLook`, `reachedDetails`, `reachedOpen`, `reachedSize`,
  `reachedWhatsapp` (furthest step), `feedEndVisits`, `whatsappTaps`.
- `AnalyticsDailyDepth` (`day, looks`): visits by looks seen (capped at 100).
- `AnalyticsDailyHour` (`day, hour`): visits by Harare hour of `visit_start`,
  enquiring visits, WhatsApp taps.
- `AnalyticsDailyHealth` (`day, kind, detail`): events and visits.
- `AnalyticsDailyOption` (`day, productId, kind, value`): size / colour
  picks, enquiries and restock requests carrying that option.

Journey, depth and hour come from one grouped pass over the visit's two
days into a temp table (`ON COMMIT DROP`), not three passes.

**After deploying:** days rolled up before this migration have no rows in
the new tables (and `photoSwipers` = 0). Re-roll them once (raw events are
kept 90 days):
`npm run analytics:rollup -- --from <first collection day> --to <yesterday>`
(the Cloud Run job with those args, see `docs/storefront/analytics.md`).

## Extension points

- **Hearts (ZP-507):** the looks table shows a "Hearts" column (`loveOn −
  loveOff`) only when the range has any heart events (`looks.hasHearts`).
- **Popularity (ZP-506):** fill `LookRow.popularity` in
  `src/lib/insights/report.ts`; the Score column already renders it.
- **Reviews (ZP-508):** add a section where the page marks it
  (`src/app/(admin)/insights/page.tsx`) once review data is in the answer.

## Files

| file | what |
|---|---|
| `src/app/(admin)/insights/page.tsx` | the page (range picker, section nav) |
| `src/components/insights/reports.tsx`, `parts.tsx` | the nine reports, bars, heatmap, tables |
| `src/app/api/insights/route.ts` | JSON / CSV endpoint, live cache |
| `src/lib/insights/report.ts` | the queries, live rolled-back rollup |
| `src/lib/insights/range.ts`, `csv.ts`, `types.ts` | ranges, CSV, report types and thresholds |
| `tests/insights-report-db.test.ts` | every number vs SQL on raw events; live today rolled back |
| `tests/insights-api.test.ts` | 401 / 403 / 400, JSON, CSV headers |
| `tests/insights-range-csv.test.ts` | ranges, CSV quoting and injection |
| `tests/analytics-insights-rollup-db.test.ts` | the new rollups vs raw events, idempotency, retention |
