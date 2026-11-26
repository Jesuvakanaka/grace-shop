// ZP-1200: move a broadcast along (submit, approve, reject, cancel) or send it (send, retry, continue). OWNER only.
// Sending goes through assertCanGoLive and handles a small batch per call (the runner or "Send the next batch" carries on).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { broadcastAction, continueSending } from '@/lib/marketing/broadcasts'
import { BROADCAST_OWNER_ACTIONS } from '@/lib/marketing/broadcast-state'
import { marketingAuth } from '@/lib/marketing/guard'
import { asObject } from '@/lib/marketing/validate'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }
const BATCH = 25

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid message id')
  try {
    const body = asObject(await readJson(request))
    const actor = { username: auth.session.username, role: auth.session.role }
    const deps = { fetch: (u: string, i?: RequestInit) => fetch(u, i) }
    if (body.action === 'continue') return NextResponse.json(await continueSending(prisma, id, actor, deps, { max: BATCH }))
    if (typeof body.action !== 'string' || !(BROADCAST_OWNER_ACTIONS as readonly string[]).includes(body.action)) {
      return badRequest(`action must be one of: ${[...BROADCAST_OWNER_ACTIONS, 'continue'].join(', ')}.`, 'action')
    }
    return NextResponse.json(await broadcastAction(prisma, id, body.action, actor, deps, { max: BATCH }))
  } catch (error) {
    return errorResponse(error, 'change broadcast status')
  }
}
