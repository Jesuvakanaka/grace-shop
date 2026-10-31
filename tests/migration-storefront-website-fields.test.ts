// ZP-482: the storefront_website_fields migration applies cleanly on a
// seeded database at the previous migration level, keeps every existing
// product column unchanged, and backfills one primary ProductImage per
// product whose imageUrl is a stored picture (/api/images/<32 hex>.webp).
//
// The seed (`npm run init`) uses the generated Prisma client, which already
// knows the new columns, so it cannot run on a database that is only at the
// previous level. The test therefore migrates fully, seeds, then undoes this
// migration with DOWN_SQL below and forgets its _prisma_migrations row. It
// then proves that the result really is the previous level: `prisma migrate
// diff` against the schema.prisma from before this migration reports no
// difference. Only then are checksums taken and `prisma migrate deploy` run.
//
// Opt-in (skipped by `npm test` unless the variable is set), because it needs
// an EMPTY local database of its own and takes ~30s:
//
//   docker exec grace-shop-postgres createdb -U grace grace_shop_zp482_mig
//   MIGRATION_TEST_DATABASE_URL=postgresql://grace:grace_local_dev@localhost:5433/grace_shop_zp482_mig \
//     node --import tsx --test tests/migration-storefront-website-fields.test.ts
//
// The URL must be local (checked with scripts/lib/db-safety.js) and the
// database must have no tables yet.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import dbSafety from '../scripts/lib/db-safety.js'

const URL_ = process.env.MIGRATION_TEST_DATABASE_URL
const ROOT = path.join(__dirname, '..')
const NEW_MIGRATION = '20261101090000_storefront_website_fields'
const MIGRATION_SQL = path.join(ROOT, 'prisma', 'migrations', NEW_MIGRATION, 'migration.sql')

// Reverses the migration on a seeded database (test only).
const DOWN_SQL = [
  `DROP TABLE "ProductSlugRedirect"`,
  `DROP TABLE "ProductImage"`,
  `ALTER TABLE "Product" DROP COLUMN "published", DROP COLUMN "publishedAt", DROP COLUMN "publicName",
     DROP COLUMN "slug", DROP COLUMN "publicDescription", DROP COLUMN "categoryId", DROP COLUMN "priceDisplay",
     DROP COLUMN "featured", DROP COLUMN "sortOrder", DROP COLUMN "colours", DROP COLUMN "sizes"`,
  `DROP TABLE "Category"`,
  `DROP TYPE "PriceDisplay"`,
]

const HASH_A = '0123456789abcdef0123456789abcdef'
const HASH_B = 'fedcba9876543210fedcba9876543210'

