// ZP-483: issue a 30-minute storefront preview token for one product. OWNER only.
// The storefront product page that reads it is ZP-490; until then the URL 404s
// (see STOREFRONT_PRODUCT_PAGE_READY).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { ensureProductSlug } from '@/lib/storefront-model/db'
import { badRequest, errorResponse } from '@/lib/website/http'
import { previewUrlFor, signPreviewToken } from '@/lib/website/preview-token'
import { parseIdParam } from '@/lib/website/validation'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  try {
    // The preview URL needs a slug; generating one is harmless (it is what publishing would do).
    const slug = await ensureProductSlug(prisma, id)
    const { token, expiresAt } = await signPreviewToken(id)
    return NextResponse.json(
      { token, expiresAt, url: previewUrlFor(slug, token) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return errorResponse(error, 'issue preview token')
  }
}
