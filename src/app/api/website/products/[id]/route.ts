// ZP-483: a product's website fields. OWNER only.
// GET: fields, gallery, readiness. PATCH: allow-listed fields and the slug.
// Publishing is NOT done here: see ./publish (publishProduct).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'
import { getWebsiteProduct, updateWebsiteFields } from '@/lib/website/products'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseIdParam, parseProductWebsitePatch } from '@/lib/website/validation'

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
    const { oldSlug, slug } = await updateWebsiteFields(prisma, id, parsed.data)
    revalidateStorefront({ productSlugs: [oldSlug, slug] })
    return NextResponse.json(await getWebsiteProduct(prisma, id))
  } catch (error) {
    return errorResponse(error, 'update website product')
  }
}
