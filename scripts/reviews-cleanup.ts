// ZP-508: delete review photos nothing needs any more (links that expired
// unused, photos without consent). Also runs at the end of the nightly
// analytics rollup job. Needs DATABASE_URL and, in production,
// GRACE_IMAGE_STORAGE / GRACE_IMAGE_BUCKET. Prints only counts.
//
//   npm run reviews:cleanup
import { PrismaClient } from '@prisma/client'
import { runReviewPhotoCleanup } from '../src/lib/reviews/cleanup-job'

async function main() {
  const prisma = new PrismaClient()
  try {
    console.log(JSON.stringify({ job: 'reviews-cleanup', ...(await runReviewPhotoCleanup(prisma)) }))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('reviews-cleanup failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
