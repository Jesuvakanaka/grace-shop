// ZP-1200: one content idea. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { deleteContent, getContent, updateContent } from '@/lib/marketing/content'
import { badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid content id')
  try {
    const content = await getContent(prisma, id)
    return content ? NextResponse.json({ content }) : notFound('Content')
  } catch (error) {
    return errorResponse(error, 'get content')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid content id')
  try {
    return NextResponse.json({ content: await updateContent(prisma, id, await readJson(request), auth.session.username) })
  } catch (error) {
    return errorResponse(error, 'update content')
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid content id')
  try {
    await deleteContent(prisma, id, auth.session.username)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'delete content')
  }
}
