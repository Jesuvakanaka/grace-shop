// ZP-501: public product videos and posters, no sign-in.
// GET|HEAD /api/videos/public/<32 hex>.mp4   -> videos/<32 hex>.mp4  (video/mp4, HTTP Range)
// GET|HEAD /api/videos/public/<32 hex>.webp  -> videos/<32 hex>.webp (poster)
// Only for a READY video of a public product; everything else is a plain 404.
// See src/lib/website/video-delivery.ts and docs/storefront/videos.md.
import prisma from '@/lib/db'
import { getVideoStorage } from '@/lib/storage/videos'
import { serveVideoAsset } from '@/lib/website/video-delivery'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ key: string }> }

async function serve(request: Request, { params }: Ctx, method: 'GET' | 'HEAD') {
  const { key } = await params
  return serveVideoAsset(key, request, { visibility: 'public', db: prisma, storage: getVideoStorage(), method })
}

export async function GET(request: Request, ctx: Ctx) {
  return serve(request, ctx, 'GET')
}

export async function HEAD(request: Request, ctx: Ctx) {
  return serve(request, ctx, 'HEAD')
}
