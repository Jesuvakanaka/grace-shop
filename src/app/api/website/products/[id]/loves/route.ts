// ZP-507: reset a piece's "Love it" hearts (e.g. after abuse). OWNER only.
// DELETE -> { loveCount: 0, removed }: the count is 0 and every stored heart
// hash of the piece is forgotten (phones can love it again). The storefront
// shows the new count at once (the piece's cache entries are expired).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { resetLoves } from '@/lib/loves/db'
import { badRequest, errorResponse, notFound } from '@/lib/website/http'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseIdParam } from '@/lib/website/validation'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  try {
    const product = await prisma.product.findUnique({ where: { id }, select: { slug: true } })
    if (!product) return notFound()
    const { removed } = await resetLoves(prisma, id)
    revalidateStorefront({ productSlugs: [product.slug] })
    return NextResponse.json({ loveCount: 0, removed })
  } catch (error) {
    return errorResponse(error, 'reset loves')
  }
}
