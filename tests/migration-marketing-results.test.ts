// ZP-1200: the marketing_results migration is additive: one new table and one index.
import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'migrations', '20261126230000_marketing_results', 'migration.sql'),
  'utf8',
);

describe('migration: marketing_results', () => {
  test('creates the recommendation table with safe defaults', () => {
    assert.match(SQL, /CREATE TABLE "MarketingRecommendation"/);
    assert.match(SQL, /"shopKey" TEXT NOT NULL DEFAULT 'vyra'/);
    assert.match(SQL, /"status" TEXT NOT NULL DEFAULT 'NEW'/);
    assert.match(SQL, /"aiCostCents" INTEGER NOT NULL DEFAULT 0/);
    assert.match(SQL, /"weekOf" DATE NOT NULL/);
    assert.match(SQL, /"data" JSONB,/);
  });

  test('drops, deletes and alters nothing existing', () => {
    assert.doesNotMatch(SQL, /\bDROP\b/i);
    assert.doesNotMatch(SQL, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(SQL, /\bTRUNCATE\b/i);
    assert.doesNotMatch(SQL, /\bRENAME\b/i);
    assert.doesNotMatch(SQL, /ALTER COLUMN/i);
    assert.doesNotMatch(SQL, /ALTER TABLE/i);
  });
});
