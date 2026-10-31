// ZP-475: the product_wholesale_fields migration applies cleanly on top of a
// 0_init database seeded by `npm run init`, and keeps existing product data.
//
// Opt-in (skipped by `npm test` unless the variable is set), because it needs
// an EMPTY local database of its own and takes ~30s:
//
//   docker exec grace-shop-postgres createdb -U grace grace_shop_zp475_mig
//   MIGRATION_TEST_DATABASE_URL=postgresql://grace:grace_local_dev@localhost:5433/grace_shop_zp475_mig \
//     node --import tsx --test tests/migration-product-wholesale.test.ts
//
// The URL must be local (checked with scripts/lib/db-safety.js) and the
// database must have no tables yet.
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import dbSafety from '../scripts/lib/db-safety.js';

const URL_ = process.env.MIGRATION_TEST_DATABASE_URL;
const ROOT = path.join(__dirname, '..');
const NEW_MIGRATION = '20261031093852_product_wholesale_fields';

const CHECKSUM_SQL = `
  select count(*)::int as products,
    md5(string_agg(row(id,"itemNumber","productName","unitCostRmb","unitCostUsd","sellingPriceRmb",
      "sellingPriceUsd","openingQuantity","currentQuantity","notes","imageUrl","createdAt","updatedAt")::text,
      ',' order by id)) as checksum
  from "Product"`;

function run(cmd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(cmd, { cwd: ROOT, env, shell: true, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `${cmd} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

describe('migration: product_wholesale_fields', { skip: !URL_ && 'set MIGRATION_TEST_DATABASE_URL to run' }, () => {
  test('applies on a seeded 0_init database with product data intact and new columns NULL', async () => {
    const env = { ...process.env, DATABASE_URL: URL_, DIRECT_URL: URL_ };
    const safety = dbSafety.checkDestructiveDbAllowed(env);
    assert.ok(safety.allowed, safety.reason);

    const prisma = new PrismaClient({ datasourceUrl: URL_ });
    try {
      const tables = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
      );
      assert.strictEqual(tables[0].n, 0, 'MIGRATION_TEST_DATABASE_URL must point at an empty database');

      // 1. Database as it was before this change: baseline only, then seed.
      run('npx prisma db execute --schema prisma/schema.prisma --file prisma/migrations/0_init/migration.sql', env);
      run('npx prisma migrate resolve --applied 0_init', env);
      run('node scripts/init-system.js', env);
      const before = await prisma.$queryRawUnsafe<{ products: number; checksum: string }[]>(CHECKSUM_SQL);
      assert.strictEqual(before[0].products, 48);

      // 2. Apply the pending migration exactly as deploys do.
      const out = run('npx prisma migrate deploy', env);
      assert.match(out, new RegExp(NEW_MIGRATION));

      // 3. Existing data unchanged, new columns empty, history up to date, no drift.
      const after = await prisma.$queryRawUnsafe<{ products: number; checksum: string }[]>(CHECKSUM_SQL);
      assert.deepStrictEqual(after, before);
      const nulls = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `select count(*)::int as n from "Product" where "wholesalePriceUsd" is null and "wholesaleMinQuantity" is null`,
      );
      assert.strictEqual(nulls[0].n, 48);
      assert.match(run('npx prisma migrate status', env), /Database schema is up to date/);
      run(`npx prisma migrate diff --from-url "${URL_}" --to-schema-datamodel prisma/schema.prisma --exit-code`, env);
    } finally {
      await prisma.$disconnect();
    }
  });
});
