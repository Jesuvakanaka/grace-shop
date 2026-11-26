// ZP-1200: one post. OWNER only. PATCH edits text, photos or format (editing sends an approved post back to draft).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { getPost, updatePost } from '@/lib/marketing/posts'
import { badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid post id')
  try {
    const post = await getPost(prisma, id)
    return post ? NextResponse.json({ post }) : notFound('Post')
  } catch (error) {
    return errorResponse(error, 'get post')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid post id')
  try {
    return NextResponse.json({ post: await updatePost(prisma, id, await readJson(request), { username: auth.session.username, role: auth.session.role }) })
  } catch (error) {
    return errorResponse(error, 'update post')
  }
}
