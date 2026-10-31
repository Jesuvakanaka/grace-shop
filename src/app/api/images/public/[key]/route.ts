// ZP-484: public product pictures, no sign-in.
// GET /api/images/public/<32 hex>.webp[?w=320|480|640|828|1080|1200|1600]
//   -> products/<32 hex>.webp (original, or a WebP resized to that width),
// but only for a picture of a published product in a published category, or
// a published category's hero. Anything else is a plain 404 (never 401/403).
// Storefront components use <img srcset> (publicImageSrcSet), not next/image.
// See docs/storefront/public-data-layer.md.
import type { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { getImageStorage } from '@/lib/storage/images'
import { servePublicImage } from '@/lib/storefront/public-image'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  return servePublicImage(key, request.nextUrl.searchParams, { db: prisma, storage: getImageStorage() })
}
