// ZP-483: publish or unpublish one product, only through publishProduct. OWNER only.
// Not ready -> 422 { error, missing } and nothing is written.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { publishProduct } from '@/lib/storefront-model/db'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { notReadyMessage } from '@/lib/website/products'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseIdParam, parsePublishBody } from '@/lib/website/validation'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  const parsed = parsePublishBody(await readJson(request))
  if (!parsed.ok) return badRequest(parsed.error)
  try {
    const result = await publishProduct(prisma, id, { publish: parsed.data.publish })
    if (!result.ok) {
      return NextResponse.json({ error: notReadyMessage(result.missing), missing: result.missing }, { status: 422 })
    }
    revalidateStorefront({ productSlugs: [result.slug] })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error, 'publish product')
  }
}
