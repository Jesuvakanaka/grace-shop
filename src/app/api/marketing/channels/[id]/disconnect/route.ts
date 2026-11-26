// ZP-1200: wipe a channel's saved credentials. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { disconnectChannel } from '@/lib/marketing/connect'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid channel id')
  try {
    return NextResponse.json({ channel: await disconnectChannel(prisma, id, auth.session.username) })
  } catch (error) {
    return errorResponse(error, 'disconnect marketing channel')
  }
}
