-- ZP-486: VYRA site settings. One row (id = 1) with the website contacts,
-- opening hours, socials, about copy, home hero, SEO defaults and the
-- availability threshold. Creates a new table only; no existing table changes.

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "whatsappNumber" TEXT,
    "enquiryTemplate" TEXT NOT NULL DEFAULT 'Hi VYRA, I''m interested in {product} ({url})',
    "generalEnquiryMessage" TEXT NOT NULL DEFAULT 'Hi VYRA, I''d like to ask about your collection.',
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "openingHours" JSONB,
    "holidayNote" TEXT,
    "mapUrl" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "tiktokUrl" TEXT,
    "aboutHeadline" TEXT,
    "aboutStory" TEXT,
    "aboutImageKey" TEXT,
    "heroHeadline" TEXT NOT NULL DEFAULT 'Style Your Way',
    "heroSubline" TEXT NOT NULL DEFAULT 'Premium fashion. Modern you.',
    "heroImageKeyDesktop" TEXT,
    "heroImageKeyMobile" TEXT,
    "statement" TEXT NOT NULL DEFAULT 'Confidence in every stitch',
    "trustLabel1" TEXT NOT NULL DEFAULT 'Premium Quality',
    "trustLabel2" TEXT NOT NULL DEFAULT 'Visit Our Store',
    "trustLabel3" TEXT NOT NULL DEFAULT 'Enquire on WhatsApp',
    "seoTitle" TEXT NOT NULL DEFAULT 'VYRA',
    "seoDescription" TEXT NOT NULL DEFAULT 'Premium fashion. Modern you.',
    "seoShareImageKey" TEXT,
    "fewLeftThreshold" INTEGER NOT NULL DEFAULT 3,
    "showItemNumber" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id"),
    -- Single-row table. Prisma 6 cannot declare CHECK constraints, so this
    -- exists only here; `prisma migrate diff` does not report it as drift.
    CONSTRAINT "SiteSettings_single_row" CHECK ("id" = 1),
    CONSTRAINT "SiteSettings_fewLeftThreshold_range" CHECK ("fewLeftThreshold" BETWEEN 1 AND 50)
);

-- BEGIN seed (idempotent: the column defaults above are the seeded values)
INSERT INTO "SiteSettings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
-- END seed
