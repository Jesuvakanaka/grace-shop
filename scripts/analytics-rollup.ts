// ZP-493: nightly analytics rollup + retention. Runs as a Cloud Run job
// (same image, command override) or locally:
//
//   npm run analytics:rollup                                 # day before yesterday + yesterday (Harare), then prune
//   npm run analytics:rollup -- --date 2026-11-01            # one day again (idempotent)
//   npm run analytics:rollup -- --from 2026-11-01 --to 2026-11-30   # backfill (last 90 days only)
//   npm run analytics:rollup -- --no-prune                   # skip retention deletes
//   npm run analytics:rollup -- --no-rank                    # skip the ZP-506 ranking step
//
// Steps, each in its own try/catch (src/lib/ranking/nightly.ts): the rollup,
// the popularity ranking (ZP-506, src/lib/ranking/job.ts) and the review-photo
// sweep (ZP-508). A failing step never skips the others; the job exits 1 at
// the end if any step failed. Bad arguments exit 1 before anything runs.
// Needs DATABASE_URL. Prints only counts.
// Scheduling: docs/storefront/analytics.md ("Rollup job").
import { PrismaClient } from '@prisma/client'
import { parseRollupArgs, runRollup } from '../src/lib/analytics/rollup'
import { runReviewPhotoCleanup } from '../src/lib/reviews/cleanup-job'
import { runRanking, splitRankArg } from '../src/lib/ranking/job'
import { runNightlySteps, type NightlyStep } from '../src/lib/ranking/nightly'

async function main(): Promise<number> {
  const { rank, rest } = splitRankArg(process.argv.slice(2))
  const plan = parseRollupArgs(rest)
  const prisma = new PrismaClient()
  try {
    const steps: NightlyStep[] = [
      {
        name: 'analytics-rollup',
        run: async () => {
          const result = await runRollup(prisma, plan)
          return { from: plan.from, to: plan.to, days: result.days.length, skipped: result.skipped, pruned: result.pruned }
        },
      },
    ]
    if (rank) {
      // ZP-506: popularity scores, today's feed ranks and the automatic Featured set.
      steps.push({
        name: 'ranking',
        run: async () => {
          const r = await runRanking(prisma)
          return { day: r.day, mode: r.mode, pieces: r.pieces, totalViews: r.totalViews, ranked: r.ranked, featuredChanged: r.featuredChanged.length }
        },
      })
    }
    // ZP-508: the nightly review-photo sweep always runs.
    steps.push({ name: 'reviews-cleanup', run: () => runReviewPhotoCleanup(prisma) })
    return await runNightlySteps(steps)
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('analytics-rollup failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