function run(cmd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(cmd, { cwd: ROOT, env, shell: true, encoding: 'utf8' })
  assert.strictEqual(r.status, 0, `${cmd} failed:\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}

/** schema.prisma as it was before this migration was added. */
function previousSchema(): string {
  const added = spawnSync('git', ['log', '--diff-filter=A', '--format=%H', '-1', '--', `prisma/migrations/${NEW_MIGRATION}`], {
    cwd: ROOT,
    encoding: 'utf8',
  }).stdout.trim()
  // Not committed yet: the previous schema is the committed one.
  const rev = added ? `${added}~1` : 'HEAD'
  const r = spawnSync('git', ['show', `${rev}:prisma/schema.prisma`], { cwd: ROOT, encoding: 'utf8' })
  assert.strictEqual(r.status, 0, r.stderr)
  assert.ok(!/model ProductImage/.test(r.stdout), `schema at ${rev} already has ProductImage`)
  return r.stdout
}

/** The backfill statement from the migration, so it can be run a second time. */
function backfillSql(): string {
  const sql = readFileSync(MIGRATION_SQL, 'utf8')
  const m = sql.match(/-- BEGIN backfill[^\n]*\n([\s\S]*?)-- END backfill/)
  assert.ok(m, 'migration.sql must mark the backfill with -- BEGIN backfill / -- END backfill')
  return m[1]
}

describe('migration: storefront_website_fields', { skip: !URL_ && 'set MIGRATION_TEST_DATABASE_URL to run' }, () => {
  test('applies on a seeded previous-level database: product data intact, defaults set, images backfilled once', async () => {
    const env = { ...process.env, DATABASE_URL: URL_, DIRECT_URL: URL_ }
    const safety = dbSafety.checkDestructiveDbAllowed(env)
    assert.ok(safety.allowed, safety.reason)

    const prisma = new PrismaClient({ datasourceUrl: URL_ })
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'zp482-mig-'))
    try {
      const tables = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
      )
      assert.strictEqual(tables[0].n, 0, 'MIGRATION_TEST_DATABASE_URL must point at an empty database')

      // 1. Migrate, seed, then return to the previous migration level.
      run('npx prisma migrate deploy', env)
      run('node scripts/init-system.js', env)
      for (const stmt of DOWN_SQL) await prisma.$executeRawUnsafe(stmt)
      await prisma.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE migration_name = '${NEW_MIGRATION}'`)
      const oldSchema = path.join(tmp, 'schema.prisma')
      writeFileSync(oldSchema, previousSchema())
      run(`npx prisma migrate diff --from-url "${URL_}" --to-schema-datamodel "${oldSchema}" --exit-code`, env)

      // 2. Two products with stored pictures, one with a picture that is not
      //    from our storage (must not be backfilled).
      const ids = await prisma.$queryRawUnsafe<{ id: number }[]>(`select id from "Product" order by id limit 3`)
      assert.strictEqual(ids.length, 3)
      await prisma.$executeRawUnsafe(`UPDATE "Product" SET "imageUrl" = $1 WHERE id = $2`, `/api/images/${HASH_A}.webp`, ids[0].id)
      await prisma.$executeRawUnsafe(`UPDATE "Product" SET "imageUrl" = $1 WHERE id = $2`, `/api/images/${HASH_B}.webp`, ids[1].id)
      await prisma.$executeRawUnsafe(`UPDATE "Product" SET "imageUrl" = $1 WHERE id = $2`, `https://example.test/x.jpg`, ids[2].id)

      // 3. Checksum every column the Product table has before the migration.
      const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'Product' order by ordinal_position`,
      )
      assert.ok(cols.length >= 20, `expected the full Product table, got ${cols.length} columns`)
      assert.ok(!cols.some((c) => c.column_name === 'published'))
      const list = cols.map((c) => `"${c.column_name}"`).join(',')
      const checksumSql = `select count(*)::int as products, md5(string_agg(row(${list})::text, ',' order by id)) as checksum from "Product"`
      const before = await prisma.$queryRawUnsafe<{ products: number; checksum: string }[]>(checksumSql)
      assert.strictEqual(before[0].products, 48)

      // 4. Apply the pending migration exactly as deploys do.
      const out = run('npx prisma migrate deploy', env)
      assert.match(out, new RegExp(NEW_MIGRATION))

      // 5. Existing columns unchanged; new defaults; backfill; up to date, no drift.
      assert.deepStrictEqual(await prisma.$queryRawUnsafe(checksumSql), before)
      const defaults = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `select count(*)::int as n from "Product"
         where published = false and "priceDisplay" = 'ASK_FOR_PRICE' and featured = false and "sortOrder" = 0
           and slug is null and "publicName" is null and "categoryId" is null and "publishedAt" is null`,
      )
      assert.strictEqual(defaults[0].n, 48)

      const imagesSql = `select "productId", "imageKey", "isPrimary", "sortOrder", alt from "ProductImage" order by "productId"`
      const images = await prisma.$queryRawUnsafe(imagesSql)
      assert.deepStrictEqual(images, [
        { productId: ids[0].id, imageKey: `products/${HASH_A}.webp`, isPrimary: true, sortOrder: 0, alt: null },
        { productId: ids[1].id, imageKey: `products/${HASH_B}.webp`, isPrimary: true, sortOrder: 0, alt: null },
      ])

      // Running the backfill again inserts nothing.
      const inserted = await prisma.$executeRawUnsafe(backfillSql())
      assert.strictEqual(inserted, 0)
      assert.deepStrictEqual(await prisma.$queryRawUnsafe(imagesSql), images)
      assert.strictEqual((await prisma.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from "Category"`))[0].n, 0)
      assert.strictEqual((await prisma.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from "ProductSlugRedirect"`))[0].n, 0)

      assert.match(run('npx prisma migrate status', env), /Database schema is up to date/)
      run(`npx prisma migrate diff --from-url "${URL_}" --to-schema-datamodel prisma/schema.prisma --exit-code`, env)
    } finally {
      await prisma.$disconnect()
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
