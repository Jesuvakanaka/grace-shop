-- ZP-1106 (MM-01): the shop's confirmed facts and who confirmed them. Additive only.
-- Rollback (down), after taking a backup:
--   ALTER TABLE "MarketingSettings" DROP COLUMN "market", DROP COLUMN "currency", DROP COLUMN "timeZone",
--     DROP COLUMN "salesMode", DROP COLUMN "contactRoute", DROP COLUMN "audienceNotes", DROP COLUMN "confirmations";
--   ALTER TABLE "MarketingSellingProfile" DROP COLUMN "confirmedBy", DROP COLUMN "confirmedAt";

-- AlterTable
ALTER TABLE "MarketingSettings" ADD COLUMN     "market" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "timeZone" TEXT,
ADD COLUMN     "salesMode" TEXT,
ADD COLUMN     "contactRoute" TEXT,
ADD COLUMN     "audienceNotes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "confirmations" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "MarketingSellingProfile" ADD COLUMN     "confirmedBy" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3);
