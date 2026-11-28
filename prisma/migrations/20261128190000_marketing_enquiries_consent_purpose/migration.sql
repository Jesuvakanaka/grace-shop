-- ZP-1116 / ZP-1117 (MM-11, MM-12): enquiries with their history, consent purpose, and the audience, count and cost
-- a message was approved for. Additive only: existing consent rows become PROMOTION, which is what they were for.
-- Rollback (down), after taking a backup:
--   DROP TABLE "MarketingEnquiryEvent";
--   DROP TABLE "MarketingEnquiry";
--   DROP INDEX "MarketingConsent_contactId_channel_purpose_recordedAt_idx";
--   ALTER TABLE "MarketingConsent" DROP COLUMN "purpose";
--   ALTER TABLE "MarketingBroadcast" DROP COLUMN "purpose", DROP COLUMN "approvedAudience", DROP COLUMN "approvedCount",
--     DROP COLUMN "approvedCostCents";
--   ALTER TABLE "MarketingSettings" DROP COLUMN "messageCostCents";
-- Note: a broadcast approved before this change has no frozen audience and must be approved again before it sends.

-- AlterTable
ALTER TABLE "MarketingBroadcast" ADD COLUMN     "approvedAudience" JSONB,
ADD COLUMN     "approvedCostCents" INTEGER,
ADD COLUMN     "approvedCount" INTEGER,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'PROMOTION';

-- AlterTable
ALTER TABLE "MarketingConsent" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'PROMOTION';

-- AlterTable
ALTER TABLE "MarketingSettings" ADD COLUMN     "messageCostCents" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "MarketingEnquiry" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "contactId" INTEGER,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "channelKind" TEXT NOT NULL,
    "conversation" TEXT NOT NULL DEFAULT 'OWNER_RECORDED',
    "sourceEvidence" TEXT,
    "trackingTag" TEXT,
    "campaignId" INTEGER,
    "productIds" JSONB NOT NULL DEFAULT '[]',
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "assignedTo" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "saleId" INTEGER,
    "externalEventId" TEXT,
    "needsContactReview" BOOLEAN NOT NULL DEFAULT false,
    "contactCandidates" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingEnquiryEvent" (
    "id" SERIAL NOT NULL,
    "enquiryId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "detail" JSONB,
    "actor" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingEnquiryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingEnquiry_saleId_key" ON "MarketingEnquiry"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingEnquiry_externalEventId_key" ON "MarketingEnquiry"("externalEventId");

-- CreateIndex
CREATE INDEX "MarketingEnquiry_shopKey_status_nextFollowUpAt_idx" ON "MarketingEnquiry"("shopKey", "status", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "MarketingEnquiry_contactId_idx" ON "MarketingEnquiry"("contactId");

-- CreateIndex
CREATE INDEX "MarketingEnquiryEvent_enquiryId_at_idx" ON "MarketingEnquiryEvent"("enquiryId", "at");

-- CreateIndex
CREATE INDEX "MarketingConsent_contactId_channel_purpose_recordedAt_idx" ON "MarketingConsent"("contactId", "channel", "purpose", "recordedAt");

-- AddForeignKey
ALTER TABLE "MarketingEnquiryEvent" ADD CONSTRAINT "MarketingEnquiryEvent_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "MarketingEnquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "MarketingEnquiry" ADD CONSTRAINT "MarketingEnquiry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "MarketingContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
