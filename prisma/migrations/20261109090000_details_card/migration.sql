-- ZP-513: details card fields (size & fit, fabric & care, size charts, how to buy).
ALTER TABLE "Product" ADD COLUMN "fitNote" TEXT,
ADD COLUMN "fabric" TEXT,
ADD COLUMN "care" TEXT,
ADD COLUMN "sizeChart" JSONB;

ALTER TABLE "SiteSettings" ADD COLUMN "holdHours" INTEGER,
ADD COLUMN "paymentMethods" TEXT,
ADD COLUMN "defaultSizeChart" JSONB;
