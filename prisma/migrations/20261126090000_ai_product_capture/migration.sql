-- ZP-1100: AI product capture. Pre-order fields on Product, ProductImage.aiGenerated,
-- and the CaptureDraft table. Additive only: new columns have defaults or are NULL.

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('IN_STOCK', 'PRE_ORDER');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('NEW', 'GENERATING', 'READY', 'APPROVED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "CaptureImageMode" AS ENUM ('AI', 'OWN');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "listingType" "ListingType" NOT NULL DEFAULT 'IN_STOCK',
ADD COLUMN     "preorderExpectedQty" INTEGER,
ADD COLUMN     "preorderShipFrom" DATE,
ADD COLUMN     "preorderShipTo" DATE;

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CaptureDraft" (
    "id" SERIAL NOT NULL,
    "status" "CaptureStatus" NOT NULL DEFAULT 'NEW',
    "imageMode" "CaptureImageMode" NOT NULL,
    "listingType" "ListingType" NOT NULL DEFAULT 'IN_STOCK',
    "referenceKeys" TEXT[],
    "ownKeys" TEXT[],
    "generatedKeys" TEXT[],
    "unitCostRmb" DOUBLE PRECISION,
    "sellingPriceUsd" DOUBLE PRECISION,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "shipFrom" DATE,
    "shipTo" DATE,
    "audience" TEXT,
    "notes" TEXT,
    "listing" JSONB,
    "error" TEXT,
    "aiCostCents" INTEGER NOT NULL DEFAULT 0,
    "productId" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptureDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaptureDraft_productId_key" ON "CaptureDraft"("productId");

-- CreateIndex
CREATE INDEX "CaptureDraft_status_idx" ON "CaptureDraft"("status");

-- AddForeignKey
ALTER TABLE "CaptureDraft" ADD CONSTRAINT "CaptureDraft_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

