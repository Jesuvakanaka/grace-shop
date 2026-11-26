// ZP-1200: move an ad along its status machine. OWNER only. Body { action }.
// create_on_platform, start and pause make real (gated) calls to Meta.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { AD_API_ACTIONS, transitionAdAction, type AdApiAction } from '@/lib/marketing/ads'
import { marketingAuth } from '@/lib/marketing/guard'
import { asObject } from '@/lib/marketing/validate'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid ad id')
  try {
    const body = asObject(await readJson(request))
    if (typeof body.action !== 'string' || !(AD_API_ACTIONS as readonly string[]).includes(body.action)) {
      return badRequest(`action must be one of: ${AD_API_ACTIONS.join(', ')}.`, 'action')
    }
    const actor = { username: auth.session.username, role: auth.session.role }
    const ad = await transitionAdAction(prisma, id, body.action as AdApiAction, actor, { fetch: (u, i) => fetch(u, i) })
    return NextResponse.json({ ad })
  } catch (error) {
    return errorResponse(error, 'change ad status')
  }
}
