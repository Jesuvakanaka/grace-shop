-- CreateTable
CREATE TABLE "MarketingRecommendation" (
    "id" SERIAL NOT NULL,
    "shopKey" TEXT NOT NULL DEFAULT 'vyra',
    "weekOf" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "aiCostCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingRecommendation_weekOf_status_idx" ON "MarketingRecommendation"("weekOf", "status");
