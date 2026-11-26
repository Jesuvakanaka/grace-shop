// ZP-1200: the Marketing hub runner. Publishes SCHEDULED posts that are due, but only when
// every go-live condition holds (GRACE_MARKETING_LIVE=true, live switch on in settings, channel
// connected, post approved). Otherwise posts stay SCHEDULED. Run it every few minutes
// (Cloud Run job / scheduler, not configured here) or by hand:
//
//   npm run marketing:run
//   npm run marketing:run -- --max 5
//
// Needs DATABASE_URL. Prints only counts and plain reasons, never tokens. Exits 1 if a post failed.
import { PrismaClient } from '@prisma/client'
import { hubEnabled } from '../src/lib/marketing/flags'
import { runDuePosts } from '../src/lib/marketing/publish'

async function main(): Promise<number> {
  if (!hubEnabled()) {
    console.log('marketing-run: the marketing hub is switched off (GRACE_MARKETING_HUB=false).')
    return 0
  }
  const i = process.argv.indexOf('--max')
  const max = i >= 0 ? Number(process.argv[i + 1]) : 10
  if (!Number.isInteger(max) || max < 1) {
    console.error('marketing-run: --max must be a whole number of 1 or more.')
    return 1
  }
  const prisma = new PrismaClient()
  try {
    const r = await runDuePosts(prisma, new Date(), { fetch: (u, init) => fetch(u, init) }, { max })
    console.log(JSON.stringify({ checked: r.checked, published: r.published.length, failed: r.failed.length, blocked: r.blocked.length, reason: r.reason }))
    return r.failed.length > 0 ? 1 : 0
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('marketing-run failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
