// ZP-484: public product pictures, no sign-in.
// GET /api/images/public/<32 hex>.webp -> products/<32 hex>.webp, but only for
// a picture of a published product in a published category, or a published
// category's hero. Anything else is a plain 404 (never 401/403).
// Responsive sizes: /_next/image?url=/api/images/public/<key>&w=800&q=75.
// See docs/storefront/public-data-layer.md.
import prisma from '@/lib/db'
import { getImageStorage } from '@/lib/storage/images'
import { servePublicImage } from '@/lib/storefront/public-image'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  return servePublicImage(key, { db: prisma, storage: getImageStorage() })
}
