// ZP-501: a product's video. OWNER only.
// GET:    { video } (null when none), with signed-in preview URLs.
// POST:   { token } from ./uploads after every chunk was sent: assemble,
//         validate, transcode and store; answers { video } when READY, or
//         400 with the reason (too long, not a video, ...).
// DELETE: remove the video ({ video: null }).
// Adding or removing a video expires that product's storefront tags.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { getVideoStorage } from '@/lib/storage/videos'
import { badRequest, errorResponse, readJson, WebsiteError } from '@/lib/website/http'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseIdParam } from '@/lib/website/validation'
import { getAdminVideo, processVideoUpload, removeProductVideo, requireVideoProduct } from '@/lib/website/video'
import { verifyVideoUpload } from '@/lib/website/video-upload-token'

// Transcoding runs in this request (see docs/storefront/videos.md).
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  try {
    await requireVideoProduct(prisma, id)
    return NextResponse.json({ video: await getAdminVideo(prisma, id) })
  } catch (error) {
    return errorResponse(error, 'read product video')
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  const body = await readJson(request)
  const token = typeof body === 'object' && body !== null ? (body as { token?: unknown }).token : undefined
  if (typeof token !== 'string') return badRequest('Expected { token } from the upload.')
  try {
    const upload = await verifyVideoUpload(token, { productId: id, username: auth.session.username })
    if (!upload) throw new WebsiteError(403, 'This upload has expired or belongs to another product. Please upload again.')
    const video = await processVideoUpload(
      { db: prisma, storage: getVideoStorage(), revalidate: revalidateStorefront },
      upload,
    )
    return NextResponse.json({ video })
  } catch (error) {
    return errorResponse(error, 'process product video')
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  try {
    await removeProductVideo(prisma, id, revalidateStorefront)
    return NextResponse.json({ video: null })
  } catch (error) {
    return errorResponse(error, 'remove product video')
  }
}
