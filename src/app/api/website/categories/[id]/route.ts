// ZP-483: one website category. OWNER only.
// PATCH: rename, slug, description, hero image, publish. DELETE: only when empty.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { deleteCategory, updateCategory } from '@/lib/website/categories'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseCategoryInput, parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid category id')
  const parsed = parseCategoryInput(await readJson(request), { create: false })
  if (!parsed.ok) return badRequest(parsed.error, parsed.field)
  try {
    const { oldSlug, category } = await updateCategory(prisma, id, parsed.data)
    // storefront:categories is also on product entries (category name and visibility).
    revalidateStorefront({ categorySlugs: [oldSlug, category.slug] })
    return NextResponse.json(category)
  } catch (error) {
    return errorResponse(error, 'update category')
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid category id')
  try {
    const { slug } = await deleteCategory(prisma, id)
    revalidateStorefront({ categorySlugs: [slug] })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error, 'delete category')
  }
}
