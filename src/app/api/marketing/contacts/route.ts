// ZP-1200: contacts (people who may be messaged, with consent). OWNER only. New contacts have NO consent.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createContact, listContacts } from '@/lib/marketing/contacts'
import { marketingAuth } from '@/lib/marketing/guard'
import { errorResponse, readJson } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const p = new URL(request.url).searchParams
    return NextResponse.json(await listContacts(prisma, { q: p.get('q'), source: p.get('source'), channel: p.get('channel'), status: p.get('status'), limit: Number(p.get('limit')) || undefined, offset: Number(p.get('offset')) || undefined }))
  } catch (error) {
    return errorResponse(error, 'list contacts')
  }
}

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ contact: await createContact(prisma, await readJson(request), auth.session.username) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'create contact')
  }
}
