-- ZP-544: daily rollup of the feed-view A/B test (ZP-543). One new table, no
-- foreign keys, no changes to existing data. Filled by the nightly rollup
-- (src/lib/analytics/rollup.ts); days before this migration have no rows
-- (there were no test visits). See docs/storefront/analytics.md.

-- CreateTable
CREATE TABLE "AnalyticsDailyFeedView" (
    "day" DATE NOT NULL,
    "view" VARCHAR(8) NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "devices" INTEGER NOT NULL DEFAULT 0,
    "openVisits" INTEGER NOT NULL DEFAULT 0,
    "enquiringVisits" INTEGER NOT NULL DEFAULT 0,
    "restockVisits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailyFeedView_pkey" PRIMARY KEY ("day","view")
);
