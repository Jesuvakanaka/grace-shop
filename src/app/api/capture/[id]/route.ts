// ZP-1100: one capture draft. OWNER only. DELETE rejects the draft.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { getDraft, rejectDraft, updateDraft } from '@/lib/capture/drafts'
import { badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid draft id')
  try {
    const draft = await getDraft(prisma, id)
    return draft ? NextResponse.json({ draft }) : notFound('Draft')
  } catch (error) {
    return errorResponse(error, 'get capture draft')
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid draft id')
  try {
    return NextResponse.json({ draft: await updateDraft(prisma, id, await readJson(request)) })
  } catch (error) {
    return errorResponse(error, 'update capture draft')
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid draft id')
  try {
    return NextResponse.json({ draft: await rejectDraft(prisma, id) })
  } catch (error) {
    return errorResponse(error, 'reject capture draft')
  }
}
