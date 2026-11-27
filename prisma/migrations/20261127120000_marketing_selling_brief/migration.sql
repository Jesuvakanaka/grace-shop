-- AlterTable
ALTER TABLE "MarketingSettings" ADD COLUMN     "shopDescription" TEXT,
ADD COLUMN     "policyDelivery" TEXT,
ADD COLUMN     "policyReturns" TEXT,
ADD COLUMN     "policyOrdering" TEXT;

-- AlterTable
ALTER TABLE "MarketingContent" ADD COLUMN     "job" TEXT,
ADD COLUMN     "reader" TEXT,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "proof" TEXT,
ADD COLUMN     "urgencyKind" TEXT,
ADD COLUMN     "urgencyText" TEXT,
ADD COLUMN     "action" TEXT;

-- AlterTable
ALTER TABLE "MarketingPost" ADD COLUMN     "aiOpenings" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "aiNotes" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "MarketingSellingProfile" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "buyers" JSONB NOT NULL DEFAULT '[]',
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "doubts" JSONB NOT NULL DEFAULT '[]',
    "occasions" JSONB NOT NULL DEFAULT '[]',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiCostCents" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSellingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSellingProfile_productId_key" ON "MarketingSellingProfile"("productId");

-- AddForeignKey
ALTER TABLE "MarketingSellingProfile" ADD CONSTRAINT "MarketingSellingProfile_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
