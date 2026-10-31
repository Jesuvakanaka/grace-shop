// ZP-468: serve product pictures from private storage to signed-in users.
// GET /api/images/<32 hex>.webp -> the object products/<32 hex>.webp.
import { NextResponse } from 'next/server'
import { authorize, ANY_ROLE } from '@/lib/api-auth'
import { getImageStorage, imageKeyFromFileName } from '@/lib/storage/images'

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await authorize(request, ANY_ROLE)
  if (!auth.ok) return auth.response

  const { key: fileName } = await params
  const key = imageKeyFromFileName(fileName)
  if (!key) return NextResponse.json({ error: 'Invalid image key' }, { status: 400 })

  try {
    const image = await getImageStorage().get(key)
    if (!image) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const headers: Record<string, string> = {
      'Content-Type': image.contentType,
      // Private: the picture is behind a login, so no shared caches.
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    }
    if (image.size !== null) headers['Content-Length'] = String(image.size)
    return new Response(image.stream, { status: 200, headers })
  } catch (error) {
    console.error('Image read failed', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Image unavailable' }, { status: 500 })
  }
}
