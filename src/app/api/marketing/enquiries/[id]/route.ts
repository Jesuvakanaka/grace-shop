// ZP-1116 (MM-11): one enquiry with its full history and reply suggestions; PATCH assigns, sets a follow-up or adds a note.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getEnquiry, replySuggestions, updateEnquiry } from '@/lib/marketing/enquiries'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid enquiry id')
  try {
    return NextResponse.json({ ...(await getEnquiry(prisma, id)), suggestions: await replySuggestions(prisma, id) })
  } catch (error) {
    return errorResponse(error, 'get enquiry')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid enquiry id')
  try {
    const body = await readJson(request)
    return NextResponse.json({ enquiry: await prisma.$transaction((tx) => updateEnquiry(tx, id, body, auth.session.username)) })
  } catch (error) {
    return errorResponse(error, 'update enquiry')
  }
}
