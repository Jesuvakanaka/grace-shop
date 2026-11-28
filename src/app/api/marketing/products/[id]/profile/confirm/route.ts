// ZP-1106 (MM-01-AC3): the owner confirms a product's selling profile as it stands. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { confirmProfile } from '@/lib/marketing/selling-profile'
import { badRequest, errorResponse } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  try {
    return NextResponse.json({ profile: await confirmProfile(prisma, id, auth.session.username) })
  } catch (error) {
    return errorResponse(error, 'confirm selling profile')
  }
}
