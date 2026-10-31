// ZP-484: read-only JSON list of public products, for client components
// (filters and "load more", ZP-489). Same DTO as the server data layer.
//
// GET /api/public/products?category=<slug>&new=1&featured=1&hideSoldOut=1
//     &sort=featured|newest|price-asc|price-desc|name&page=1&pageSize=24
// Only these parameters, each at most once; anything else is a 400.
// Rate limit: in-memory token bucket per client IP, 60 burst, 1/s refill.
// Best effort, per server instance. See docs/storefront/public-data-layer.md.
import { NextResponse, type NextRequest } from 'next/server'
import { listPublishedProducts } from '@/lib/storefront'
import { parsePublicProductsQuery } from '@/lib/storefront/public-products-query'
import { TokenBucketLimiter, clientKey } from '@/lib/storefront/rate-limit'

export const dynamic = 'force-dynamic'

const limiter = new TokenBucketLimiter({ capacity: 60, refillPerSecond: 1 })

export async function GET(request: NextRequest) {
  const limit = limiter.take(clientKey(request.headers))
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds), 'Cache-Control': 'no-store' } },
    )
  }

  const parsed = parsePublicProductsQuery(request.nextUrl.searchParams)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const page = await listPublishedProducts(parsed.options)
    return NextResponse.json(page, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=60',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Public products failed', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Unavailable' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
