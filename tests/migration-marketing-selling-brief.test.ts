// The marketing_selling_brief migration is additive: one new table and new nullable / defaulted columns.
import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'migrations', '20261127120000_marketing_selling_brief', 'migration.sql'),
  'utf8',
);

describe('migration: marketing_selling_brief', () => {
  test('creates the selling profile, one per product, removed with its product', () => {
    assert.match(SQL, /CREATE TABLE "MarketingSellingProfile"/);
    assert.match(SQL, /CREATE UNIQUE INDEX "MarketingSellingProfile_productId_key"/);
    assert.match(SQL, /"MarketingSellingProfile_productId_fkey".*ON DELETE CASCADE/);
  });

  test('the brief, the shop policies, the openings and the notes are new columns that existing rows can leave empty', () => {
    for (const c of ['job', 'reader', 'message', 'proof', 'urgencyKind', 'urgencyText', 'action', 'shopDescription', 'policyDelivery', 'policyReturns', 'policyOrdering']) {
      assert.match(SQL, new RegExp(`ADD COLUMN\\s+"${c}" TEXT[,;]`), c);
    }
    assert.match(SQL, /"aiOpenings" JSONB NOT NULL DEFAULT '\[\]'/);
    assert.match(SQL, /"aiNotes" JSONB NOT NULL DEFAULT '\[\]'/);
  });

  test('only adds: nothing is dropped, deleted, renamed or retyped', () => {
    assert.doesNotMatch(SQL, /\bDROP\b/i);
    assert.doesNotMatch(SQL, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(SQL, /\bTRUNCATE\b/i);
    assert.doesNotMatch(SQL, /\bRENAME\b/i);
    assert.doesNotMatch(SQL, /ALTER COLUMN/i);
    const alters = SQL.match(/ALTER TABLE "\w+" (\w+ \w+)/g) ?? [];
    for (const a of alters) assert.match(a, /ADD (COLUMN|CONSTRAINT)/);
  });
});
