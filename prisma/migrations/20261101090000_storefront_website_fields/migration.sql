-- CreateEnum
CREATE TYPE "PriceDisplay" AS ENUM ('SHOW_PRICE', 'ASK_FOR_PRICE');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "categoryId" INTEGER,
ADD COLUMN     "colours" TEXT,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceDisplay" "PriceDisplay" NOT NULL DEFAULT 'ASK_FOR_PRICE',
ADD COLUMN     "publicDescription" TEXT,
ADD COLUMN     "publicName" TEXT,
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "sizes" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "heroImageKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "imageKey" TEXT NOT NULL,
    "alt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSlugRedirect" (
    "id" SERIAL NOT NULL,
    "oldSlug" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSlugRedirect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_imageKey_key" ON "ProductImage"("productId", "imageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSlugRedirect_oldSlug_key" ON "ProductSlugRedirect"("oldSlug");

-- CreateIndex
CREATE INDEX "ProductSlugRedirect_productId_idx" ON "ProductSlugRedirect"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSlugRedirect" ADD CONSTRAINT "ProductSlugRedirect_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one primary image per product. Partial unique index: Prisma 6
-- cannot declare it in schema.prisma, so it exists only here.
CREATE UNIQUE INDEX "ProductImage_one_primary_per_product" ON "ProductImage"("productId") WHERE "isPrimary";

-- Backfill (ZP-482): each product whose imageUrl is a stored picture,
-- "/api/images/<32 hex>.webp", gets that picture as its primary gallery image.
-- imageKey is the storage object key "products/<32 hex>.webp" (see
-- src/lib/storage/keys.ts). Any other imageUrl is left alone. Idempotent:
-- products that already have a gallery image are skipped, and the
-- (productId, imageKey) unique index turns a repeat into a no-op.
-- BEGIN backfill
INSERT INTO "ProductImage" ("productId", "imageKey", "sortOrder", "isPrimary", "createdAt", "updatedAt")
SELECT p."id", 'products/' || substring(p."imageUrl" from 13), 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product" p
WHERE p."imageUrl" LIKE '/api/images/%'
  AND p."imageUrl" ~ '^/api/images/[a-f0-9]{32}\.webp$'
  AND NOT EXISTS (SELECT 1 FROM "ProductImage" i WHERE i."productId" = p."id")
ON CONFLICT DO NOTHING;
-- END backfill

