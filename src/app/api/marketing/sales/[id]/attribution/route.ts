// ZP-1118 (MM-13-AC1/AC2): one sale's campaign link. GET reads it, PUT sets or replaces it (one row per sale). OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { getAttribution, linkSale } from '@/lib/marketing/sale-attribution'
import { errorResponse, readJson, WebsiteError } from '@/lib/website/http'

type Ctx = { params: Promise<{ id: string }> }
const saleIdOf = async (ctx: Ctx) => {
  const n = Number((await ctx.params).id)
  if (!Number.isInteger(n) || n <= 0) throw new WebsiteError(404, 'Sale not found')
  return n
}

export async function GET(request: Request, ctx: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ attribution: await getAttribution(prisma, await saleIdOf(ctx)) })
  } catch (error) {
    return errorResponse(error, 'get sale attribution')
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const id = await saleIdOf(ctx)
    return NextResponse.json(await linkSale(prisma, id, await readJson(request), auth.session.username))
  } catch (error) {
    return errorResponse(error, 'link sale')
  }
}
