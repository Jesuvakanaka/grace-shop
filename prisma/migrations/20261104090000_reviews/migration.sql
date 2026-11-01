-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'HIDDEN');

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "googleReviewUrl" TEXT;

-- CreateTable
CREATE TABLE "ReviewInvite" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "shopOnly" BOOLEAN NOT NULL DEFAULT false,
    "productId" INTEGER,
    "customerHint" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "photoKey" TEXT,
    "photoUploads" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "inviteId" INTEGER NOT NULL,
    "shopOnly" BOOLEAN NOT NULL DEFAULT false,
    "productId" INTEGER,
    "stars" INTEGER NOT NULL,
    "shopStars" INTEGER,
    "comment" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "photoKey" TEXT,
    "photoConsent" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "ownerReply" TEXT,
    "ownerReplyAt" TIMESTAMP(3),
    "privateNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "moderatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewInvite_tokenHash_key" ON "ReviewInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "ReviewInvite_productId_idx" ON "ReviewInvite"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_inviteId_key" ON "Review"("inviteId");

-- CreateIndex
CREATE INDEX "Review_status_productId_idx" ON "Review"("status", "productId");

-- CreateIndex
CREATE INDEX "Review_photoKey_idx" ON "Review"("photoKey");

-- AddForeignKey
ALTER TABLE "ReviewInvite" ADD CONSTRAINT "ReviewInvite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "ReviewInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ZP-508: database-level guards (Prisma does not model CHECK constraints).
ALTER TABLE "Review" ADD CONSTRAINT "Review_stars_range" CHECK ("stars" BETWEEN 1 AND 5);
ALTER TABLE "Review" ADD CONSTRAINT "Review_shopStars_range" CHECK ("shopStars" IS NULL OR "shopStars" BETWEEN 1 AND 5);
ALTER TABLE "Review" ADD CONSTRAINT "Review_comment_length" CHECK (char_length("comment") BETWEEN 10 AND 1000);
ALTER TABLE "Review" ADD CONSTRAINT "Review_shopOnly_no_shopStars" CHECK (NOT "shopOnly" OR "shopStars" IS NULL);
ALTER TABLE "ReviewInvite" ADD CONSTRAINT "ReviewInvite_photoUploads_nonneg" CHECK ("photoUploads" >= 0);

