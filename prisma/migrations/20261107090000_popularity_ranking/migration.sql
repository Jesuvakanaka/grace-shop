-- ZP-506: popularity score and feed ranking. See docs/storefront/ranking.md.
-- New table + one settings column with a default; no data changes. Featured
-- flags are only changed by the nightly step (npm run analytics:rollup).

-- CreateEnum
CREATE TYPE "FeedRanking" AS ENUM ('AUTO', 'NEWEST');

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "feedRanking" "FeedRanking" NOT NULL DEFAULT 'AUTO';

-- CreateTable
CREATE TABLE "ProductPopularity" (
    "productId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "parts" JSONB NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "coldStart" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPopularity_pkey" PRIMARY KEY ("productId")
);

-- AddForeignKey
ALTER TABLE "ProductPopularity" ADD CONSTRAINT "ProductPopularity_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
