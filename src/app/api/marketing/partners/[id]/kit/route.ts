// ZP-1200: a partner's share kit: their tracked link, ready-made words and photos. OWNER only. ?productId= for one product.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { shareKit } from '@/lib/marketing/partners'
import { badRequest, errorResponse } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid partner id')
  try {
    const raw = new URL(request.url).searchParams.get('productId')
    const productId = raw ? parseIdParam(raw) : null
    if (raw && !productId) return badRequest('Invalid product id', 'productId')
    return NextResponse.json({ kit: await shareKit(prisma, id, { productId, host: request.headers.get('host') }) })
  } catch (error) {
    return errorResponse(error, 'get share kit')
  }
}
