// ZP-1200: one contact with its consent history. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getContact, updateContact } from '@/lib/marketing/contacts'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid contact id')
  try {
    return NextResponse.json(await getContact(prisma, id))
  } catch (error) {
    return errorResponse(error, 'get contact')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid contact id')
  try {
    return NextResponse.json({ contact: await updateContact(prisma, id, await readJson(request), auth.session.username) })
  } catch (error) {
    return errorResponse(error, 'update contact')
  }
}
