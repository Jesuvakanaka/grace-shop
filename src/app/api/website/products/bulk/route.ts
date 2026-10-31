// ZP-483: bulk website actions on selected products. OWNER only.
// { action: 'publish' | 'unpublish', ids }   each through publishProduct; per-product results.
// { action: 'set-category', ids, categoryId }
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { bulkPublish, bulkSetCategory } from '@/lib/website/products'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseBulkBody } from '@/lib/website/validation'

export async function POST(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const parsed = parseBulkBody(await readJson(request))
  if (!parsed.ok) return badRequest(parsed.error, parsed.field)
  const body = parsed.data
  try {
    if (body.action === 'set-category') {
      const { updated, slugs, category } = await bulkSetCategory(prisma, body.ids, body.categoryId)
      revalidateStorefront({ productSlugs: slugs, categorySlugs: [category.slug] })
      return NextResponse.json({ updated })
    }
    const result = await bulkPublish(prisma, body.ids, body.action === 'publish')
    if (result.succeeded > 0) {
      revalidateStorefront({ productSlugs: result.results.map((r) => ('slug' in r ? r.slug : null)) })
    }
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error, 'bulk website action')
  }
}
