// ZP-513: the cached "people asked about it this week" counts. Server only.
// The query is ./asked-query.ts. One cache entry for every visitor, refreshed
// every 5 minutes; the public DTO only ever gets the piece's number.
import 'server-only'
import { unstable_cache } from 'next/cache'
import prisma from '@/lib/db'
import { countAskedBySlug } from './asked-query'

/** How long the counts are cached (seconds). */
export const ASKED_CACHE_SECONDS = 300

export const getAskedBySlug = unstable_cache(() => countAskedBySlug(prisma), ['storefront:asked:v1'], {
  revalidate: ASKED_CACHE_SECONDS,
  tags: ['storefront:asked'],
})
