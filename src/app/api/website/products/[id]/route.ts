// ZP-483: a product's website fields. OWNER only.
// GET: fields, gallery, readiness. PATCH: allow-listed fields and the slug.
// ZP-506: `featured` only while the feed is "Newest first" (else read-only).
// Publishing is NOT done here: see ./publish (publishProduct).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'
import { getWebsiteProduct, updateWebsiteFields } from '@/lib/website/products'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseIdParam, parseProductWebsitePatch } from '@/lib/website/validation'
import { featuredPatchCheck } from '@/lib/ranking/featured'
import { isAutoRanking } from '@/lib/ranking/job'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  try {
    const product = await getWebsiteProduct(prisma, id)
    return product ? NextResponse.json(product) : notFound()
  } catch (error) {
    return errorResponse(error, 'read website product')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  const parsed = parseProductWebsitePatch(await readJson(request))
  if (!parsed.ok) return badRequest(parsed.error, parsed.field)
  try {
    // ZP-506: while the feed ranks automatically, Featured is set by popularity
    // (nightly) and cannot be changed here; the same value is accepted and ignored.
    let patch = parsed.data
    if (patch.featured !== undefined) {
      const [auto, current] = await Promise.all([
        isAutoRanking(prisma),
        prisma.product.findUnique({ where: { id }, select: { featured: true } }),
      ])
      if (!current) return notFound()
      const check = featuredPatchCheck(patch, { auto, current: current.featured })
      if (!check.ok) return badRequest(check.error, check.field)
      patch = check.data
    }
    const { oldSlug, slug } = await updateWebsiteFields(prisma, id, patch)
    revalidateStorefront({ productSlugs: [oldSlug, slug] })
    return NextResponse.json(await getWebsiteProduct(prisma, id))
  } catch (error) {
    return errorResponse(error, 'update website product')
  }
}
