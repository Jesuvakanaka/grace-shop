-- ZP-543: the feed view setting (Clean view / Info view / A/B test). One
-- settings column with a default; no data changes. CLEAN keeps today's feed.

-- CreateEnum
CREATE TYPE "FeedView" AS ENUM ('CLEAN', 'INFO', 'AB');

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "feedView" "FeedView" NOT NULL DEFAULT 'CLEAN';
