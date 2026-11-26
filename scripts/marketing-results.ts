// ZP-1200: pull marketing results into MarketingMetric: post visits and enquiries from the analytics rollup, reach
// and clicks from Facebook/Instagram insights (read only), and ad results from Meta. Safe to run any time, as often
// as you like (daily is enough). Needs DATABASE_URL. Prints counts only, never tokens.
//
//   npm run marketing:results
import { PrismaClient } from '@prisma/client'
import { hubEnabled } from '../src/lib/marketing/flags'
import { syncAllResults } from '../src/lib/marketing/results'

async function main(): Promise<number> {
  if (!hubEnabled()) {
    console.log('marketing-results: the marketing hub is switched off (GRACE_MARKETING_HUB=false).')
    return 0
  }
  const prisma = new PrismaClient()
  try {
    const s = await syncAllResults(prisma, { username: 'system', role: 'SYSTEM' }, { fetch: (u, init) => fetch(u, init) })
    console.log(JSON.stringify({ posts: s.posts, ads: s.ads, postInsightsFailed: s.postInsightsFailed.length, adsFailed: s.adsFailed.length }))
    for (const f of s.postInsightsFailed) console.log(`post ${f.postId}: ${f.error}`)
    for (const f of s.adsFailed) console.log(`ad ${f.adId}: ${f.error}`)
    return s.adsFailed.length > 0 ? 1 : 0
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('marketing-results failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
