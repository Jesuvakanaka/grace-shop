// ZP-1200: which products to promote this week (ranked from data in the database, no AI call). OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { suggestProducts } from '@/lib/marketing/ai/suggest'
import { marketingAuth } from '@/lib/marketing/guard'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 10)
    return NextResponse.json({ suggestions: await suggestProducts(prisma, { limit: Number.isFinite(limit) ? limit : 10 }) })
  } catch (error) {
    return errorResponse(error, 'get suggestions')
  }
}
