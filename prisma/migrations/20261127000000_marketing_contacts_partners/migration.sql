-- AlterTable
ALTER TABLE "MarketingSettings" ADD COLUMN     "messageDailyCap" INTEGER NOT NULL DEFAULT 100;

-- CreateTable
CREATE TABLE "MarketingContact" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingConsent" (
    "id" SERIAL NOT NULL,
    "contactId" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "evidence" TEXT,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingBroadcast" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "channelKind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "text" TEXT NOT NULL,
    "templateName" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'en',
    "templateVars" JSONB NOT NULL DEFAULT '[]',
    "audienceFilter" JSONB NOT NULL DEFAULT '{}',
    "trackingTag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "plannedCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingBroadcastRecipient" (
    "id" SERIAL NOT NULL,
    "broadcastId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "externalId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingBroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPartner" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "phone" TEXT,
    "handle" TEXT,
    "code" TEXT NOT NULL,
    "commissionPercent" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPartner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingContact_shopKey_name_idx" ON "MarketingContact"("shopKey", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContact_shopKey_phone_key" ON "MarketingContact"("shopKey", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContact_shopKey_email_key" ON "MarketingContact"("shopKey", "email");

-- CreateIndex
CREATE INDEX "MarketingConsent_contactId_channel_recordedAt_idx" ON "MarketingConsent"("contactId", "channel", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBroadcast_trackingTag_key" ON "MarketingBroadcast"("trackingTag");

-- CreateIndex
CREATE INDEX "MarketingBroadcast_status_scheduledFor_idx" ON "MarketingBroadcast"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "MarketingBroadcastRecipient_broadcastId_status_idx" ON "MarketingBroadcastRecipient"("broadcastId", "status");

-- CreateIndex
CREATE INDEX "MarketingBroadcastRecipient_status_sentAt_idx" ON "MarketingBroadcastRecipient"("status", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBroadcastRecipient_broadcastId_contactId_key" ON "MarketingBroadcastRecipient"("broadcastId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPartner_code_key" ON "MarketingPartner"("code");

-- CreateIndex
CREATE INDEX "MarketingPartner_shopKey_kind_idx" ON "MarketingPartner"("shopKey", "kind");

-- AddForeignKey
ALTER TABLE "MarketingConsent" ADD CONSTRAINT "MarketingConsent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "MarketingContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBroadcastRecipient" ADD CONSTRAINT "MarketingBroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "MarketingBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBroadcastRecipient" ADD CONSTRAINT "MarketingBroadcastRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "MarketingContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

