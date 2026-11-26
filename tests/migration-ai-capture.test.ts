// ZP-1100: the ai_product_capture migration is additive: it adds the enums,
// Product pre-order columns, ProductImage.aiGenerated and the CaptureDraft
// table, and drops or rewrites nothing.
import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'migrations', '20261126090000_ai_product_capture', 'migration.sql'),
  'utf8',
);

describe('migration: ai_product_capture', () => {
  test('creates the three enums', () => {
    assert.match(SQL, /CREATE TYPE "ListingType" AS ENUM \('IN_STOCK', 'PRE_ORDER'\)/);
    assert.match(SQL, /CREATE TYPE "CaptureStatus" AS ENUM \('NEW', 'GENERATING', 'READY', 'APPROVED', 'REJECTED', 'FAILED'\)/);
    assert.match(SQL, /CREATE TYPE "CaptureImageMode" AS ENUM \('AI', 'OWN'\)/);
  });

  test('adds the Product and ProductImage columns', () => {
    assert.match(SQL, /ALTER TABLE "Product" ADD COLUMN\s+"listingType" "ListingType" NOT NULL DEFAULT 'IN_STOCK'/);
    for (const c of ['"preorderExpectedQty" INTEGER', '"preorderShipFrom" DATE', '"preorderShipTo" DATE']) {
      assert.ok(SQL.includes(c), `missing ${c}`);
    }
    assert.match(SQL, /ALTER TABLE "ProductImage" ADD COLUMN\s+"aiGenerated" BOOLEAN NOT NULL DEFAULT false/);
  });

  test('creates CaptureDraft with its index and SET NULL foreign key', () => {
    assert.match(SQL, /CREATE TABLE "CaptureDraft"/);
    assert.match(SQL, /CREATE UNIQUE INDEX "CaptureDraft_productId_key"/);
    assert.match(SQL, /CREATE INDEX "CaptureDraft_status_idx"/);
    assert.match(SQL, /FOREIGN KEY \("productId"\) REFERENCES "Product"\("id"\) ON DELETE SET NULL/);
  });

  test('drops and deletes nothing', () => {
    assert.doesNotMatch(SQL, /\bDROP\b/i);
    assert.doesNotMatch(SQL, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(SQL, /\bTRUNCATE\b/i);
    assert.doesNotMatch(SQL, /\bRENAME\b/i);
    assert.doesNotMatch(SQL, /ALTER COLUMN/i);
  });
});
