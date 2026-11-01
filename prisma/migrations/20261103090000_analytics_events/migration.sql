-- ZP-493: first-party analytics. New tables only; no existing table changes.
-- Raw events (90 days) and daily rollups (25 months). No foreign keys.
-- See docs/storefront/analytics.md.

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" BIGSERIAL NOT NULL,
    "eventId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "day" DATE NOT NULL,
    "visitId" UUID NOT NULL,
    "deviceId" UUID,
    "type" VARCHAR(32) NOT NULL,
    "slug" VARCHAR(80),
    "productId" INTEGER,
    "page" VARCHAR(200),
    "collection" VARCHAR(80),
    "props" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyVisits" (
    "day" DATE NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "devices" INTEGER NOT NULL DEFAULT 0,
    "returningVisits" INTEGER NOT NULL DEFAULT 0,
    "endedVisits" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "totalSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "looksSeen" INTEGER NOT NULL DEFAULT 0,
    "enquiringVisits" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDailyVisits_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "AnalyticsDailySource" (
    "day" DATE NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "deviceClass" VARCHAR(16) NOT NULL,
    "campaign" VARCHAR(64) NOT NULL DEFAULT '',
    "visits" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "enquiringVisits" INTEGER NOT NULL DEFAULT 0,
    "totalSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailySource_pkey" PRIMARY KEY ("day","source","deviceClass","campaign")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyPiece" (
    "day" DATE NOT NULL,
    "productId" INTEGER NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "viewers" INTEGER NOT NULL DEFAULT 0,
    "dwellSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dwellCount" INTEGER NOT NULL DEFAULT 0,
    "photoViews" INTEGER NOT NULL DEFAULT 0,
    "videoStarts" INTEGER NOT NULL DEFAULT 0,
    "detailsShows" INTEGER NOT NULL DEFAULT 0,
    "productOpens" INTEGER NOT NULL DEFAULT 0,
    "sizeSelects" INTEGER NOT NULL DEFAULT 0,
    "colourSelects" INTEGER NOT NULL DEFAULT 0,
    "galleryZooms" INTEGER NOT NULL DEFAULT 0,
    "enquiries" INTEGER NOT NULL DEFAULT 0,
    "restockRequests" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "loveOn" INTEGER NOT NULL DEFAULT 0,
    "loveOff" INTEGER NOT NULL DEFAULT 0,
    "exits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailyPiece_pkey" PRIMARY KEY ("day","productId")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyPhoto" (
    "day" DATE NOT NULL,
    "productId" INTEGER NOT NULL,
    "photoIndex" INTEGER NOT NULL,
    "image" VARCHAR(64) NOT NULL DEFAULT '',
    "slug" VARCHAR(80) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "viewers" INTEGER NOT NULL DEFAULT 0,
    "dwellSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dwellCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailyPhoto_pkey" PRIMARY KEY ("day","productId","photoIndex","image")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyVideo" (
    "day" DATE NOT NULL,
    "productId" INTEGER NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "starts" INTEGER NOT NULL DEFAULT 0,
    "viewers" INTEGER NOT NULL DEFAULT 0,
    "replays" INTEGER NOT NULL DEFAULT 0,
    "reached25" INTEGER NOT NULL DEFAULT 0,
    "reached50" INTEGER NOT NULL DEFAULT 0,
    "reached75" INTEGER NOT NULL DEFAULT 0,
    "reached100" INTEGER NOT NULL DEFAULT 0,
    "watchSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailyVideo_pkey" PRIMARY KEY ("day","productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_eventId_key" ON "AnalyticsEvent"("eventId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_day_type_idx" ON "AnalyticsEvent"("day", "type");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_productId_day_idx" ON "AnalyticsEvent"("productId", "day");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_visitId_idx" ON "AnalyticsEvent"("visitId");

-- CreateIndex
CREATE INDEX "AnalyticsDailyPiece_productId_day_idx" ON "AnalyticsDailyPiece"("productId", "day");

-- CreateIndex
CREATE INDEX "AnalyticsDailyPhoto_productId_day_idx" ON "AnalyticsDailyPhoto"("productId", "day");

-- CreateIndex
CREATE INDEX "AnalyticsDailyVideo_productId_day_idx" ON "AnalyticsDailyVideo"("productId", "day");
