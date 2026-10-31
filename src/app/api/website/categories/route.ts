// ZP-483: website categories. OWNER only.
// GET: all categories (with product counts). POST: create. PUT { order }: reorder.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { CATEGORY_MAX, createCategory, listCategories, reorderCategories } from '@/lib/website/categories'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseCategoryInput, parseOrderBody } from '@/lib/website/validation'

export async function GET(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json(await listCategories(prisma))
  } catch (error) {
    return errorResponse(error, 'list categories')
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const parsed = parseCategoryInput(await readJson(request), { create: true })
  if (!parsed.ok) return badRequest(parsed.error, parsed.field)
  try {
    const category = await createCategory(prisma, parsed.data)
    revalidateStorefront({ categorySlugs: [category.slug] })
    return NextResponse.json(category, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'create category')
  }
}

export async function PUT(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const parsed = parseOrderBody(await readJson(request), CATEGORY_MAX)
  if (!parsed.ok) return badRequest(parsed.error)
  try {
    const categories = await reorderCategories(prisma, parsed.data)
    // The order is on every category entry.
    revalidateStorefront({ categorySlugs: categories.map((c) => c.slug) })
    return NextResponse.json(categories)
  } catch (error) {
    return errorResponse(error, 'reorder categories')
  }
}
