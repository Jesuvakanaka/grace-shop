'use server'

// ZP-500: "load more" and tab switches for the landing feed. A server action
// is a public POST endpoint, so every argument is checked; it only reads the
// cached public catalogue (./feed-data.ts) and returns public slide DTOs.
import { isValidSlug } from '@/lib/storefront-model/slug'
import { FEED_PAGE_SIZE, type FeedItem } from './feed'
import { loadFeed } from './feed-data'

export type FeedActionResult = { tab: string; items: FeedItem[]; nextOffset: number | null; total: number }

export async function loadFeedAction(input: unknown): Promise<FeedActionResult> {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const tab = typeof raw.tab === 'string' && raw.tab.length <= 80 ? raw.tab : undefined
  const offset = typeof raw.offset === 'number' && Number.isFinite(raw.offset) ? raw.offset : 0
  const through = isValidSlug(raw.through) ? raw.through : null
  const { tab: resolved, page } = await loadFeed({ tab, offset, limit: FEED_PAGE_SIZE, through })
  return { tab: resolved, items: page.items, nextOffset: page.nextOffset, total: page.total }
}
