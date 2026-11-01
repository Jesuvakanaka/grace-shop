// ZP-493: nightly analytics rollup + retention. Runs as a Cloud Run job
// (same image, command override) or locally:
//
//   npm run analytics:rollup                                 # yesterday (Harare), then prune
//   npm run analytics:rollup -- --date 2026-11-01            # one day again (idempotent)
//   npm run analytics:rollup -- --from 2026-11-01 --to 2026-11-30   # backfill
//   npm run analytics:rollup -- --no-prune                   # skip retention deletes
//
// Needs DATABASE_URL. Prints only counts. Exit code 1 on failure.
// Scheduling: docs/storefront/analytics.md ("Rollup job").
import { PrismaClient } from '@prisma/client'
import { parseRollupArgs, runRollup } from '../src/lib/analytics/rollup'

async function main() {
  const plan = parseRollupArgs(process.argv.slice(2))
  const prisma = new PrismaClient()
  try {
    const started = Date.now()
    const result = await runRollup(prisma, plan)
    console.log(
      JSON.stringify({
        job: 'analytics-rollup',
        from: plan.from,
        to: plan.to,
        days: result.days.length,
        pruned: result.pruned,
        ms: Date.now() - started,
      }),
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('analytics-rollup failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
