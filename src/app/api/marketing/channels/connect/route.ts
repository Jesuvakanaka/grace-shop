// ZP-1200: connect Facebook Page / Instagram. OWNER only. Body { kind, pageId, accessToken }.
// The token is verified with Meta, saved encrypted and never returned.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { connectMeta } from '@/lib/marketing/connect'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const body = await readJson(request)
  if (body === undefined) return badRequest('Send a JSON body with kind, pageId and accessToken.')
  try {
    return NextResponse.json(await connectMeta(prisma, body, auth.session.username, { fetch: (u, i) => fetch(u, i) }))
  } catch (error) {
    return errorResponse(error, 'connect marketing channel')
  }
}
