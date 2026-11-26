// ZP-1200: record a consent change (opt in or opt out) for one contact. OWNER only. Body { channel, status, method, evidence? }.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { recordConsent } from '@/lib/marketing/contacts'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid contact id')
  try {
    return NextResponse.json({ contact: await recordConsent(prisma, id, await readJson(request), auth.session.username) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'record consent')
  }
}
