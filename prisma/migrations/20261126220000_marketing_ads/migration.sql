-- CreateTable
CREATE TABLE "MarketingAudience" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'AD_TARGETING',
    "targeting" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAd" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "campaignId" INTEGER,
    "contentId" INTEGER,
    "audienceId" INTEGER,
    "channelKind" TEXT NOT NULL DEFAULT 'META_ADS',
    "objective" TEXT NOT NULL DEFAULT 'TRAFFIC',
    "headline" TEXT NOT NULL,
    "primaryText" TEXT NOT NULL,
    "description" TEXT,
    "imageKeys" JSONB NOT NULL DEFAULT '[]',
    "link" TEXT,
    "trackingTag" TEXT NOT NULL,
    "dailyBudgetCents" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "externalCampaignId" TEXT,
    "externalAdSetId" TEXT,
    "externalCreativeId" TEXT,
    "externalAdId" TEXT,
    "spendCents" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "error" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiCostCents" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMetric" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "entity" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spendCents" INTEGER NOT NULL DEFAULT 0,
    "enquiries" INTEGER NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingAudience_shopKey_kind_idx" ON "MarketingAudience"("shopKey", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAd_trackingTag_key" ON "MarketingAd"("trackingTag");

-- CreateIndex
CREATE INDEX "MarketingAd_status_idx" ON "MarketingAd"("status");

-- CreateIndex
CREATE INDEX "MarketingAd_campaignId_idx" ON "MarketingAd"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingMetric_entity_day_idx" ON "MarketingMetric"("entity", "day");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMetric_entity_entityId_day_key" ON "MarketingMetric"("entity", "entityId", "day");

-- AddForeignKey
ALTER TABLE "MarketingAd" ADD CONSTRAINT "MarketingAd_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAd" ADD CONSTRAINT "MarketingAd_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "MarketingContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAd" ADD CONSTRAINT "MarketingAd_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "MarketingAudience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

