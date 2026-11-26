// ZP-1200: published products with photos, for the pickers. OWNER only. GET ?q=&ids=1,2 (ids are always included).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { searchPublishedProducts } from '@/lib/marketing/product-picker'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const q = new URL(request.url).searchParams
  const ids = (q.get('ids') ?? '').split(',').map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50)
  try {
    return NextResponse.json({ products: await searchPublishedProducts(prisma, q.get('q'), { ids }) })
  } catch (error) {
    return errorResponse(error, 'list marketing products')
  }
}
