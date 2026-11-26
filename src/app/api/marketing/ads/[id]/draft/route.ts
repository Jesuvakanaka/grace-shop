// ZP-1200: AI writes the headline, text and description of a DRAFT ad. OWNER only. Never approves anything.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { draftAdCopy } from '@/lib/marketing/ai/ad-copy'
import { toAdDto } from '@/lib/marketing/ads'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid ad id')
  try {
    return NextResponse.json({ ad: toAdDto(await draftAdCopy(prisma, id, auth.session.username)) })
  } catch (error) {
    return errorResponse(error, 'draft ad copy')
  }
}
