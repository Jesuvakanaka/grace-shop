// ZP-507: "Love it" hearts. POST { slug, on, device } -> 204, no body.
// All checks are in src/lib/loves/ingest.ts; the storefront host lets it
// through as part of /api/public/ (src/lib/host-routing.ts).
// See docs/storefront/hearts.md.
import { createLovesHandler } from '@/lib/loves/ingest'

export const dynamic = 'force-dynamic'

const handle = createLovesHandler()

export async function POST(request: Request): Promise<Response> {
  return handle(request)
}
