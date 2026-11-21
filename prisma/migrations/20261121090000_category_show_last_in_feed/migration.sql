-- ZP-1019: "Show after ladies' pieces in the feed". One category column with a
-- default; no data changes. false keeps today's feed order for every category.

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "showLastInFeed" BOOLEAN NOT NULL DEFAULT false;
