// ZP-501: product videos and posters for signed-in users (the owner's
// preview in the Website panel and on a preview link), published or not.
// GET|HEAD /api/videos/<32 hex>.mp4|.webp, with HTTP Range.
import { authorize, ANY_ROLE } from '@/lib/api-auth'
import prisma from '@/lib/db'
import { getVideoStorage } from '@/lib/storage/videos'
import { serveVideoAsset } from '@/lib/website/video-delivery'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ key: string }> }

async function serve(request: Request, { params }: Ctx, method: 'GET' | 'HEAD') {
  const auth = await authorize(request, ANY_ROLE)
  if (!auth.ok) return auth.response
  const { key } = await params
  return serveVideoAsset(key, request, { visibility: 'private', db: prisma, storage: getVideoStorage(), method })
}

export async function GET(request: Request, ctx: Ctx) {
  return serve(request, ctx, 'GET')
}

export async function HEAD(request: Request, ctx: Ctx) {
  return serve(request, ctx, 'HEAD')
}
