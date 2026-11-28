// ZP-1106: the marketing_shop_truth migration is additive: new nullable / defaulted columns only.
import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'migrations', '20261128150000_marketing_shop_truth', 'migration.sql'),
  'utf8',
);
// The rollback notes at the top are comments; the checks below read only the SQL that runs.
const RUN = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migration: marketing_shop_truth', () => {
  test('the shop facts are new columns existing rows can leave empty', () => {
    for (const c of ['market', 'currency', 'timeZone', 'salesMode', 'contactRoute']) assert.match(RUN, new RegExp(`ADD COLUMN\\s+"${c}" TEXT[,;]`), c);
    assert.match(RUN, /"audienceNotes" JSONB NOT NULL DEFAULT '\[\]'/);
    assert.match(RUN, /"confirmations" JSONB NOT NULL DEFAULT '\{\}'/);
    assert.match(RUN, /"confirmedBy" TEXT/);
    assert.match(RUN, /"confirmedAt" TIMESTAMP\(3\)[,;]/);
  });

  test('only adds: nothing is dropped, deleted, renamed or retyped; the rollback is written down', () => {
    assert.doesNotMatch(RUN, /\bDROP\b/i);
    assert.doesNotMatch(RUN, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(RUN, /\bRENAME\b/i);
    assert.doesNotMatch(RUN, /ALTER COLUMN/i);
    for (const a of RUN.match(/ALTER TABLE "\w+" (\w+ \w+)/g) ?? []) assert.match(a, /ADD COLUMN/);
    assert.match(SQL, /-- Rollback \(down\)/);
  });
});
