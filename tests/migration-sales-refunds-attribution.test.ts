// ZP-1118: the sales_refunds_attribution migration only adds: existing sales become COMPLETED, nothing else changes.
import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'migrations', '20261128170000_sales_refunds_attribution', 'migration.sql'),
  'utf8',
);
const RUN = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migration: sales_refunds_attribution', () => {
  test('existing rows get safe defaults: COMPLETED sales, no receipt key, no refunds paid', () => {
    assert.match(RUN, /ADD COLUMN\s+"status" TEXT NOT NULL DEFAULT 'COMPLETED'/);
    assert.match(RUN, /ADD COLUMN\s+"externalRef" TEXT[,;]/);
    assert.match(RUN, /"refundsPaid" DOUBLE PRECISION NOT NULL DEFAULT 0/);
    assert.match(RUN, /CREATE UNIQUE INDEX "Sale_externalRef_key"/);
    assert.match(RUN, /CREATE UNIQUE INDEX "MarketingSaleAttribution_saleId_key"/);
    assert.match(RUN, /CREATE UNIQUE INDEX "SaleRefund_requestKey_key"/);
  });

  test('only adds: nothing is dropped, deleted, renamed or retyped; the rollback is written down', () => {
    assert.doesNotMatch(RUN, /\bDROP\b/i);
    assert.doesNotMatch(RUN, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(RUN, /\bRENAME\b/i);
    assert.doesNotMatch(RUN, /ALTER COLUMN/i);
    assert.doesNotMatch(RUN, /^\s*UPDATE\b/m);
    for (const a of RUN.match(/ALTER TABLE "\w+" (\w+ \w+)/g) ?? []) assert.match(a, /ADD (COLUMN|CONSTRAINT)/);
    assert.match(SQL, /-- Rollback \(down\)/);
  });
});
