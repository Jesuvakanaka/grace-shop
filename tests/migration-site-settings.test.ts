// ZP-486: the site_settings migration applies cleanly on a seeded database at
// the previous migration level, seeds exactly one SiteSettings row with the
// defaults, and leaves every existing table's data untouched (checksums).
//
// Same approach as migration-storefront-website-fields.test.ts: migrate fully,
// seed, undo this migration with DOWN_SQL and forget its _prisma_migrations
// row, prove with `prisma migrate diff` that the result is the previous level,
// take checksums, then run `prisma migrate deploy` exactly as deploys do.
//
// Opt-in (skipped by `npm test` unless the variable is set), because it needs
// an EMPTY local database of its own and takes ~30s:
//
//   docker exec grace-shop-postgres createdb -U grace grace_shop_zp486_mig
//   MIGRATION_TEST_DATABASE_URL=postgresql://grace:grace_local_dev@localhost:5433/grace_shop_zp486_mig \
//     node --import tsx --test tests/migration-site-settings.test.ts
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
import { SITE_SETTINGS_DEFAULTS } from '../src/lib/site-settings/schema'

const URL_ = process.env.MIGRATION_TEST_DATABASE_URL
const ROOT = path.join(__dirname, '..')
const NEW_MIGRATION = '20261101120000_site_settings'
const MIGRATION_SQL = path.join(ROOT, 'prisma', 'migrations', NEW_MIGRATION, 'migration.sql')
const DOWN_SQL = [`DROP TABLE "SiteSettings"`]

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
  const rev = added ? `${added}~1` : 'HEAD'
  const r = spawnSync('git', ['show', `${rev}:prisma/schema.prisma`], { cwd: ROOT, encoding: 'utf8' })
  assert.strictEqual(r.status, 0, r.stderr)
  assert.ok(!/model SiteSettings/.test(r.stdout), `schema at ${rev} already has SiteSettings`)
  return r.stdout
}

function seedSql(): string {
  const m = readFileSync(MIGRATION_SQL, 'utf8').match(/-- BEGIN seed[^\n]*\n([\s\S]*?)-- END seed/)
  assert.ok(m, 'migration.sql must mark the seed with -- BEGIN seed / -- END seed')
  return m[1]
}

describe('migration: site_settings', { skip: !URL_ && 'set MIGRATION_TEST_DATABASE_URL to run' }, () => {
  test('applies on a seeded previous-level database: one default row, existing data intact', async () => {
    const env = { ...process.env, DATABASE_URL: URL_, DIRECT_URL: URL_ }
    const safety = dbSafety.checkDestructiveDbAllowed(env)
    assert.ok(safety.allowed, safety.reason)

    const prisma = new PrismaClient({ datasourceUrl: URL_ })
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'zp486-mig-'))
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

      // 2. Checksum every row of every existing table (all columns).
      const names = (
        await prisma.$queryRawUnsafe<{ table_name: string }[]>(
          `select table_name from information_schema.tables
           where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> '_prisma_migrations'
           order by table_name`,
        )
      ).map((t) => t.table_name)
      assert.ok(names.includes('Product') && names.includes('StockMovement') && names.includes('User'))
      assert.ok(!names.includes('SiteSettings'))
      const checksums = async () => {
        const out: Record<string, { rows: number; md5: string | null }> = {}
        for (const t of names) {
          const [r] = await prisma.$queryRawUnsafe<{ rows: number; md5: string | null }[]>(
            `select count(*)::int as rows, md5(string_agg(x::text, ',' order by x::text)) as md5 from "${t}" x`,
          )
          out[t] = r
        }
        return out
      }
      const before = await checksums()
      assert.strictEqual(before.Product.rows, 48)

      // 3. Apply the pending migration exactly as deploys do.
      assert.match(run('npx prisma migrate deploy', env), new RegExp(NEW_MIGRATION))

      // 4. Existing data unchanged; exactly one row with the defaults.
      assert.deepStrictEqual(await checksums(), before)
      const rows = await prisma.siteSettings.findMany()
      assert.strictEqual(rows.length, 1)
      const { id, createdAt, updatedAt, updatedBy, ...data } = rows[0]
      assert.strictEqual(id, 1)
      assert.ok(createdAt instanceof Date && updatedAt instanceof Date)
      assert.strictEqual(updatedBy, null)
      assert.deepStrictEqual(data, { ...SITE_SETTINGS_DEFAULTS })

      // The seed is idempotent; the table is single-row; the threshold is ranged.
      assert.strictEqual(await prisma.$executeRawUnsafe(seedSql()), 0)
      await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO "SiteSettings" (id, "updatedAt") VALUES (2, now())`))
      await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "SiteSettings" SET "fewLeftThreshold" = 0`))
      assert.strictEqual(await prisma.siteSettings.count(), 1)

      assert.match(run('npx prisma migrate status', env), /Database schema is up to date/)
      run(`npx prisma migrate diff --from-url "${URL_}" --to-schema-datamodel prisma/schema.prisma --exit-code`, env)
    } finally {
      await prisma.$disconnect()
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
