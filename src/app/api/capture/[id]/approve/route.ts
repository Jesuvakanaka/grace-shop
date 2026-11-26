// ZP-1100: approve a draft: create the product (and publish it if asked). OWNER only.
// A product that cannot be published yet is still created: the answer lists `missing`.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { approveDraft } from '@/lib/capture/approve'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseIdParam } from '@/lib/website/validation'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid draft id')
  const body = (await readJson(request)) as { publish?: unknown; itemNumber?: unknown } | undefined
  if (body?.itemNumber !== undefined && body.itemNumber !== null && typeof body.itemNumber !== 'string') {
    return badRequest('itemNumber must be text', 'itemNumber')
  }
  try {
    const result = await approveDraft(prisma, id, {
      publish: body?.publish === true,
      itemNumber: (body?.itemNumber as string | null | undefined) ?? null,
      username: auth.session.username,
    })
    if (result.published) revalidateStorefront({ productSlugs: [result.slug] })
    return NextResponse.json({ productId: result.productId, published: result.published, missing: result.missing })
  } catch (error) {
    return errorResponse(error, 'approve capture draft')
  }
}
