-- CreateTable
CREATE TABLE "MarketingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "liveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlySpendCapCents" INTEGER NOT NULL DEFAULT 0,
    "metaPixelId" TEXT,
    "productFeedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "weeklyPostTarget" INTEGER NOT NULL DEFAULT 7,
    "brandVoice" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingChannel" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "externalId" TEXT,
    "credentialsEnc" TEXT,
    "tokenHint" TEXT,
    "config" JSONB,
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3),
    "connectedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "objective" TEXT NOT NULL DEFAULT 'AWARENESS',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "budgetCents" INTEGER,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignProduct" (
    "campaignId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,

    CONSTRAINT "MarketingCampaignProduct_pkey" PRIMARY KEY ("campaignId","productId")
);

-- CreateTable
CREATE TABLE "MarketingContent" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "campaignId" INTEGER,
    "productId" INTEGER,
    "title" TEXT NOT NULL,
    "brief" TEXT,
    "imageKeys" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPost" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "contentId" INTEGER NOT NULL,
    "channelKind" TEXT NOT NULL,
    "channelId" INTEGER,
    "format" TEXT NOT NULL DEFAULT 'POST',
    "text" TEXT NOT NULL,
    "imageKeys" JSONB NOT NULL DEFAULT '[]',
    "trackingTag" TEXT NOT NULL,
    "link" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledFor" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalId" TEXT,
    "externalUrl" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiCostCents" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAuditLog" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" INTEGER,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingChannel_shopKey_kind_idx" ON "MarketingChannel"("shopKey", "kind");

-- CreateIndex
CREATE INDEX "MarketingCampaign_shopKey_status_idx" ON "MarketingCampaign"("shopKey", "status");

-- CreateIndex
CREATE INDEX "MarketingContent_campaignId_idx" ON "MarketingContent"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingContent_productId_idx" ON "MarketingContent"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPost_trackingTag_key" ON "MarketingPost"("trackingTag");

-- CreateIndex
CREATE INDEX "MarketingPost_status_scheduledFor_idx" ON "MarketingPost"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "MarketingPost_contentId_idx" ON "MarketingPost"("contentId");

-- CreateIndex
CREATE INDEX "MarketingAuditLog_entity_entityId_idx" ON "MarketingAuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "MarketingAuditLog_createdAt_idx" ON "MarketingAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "MarketingCampaignProduct" ADD CONSTRAINT "MarketingCampaignProduct_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignProduct" ADD CONSTRAINT "MarketingCampaignProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContent" ADD CONSTRAINT "MarketingContent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContent" ADD CONSTRAINT "MarketingContent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPost" ADD CONSTRAINT "MarketingPost_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "MarketingContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPost" ADD CONSTRAINT "MarketingPost_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "MarketingChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

