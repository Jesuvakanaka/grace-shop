// ZP-1200: ad audiences. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createAudience, listAudiences } from '@/lib/marketing/audiences'
import { marketingAuth } from '@/lib/marketing/guard'
import { errorResponse, readJson } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ audiences: await listAudiences(prisma) })
  } catch (error) {
    return errorResponse(error, 'list audiences')
  }
}

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ audience: await createAudience(prisma, await readJson(request), auth.session.username) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'create audience')
  }
}
