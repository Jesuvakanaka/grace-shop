// ZP-1200: move a post along the status machine. OWNER only. Body { action, scheduledFor?, externalUrl? }.
// externalUrl is the link the owner pastes for confirm_published (ZP-1124).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { isOwnerAction, transitionPost } from '@/lib/marketing/posts'
import { publishPost } from '@/lib/marketing/publish'
import { OWNER_ACTIONS } from '@/lib/marketing/state'
import { asObject, date, text } from '@/lib/marketing/validate'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid post id')
  try {
    const body = asObject(await readJson(request))
    if (!isOwnerAction(body.action)) return badRequest(`action must be one of: ${OWNER_ACTIONS.join(', ')}.`, 'action')
    const scheduledFor = 'scheduledFor' in body ? date(body.scheduledFor, 'scheduledFor') : undefined
    const externalUrl = 'externalUrl' in body ? text(body.externalUrl, 'externalUrl', 1000) : undefined
    const actor = { username: auth.session.username, role: auth.session.role }
    // Publish and retry now really send the post through its connector (the gate is checked inside).
    if (body.action === 'publish' || body.action === 'retry') {
      const post = await publishPost(prisma, id, actor, { fetch: (u, i) => fetch(u, i) })
      return NextResponse.json({ post })
    }
    const post = await transitionPost(prisma, id, body.action, actor, { scheduledFor, externalUrl })
    return NextResponse.json({ post })
  } catch (error) {
    return errorResponse(error, 'change post status')
  }
}
