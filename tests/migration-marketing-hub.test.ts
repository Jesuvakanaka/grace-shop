// ZP-1200: the marketing_hub migration is additive: new tables, indexes and foreign keys only.
import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'migrations', '20261126200000_marketing_hub', 'migration.sql'),
  'utf8',
);

describe('migration: marketing_hub', () => {
  test('creates the seven marketing tables', () => {
    for (const t of ['MarketingSettings', 'MarketingChannel', 'MarketingCampaign', 'MarketingCampaignProduct', 'MarketingContent', 'MarketingPost', 'MarketingAuditLog']) {
      assert.match(SQL, new RegExp(`CREATE TABLE "${t}"`), `missing ${t}`);
    }
  });

  test('safe defaults: live off, no spend, status DRAFT', () => {
    assert.match(SQL, /"liveEnabled" BOOLEAN NOT NULL DEFAULT false/);
    assert.match(SQL, /"monthlySpendCapCents" INTEGER NOT NULL DEFAULT 0/);
    assert.match(SQL, /CREATE TABLE "MarketingPost"[\s\S]*"status" TEXT NOT NULL DEFAULT 'DRAFT'/);
  });

  test('tracking tag is unique and foreign keys are as specified', () => {
    assert.match(SQL, /CREATE UNIQUE INDEX "MarketingPost_trackingTag_key"/);
    assert.match(SQL, /"MarketingPost_contentId_fkey"[^;]*ON DELETE CASCADE/);
    assert.match(SQL, /"MarketingPost_channelId_fkey"[^;]*ON DELETE SET NULL/);
    assert.match(SQL, /"MarketingContent_campaignId_fkey"[^;]*ON DELETE SET NULL/);
    assert.match(SQL, /"MarketingCampaignProduct_productId_fkey"[^;]*ON DELETE CASCADE/);
  });

  test('drops, deletes and alters nothing existing', () => {
    assert.doesNotMatch(SQL, /\bDROP\b/i);
    assert.doesNotMatch(SQL, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(SQL, /\bTRUNCATE\b/i);
    assert.doesNotMatch(SQL, /\bRENAME\b/i);
    assert.doesNotMatch(SQL, /ALTER COLUMN/i);
    assert.doesNotMatch(SQL, /ALTER TABLE "(?!Marketing)/);
  });
});
