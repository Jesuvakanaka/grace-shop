-- ZP-506 review: distinct-visit columns for the popularity ranking, so forged
-- or repeated events in one visit count once. New columns with defaults; no
-- data changes. Days rolled up before this have zeros here: re-roll the last
-- 28 days once after deploying (docs/storefront/ranking.md, "After deploying").

-- AlterTable
ALTER TABLE "AnalyticsDailyPiece" ADD COLUMN     "detailsVisits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dwellVisitSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "dwellVisits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "enquiryVisits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "openVisits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "restockVisits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shareVisits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "swipeVisits" INTEGER NOT NULL DEFAULT 0;
