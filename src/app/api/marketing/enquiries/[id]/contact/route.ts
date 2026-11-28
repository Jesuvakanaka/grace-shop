// ZP-1116 (MM-11): settle who the enquiry is from. Body { contactId | null }. OWNER only (hub guard).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { setEnquiryContact } from '@/lib/marketing/enquiries'
import { marketingAuth } from '@/lib/marketing/guard'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid enquiry id')
  try {
    const body = await readJson(request)
    return NextResponse.json({ enquiry: await prisma.$transaction((tx) => setEnquiryContact(tx, id, body, auth.session.username)) })
  } catch (error) {
    return errorResponse(error, 'contact enquiry')
  }
}
