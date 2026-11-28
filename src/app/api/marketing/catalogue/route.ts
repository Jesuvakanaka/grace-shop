// ZP-1106 (MM-01): the existing catalogue with each product's truth (availability, wholesale terms,
// selling profile confirmation). Rows are the products themselves, by id. OWNER only. GET ?all=1 adds withdrawn ones.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { listCatalogue } from '@/lib/marketing/catalogue'
import { marketingAuth } from '@/lib/marketing/guard'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const all = new URL(request.url).searchParams.get('all') === '1'
    return NextResponse.json({ products: await listCatalogue(prisma, { includeWithdrawn: all }) })
  } catch (error) {
    return errorResponse(error, 'list marketing catalogue')
  }
}
