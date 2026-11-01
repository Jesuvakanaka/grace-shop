-- ZP-505: rollups for the Insights page. New tables plus one new column with a
-- default on AnalyticsDailyPiece; no existing data changes. No foreign keys.
-- See docs/admin/insights.md and docs/storefront/analytics.md.

-- AlterTable
ALTER TABLE "AnalyticsDailyPiece" ADD COLUMN "photoSwipers" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AnalyticsDailyJourney" (
    "day" DATE NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "deviceClass" VARCHAR(16) NOT NULL,
    "campaign" VARCHAR(64) NOT NULL DEFAULT '',
    "visits" INTEGER NOT NULL DEFAULT 0,
    "reachedSecondLook" INTEGER NOT NULL DEFAULT 0,
    "reachedDetails" INTEGER NOT NULL DEFAULT 0,
    "reachedOpen" INTEGER NOT NULL DEFAULT 0,
    "reachedSize" INTEGER NOT NULL DEFAULT 0,
    "reachedWhatsapp" INTEGER NOT NULL DEFAULT 0,
    "feedEndVisits" INTEGER NOT NULL DEFAULT 0,
    "whatsappTaps" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailyJourney_pkey" PRIMARY KEY ("day","source","deviceClass","campaign")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyDepth" (
    "day" DATE NOT NULL,
    "looks" INTEGER NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailyDepth_pkey" PRIMARY KEY ("day","looks")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyHour" (
    "day" DATE NOT NULL,
    "hour" INTEGER NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "enquiringVisits" INTEGER NOT NULL DEFAULT 0,
    "whatsappTaps" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailyHour_pkey" PRIMARY KEY ("day","hour")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyHealth" (
    "day" DATE NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "detail" VARCHAR(40) NOT NULL DEFAULT '',
    "events" INTEGER NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailyHealth_pkey" PRIMARY KEY ("day","kind","detail")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyOption" (
    "day" DATE NOT NULL,
    "productId" INTEGER NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "value" VARCHAR(32) NOT NULL,
    "selects" INTEGER NOT NULL DEFAULT 0,
    "enquiries" INTEGER NOT NULL DEFAULT 0,
    "restockRequests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailyOption_pkey" PRIMARY KEY ("day","productId","kind","value")
);

-- CreateIndex
CREATE INDEX "AnalyticsDailyOption_productId_day_idx" ON "AnalyticsDailyOption"("productId", "day");
