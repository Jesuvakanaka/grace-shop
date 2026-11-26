// ZP-1200: marketing content ideas (each with its per-channel posts). OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { createContent, listContent } from '@/lib/marketing/content'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const raw = new URL(request.url).searchParams.get('campaignId')
  const campaignId = raw ? parseIdParam(raw) : null
  if (raw && !campaignId) return badRequest('Invalid campaign id', 'campaignId')
  try {
    return NextResponse.json({ content: await listContent(prisma, { campaignId }) })
  } catch (error) {
    return errorResponse(error, 'list content')
  }
}

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const content = await createContent(prisma, await readJson(request), auth.session.username, { host: request.headers.get('host') })
    return NextResponse.json({ content }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'create content')
  }
}
