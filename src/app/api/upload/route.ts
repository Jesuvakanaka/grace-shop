// Owner-only product picture upload (ZP-468; replaces the ZP-465 follow-up).
// The real type is sniffed from the bytes, the picture is re-encoded to WebP
// (max 1200px, metadata stripped) and stored under a content-hashed key. The
// client's filename, extension and MIME type are never trusted.
import { NextResponse } from 'next/server'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { IMAGE_MAX_UPLOAD_BYTES, ImageRejectedError, saveProductImage } from '@/lib/storage/images'

export async function POST(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response

  let file: FormDataEntryValue | null
  try {
    file = (await request.formData()).get('file')
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form with a "file" field.' }, { status: 400 })
  }
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (file.size > IMAGE_MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large. Max ${IMAGE_MAX_UPLOAD_BYTES / 1024 / 1024} MB allowed.` },
      { status: 400 },
    )
  }

  try {
    const image = await saveProductImage(new Uint8Array(await file.arrayBuffer()))
    return NextResponse.json({ url: image.url, width: image.width, height: image.height })
  } catch (error) {
    if (error instanceof ImageRejectedError) return NextResponse.json({ error: error.message }, { status: 400 })
    console.error('Upload failed', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
