// ZP-493: first-party analytics collection. POST only, 204, no body.
// Batches from src/lib/analytics/client.ts (sendBeacon text/plain, or fetch
// keepalive). All checks are in src/lib/analytics/ingest.ts; the storefront
// host lets it through as part of /api/public/ (src/lib/host-routing.ts).
// See docs/storefront/analytics.md.
import { createEventsHandler } from '@/lib/analytics/ingest'

export const dynamic = 'force-dynamic'

const handle = createEventsHandler()

export async function POST(request: Request): Promise<Response> {
  return handle(request)
}
