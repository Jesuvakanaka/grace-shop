// VYRA Marketing hub (ZP-1200): serves the public product feed. Server only.
// 404 unless GRACE_MARKETING_HUB is not "false" AND settings.productFeedEnabled. No auth: it is public product data.
import prisma from '@/lib/db'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import type { PublicProduct } from '@/lib/storefront/dto'
import { primaryStorefrontHost } from '@/lib/storefront/public-url'
import { buildFeedItems, feedCsv, feedRss } from './feed'
import { hubEnabled } from './flags'
import { getSettings } from './settings'

export interface FeedDeps {
  /** Default: every published product from the cached public catalogue. Tests inject a list. */
  loadProducts?: () => Promise<PublicProduct[]>
  settings?: () => Promise<{ productFeedEnabled: boolean }>
  hubOn?: boolean
}

/** Every published product from the cached public catalogue (public DTO only). */
export async function loadPublishedProducts(): Promise<PublicProduct[]> {
  const { listPublishedProducts } = await import('@/lib/storefront')
  const all: PublicProduct[] = []
  for (let page = 1; ; page++) {
    const r = await listPublishedProducts({ sort: 'newest', page, pageSize: 48, includeItemNumber: true })
    all.push(...r.items)
    if (page >= r.pageCount) return all
  }
}

const notFound = () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export async function serveFeed(request: Request, kind: 'csv' | 'xml', deps: FeedDeps = {}): Promise<Response> {
  if (!(deps.hubOn ?? hubEnabled())) return notFound()
  const settings = await (deps.settings ?? (() => getSettings(prisma)))()
  if (!settings.productFeedEnabled) return notFound()
  try {
    const { storefrontHosts } = hostRoutingConfigFromEnv()
    const host = request.headers.get('host')
    const items = buildFeedItems(await (deps.loadProducts ?? loadPublishedProducts)(), { storefrontHosts, host })
    const primary = primaryStorefrontHost(storefrontHosts)
    const siteLink = primary ? `https://${primary}/` : host ? `https://${host}/` : 'https://vyra.example/'
    const headers = { 'Cache-Control': 'public, max-age=300, s-maxage=300', 'X-Content-Type-Options': 'nosniff' }
    if (kind === 'csv') return new Response(feedCsv(items), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } })
    return new Response(feedRss(items, { title: 'VYRA', link: siteLink, description: 'VYRA products' }), { headers: { ...headers, 'Content-Type': 'application/rss+xml; charset=utf-8' } })
  } catch (error) {
    console.error('Marketing feed failed', error instanceof Error ? error.message : error)
    return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  }
}
