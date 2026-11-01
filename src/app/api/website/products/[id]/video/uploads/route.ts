// ZP-501: start a video upload. OWNER only.
// POST { size } (bytes, <= 60 MB) -> { token, chunkSize, chunks, expiresAt }.
// Then PUT each chunk to ../chunks/<index> with header X-Upload-Token, and
// POST { token } to .. to process it. Nothing is stored yet.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'
import { requireVideoProduct } from '@/lib/website/video'
import { signVideoUpload } from '@/lib/website/video-upload-token'
import { parseUploadStart, VIDEO_CHUNK_BYTES } from '@/lib/website/video-validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  const parsed = parseUploadStart(await readJson(request))
  if (!parsed.ok) return badRequest(parsed.error)
  try {
    await requireVideoProduct(prisma, id)
    const { token, upload, expiresAt } = await signVideoUpload({
      productId: id,
      size: parsed.data.size,
      username: auth.session.username,
    })
    return NextResponse.json({ token, chunkSize: VIDEO_CHUNK_BYTES, chunks: upload.chunks, expiresAt })
  } catch (error) {
    return errorResponse(error, 'start video upload')
  }
}
