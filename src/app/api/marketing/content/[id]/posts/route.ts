// ZP-1200: add channels (one draft post each) to existing content. OWNER only. Body { channels: string[] }.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { addChannelsToContent } from '@/lib/marketing/content-posts'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid content id')
  try {
    const posts = await addChannelsToContent(prisma, id, await readJson(request), auth.session.username, { host: request.headers.get('host') })
    return NextResponse.json({ posts }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'add channels to content')
  }
}
