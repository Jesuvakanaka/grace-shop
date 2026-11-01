// ZP-501: one chunk of a video upload. OWNER only.
// PUT raw bytes (application/octet-stream), header X-Upload-Token from
// ../../uploads. Every chunk is exactly chunkSize bytes except the last.
// The body is read with a hard cap (never more than the expected chunk
// size); chunk 0 is sniffed and refused at once if it is not a video.
import { NextResponse } from 'next/server'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { getVideoStorage } from '@/lib/storage/videos'
import { badRequest, errorResponse, WebsiteError } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'
import { storeVideoChunk } from '@/lib/website/video'
import { verifyVideoUpload } from '@/lib/website/video-upload-token'
import { expectedChunkBytes, parseChunkIndex, VIDEO_REFUSALS } from '@/lib/website/video-validation'

type Ctx = { params: Promise<{ id: string; index: string }> }

export async function PUT(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const p = await params
  const id = parseIdParam(p.id)
  if (!id) return badRequest('Invalid product id')
  try {
    const upload = await verifyVideoUpload(request.headers.get('x-upload-token'), {
      productId: id,
      username: auth.session.username,
    })
    if (!upload) throw new WebsiteError(403, 'This upload has expired or belongs to another product. Please upload again.')
    const index = parseChunkIndex(p.index, upload.chunks)
    if (index === null) return badRequest('Invalid chunk index')
    // Refuse an oversized body from its declared length before reading it.
    const declared = Number(request.headers.get('content-length') ?? NaN)
    if (Number.isFinite(declared) && declared > expectedChunkBytes(upload.size, index)) {
      return NextResponse.json({ error: VIDEO_REFUSALS.tooLarge }, { status: 413 })
    }
    const { received } = await storeVideoChunk(getVideoStorage(), upload, index, request.body)
    return NextResponse.json({ index, received })
  } catch (error) {
    return errorResponse(error, 'store video chunk')
  }
}
