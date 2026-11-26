// ZP-1200: the marketing_ads migration is additive: new tables, indexes and foreign keys only.
import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'migrations', '20261126220000_marketing_ads', 'migration.sql'),
  'utf8',
);

describe('migration: marketing_ads', () => {
  test('creates the audience, ad and metric tables', () => {
    for (const t of ['MarketingAudience', 'MarketingAd', 'MarketingMetric']) {
      assert.match(SQL, new RegExp(`CREATE TABLE "${t}"`), `missing ${t}`);
    }
  });

  test('ads start as DRAFT with no budget, and the tracking tag is unique', () => {
    assert.match(SQL, /CREATE TABLE "MarketingAd"[\s\S]*"status" TEXT NOT NULL DEFAULT 'DRAFT'/);
    assert.match(SQL, /"dailyBudgetCents" INTEGER NOT NULL DEFAULT 0/);
    assert.match(SQL, /"spendCents" INTEGER NOT NULL DEFAULT 0/);
    assert.match(SQL, /CREATE UNIQUE INDEX "MarketingAd_trackingTag_key"/);
  });

  test('one metric row per entity per day', () => {
    assert.match(SQL, /CREATE UNIQUE INDEX "MarketingMetric_entity_entityId_day_key"/);
    assert.match(SQL, /"day" DATE NOT NULL/);
  });

  test('foreign keys set null so deleting a campaign, content or audience keeps the ad', () => {
    for (const c of ['campaignId', 'contentId', 'audienceId']) {
      assert.match(SQL, new RegExp(`"MarketingAd_${c}_fkey"[^;]*ON DELETE SET NULL`));
    }
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
