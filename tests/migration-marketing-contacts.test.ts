// ZP-1200: the marketing_contacts_partners migration is additive: new tables, one new settings column, no changes to existing data.
import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'migrations', '20261127000000_marketing_contacts_partners', 'migration.sql'),
  'utf8',
);

describe('migration: marketing_contacts_partners', () => {
  test('creates the five new tables', () => {
    for (const t of ['MarketingContact', 'MarketingConsent', 'MarketingBroadcast', 'MarketingBroadcastRecipient', 'MarketingPartner']) {
      assert.match(SQL, new RegExp(`CREATE TABLE "${t}"`));
    }
  });

  test('phone and email are unique per shop, nobody is sent a broadcast twice, partner codes are unique', () => {
    assert.match(SQL, /CREATE UNIQUE INDEX "MarketingContact_shopKey_phone_key" ON "MarketingContact"\("shopKey", "phone"\)/);
    assert.match(SQL, /CREATE UNIQUE INDEX "MarketingContact_shopKey_email_key" ON "MarketingContact"\("shopKey", "email"\)/);
    assert.match(SQL, /CREATE UNIQUE INDEX "MarketingBroadcastRecipient_broadcastId_contactId_key"/);
    assert.match(SQL, /CREATE UNIQUE INDEX "MarketingPartner_code_key"/);
  });

  test('consent rows and recipients follow their contact, and everything defaults to the safe side', () => {
    assert.match(SQL, /"MarketingConsent_contactId_fkey".*ON DELETE CASCADE/);
    assert.match(SQL, /"MarketingBroadcastRecipient_broadcastId_fkey".*ON DELETE CASCADE/);
    assert.match(SQL, /"status" TEXT NOT NULL DEFAULT 'DRAFT'/);
    assert.match(SQL, /"messageDailyCap" INTEGER NOT NULL DEFAULT 100/);
  });

  test('only adds: the one ALTER TABLE adds a column, nothing is dropped, deleted or renamed', () => {
    assert.doesNotMatch(SQL, /\bDROP\b/i);
    assert.doesNotMatch(SQL, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(SQL, /\bTRUNCATE\b/i);
    assert.doesNotMatch(SQL, /\bRENAME\b/i);
    assert.doesNotMatch(SQL, /ALTER COLUMN/i);
    const alters = SQL.match(/ALTER TABLE "\w+" (\w+ \w+)/g) ?? [];
    for (const a of alters) assert.match(a, /ADD (COLUMN|CONSTRAINT)/);
  });
});
