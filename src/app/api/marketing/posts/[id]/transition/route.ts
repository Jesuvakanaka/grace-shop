// ZP-1200: move a post along the status machine. OWNER only. Body { action, scheduledFor? }.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { isOwnerAction, transitionPost } from '@/lib/marketing/posts'
import { OWNER_ACTIONS } from '@/lib/marketing/state'
import { asObject, date } from '@/lib/marketing/validate'
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
    const post = await transitionPost(prisma, id, body.action, { username: auth.session.username, role: auth.session.role }, { scheduledFor })
    return NextResponse.json({ post })
  } catch (error) {
    return errorResponse(error, 'change post status')
  }
}
