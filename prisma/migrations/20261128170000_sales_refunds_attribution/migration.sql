-- ZP-1118 (MM-13): refunds, cancellations and receipt keys on the existing sales ledger, plus one
-- marketing attribution row per sale. Additive only: existing sales become COMPLETED with no refunds.
-- Rollback (down), after taking a backup:
--   DROP TABLE "MarketingSaleAttribution";
--   DROP TABLE "SaleRefund";
--   DROP INDEX "Sale_externalRef_key";
--   ALTER TABLE "Sale" DROP COLUMN "externalRef", DROP COLUMN "status", DROP COLUMN "cancelledAt",
--     DROP COLUMN "cancelledBy", DROP COLUMN "cancelReason";
--   ALTER TABLE "CashPosition" DROP COLUMN "refundsPaid";
--   ALTER TABLE "DayClosing" DROP COLUMN "refundsPaid";
-- Note: rolling back after refunds were recorded loses them; their stock and cash effects stay applied.

-- AlterTable
ALTER TABLE "CashPosition" ADD COLUMN     "refundsPaid" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DayClosing" ADD COLUMN     "refundsPaid" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'COMPLETED';

-- CreateTable
CREATE TABLE "SaleRefund" (
    "id" SERIAL NOT NULL,
    "saleId" INTEGER NOT NULL,
    "saleItemId" INTEGER,
    "refundDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestKey" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "SaleRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSaleAttribution" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "saleId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "campaignId" INTEGER,
    "postId" INTEGER,
    "channelKind" TEXT,
    "contactId" INTEGER,
    "evidence" TEXT,
    "touchpoints" JSONB NOT NULL DEFAULT '[]',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "paymentEvidence" TEXT NOT NULL DEFAULT 'OWNER_RECORDED',
    "paymentNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSaleAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleRefund_requestKey_key" ON "SaleRefund"("requestKey");

-- CreateIndex
CREATE INDEX "SaleRefund_saleId_idx" ON "SaleRefund"("saleId");

-- CreateIndex
CREATE INDEX "SaleRefund_refundDate_idx" ON "SaleRefund"("refundDate");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSaleAttribution_saleId_key" ON "MarketingSaleAttribution"("saleId");

-- CreateIndex
CREATE INDEX "MarketingSaleAttribution_campaignId_idx" ON "MarketingSaleAttribution"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingSaleAttribution_source_needsReview_idx" ON "MarketingSaleAttribution"("source", "needsReview");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_externalRef_key" ON "Sale"("externalRef");

-- AddForeignKey
ALTER TABLE "SaleRefund" ADD CONSTRAINT "SaleRefund_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleRefund" ADD CONSTRAINT "SaleRefund_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSaleAttribution" ADD CONSTRAINT "MarketingSaleAttribution_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

