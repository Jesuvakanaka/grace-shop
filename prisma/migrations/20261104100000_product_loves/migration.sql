-- ZP-507: "Love it" hearts. See docs/storefront/hearts.md.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "loveCount" INTEGER NOT NULL DEFAULT 0;

-- The count never goes below 0 (the code decrements only while > 0; this is the backstop).
ALTER TABLE "Product" ADD CONSTRAINT "Product_loveCount_nonnegative" CHECK ("loveCount" >= 0);

-- CreateTable
CREATE TABLE "ProductLove" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductLove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductLove_hash_key" ON "ProductLove"("hash");

-- CreateIndex
CREATE INDEX "ProductLove_productId_idx" ON "ProductLove"("productId");

-- AddForeignKey
ALTER TABLE "ProductLove" ADD CONSTRAINT "ProductLove_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
