// ZP-1200: broadcasts (email, SMS, WhatsApp templates to opted-in contacts). OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createBroadcast, listBroadcasts } from '@/lib/marketing/broadcasts'
import { marketingAuth } from '@/lib/marketing/guard'
import { errorResponse, readJson } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ broadcasts: await listBroadcasts(prisma) })
  } catch (error) {
    return errorResponse(error, 'list broadcasts')
  }
}

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ broadcast: await createBroadcast(prisma, await readJson(request), auth.session.username) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'create broadcast')
  }
}
