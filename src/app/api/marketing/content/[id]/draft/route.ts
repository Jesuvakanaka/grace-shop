// ZP-1200: AI writes the words for a content idea's draft posts. OWNER only. Body { channels?: string[] }.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { draftContentPosts } from '@/lib/marketing/ai/draft'
import { marketingAuth } from '@/lib/marketing/guard'
import { asObject, onlyKeys } from '@/lib/marketing/validate'
import { WebsiteError, badRequest, errorResponse } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid content id')
  try {
    const text = await request.text()
    const body = text.trim() ? asObject(JSON.parse(text)) : {}
    onlyKeys(body, ['channels'])
    let channels: string[] | undefined
    if ('channels' in body && body.channels !== undefined) {
      if (!Array.isArray(body.channels) || body.channels.some((c) => typeof c !== 'string')) return badRequest('channels must be a list of channel names', 'channels')
      channels = body.channels as string[]
    }
    return NextResponse.json(await draftContentPosts(prisma, id, { channels, actor: auth.session.username }))
  } catch (error) {
    if (error instanceof SyntaxError) return badRequest('The request was not valid JSON')
    if (error instanceof WebsiteError) return errorResponse(error, 'write posts')
    console.error('[marketing] AI draft failed:', error)
    return NextResponse.json({ error: 'The AI could not write these posts. Try again in a moment.' }, { status: 502 })
  }
}
