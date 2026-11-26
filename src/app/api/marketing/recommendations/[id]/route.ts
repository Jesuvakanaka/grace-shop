// ZP-1200: mark advice Done or Dismissed. OWNER only. PATCH { status: 'NEW' | 'DONE' | 'DISMISSED' }
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { setRecommendationStatus } from '@/lib/marketing/ai/recommend'
import { marketingAuth } from '@/lib/marketing/guard'
import { asObject, onlyKeys } from '@/lib/marketing/validate'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid advice id')
  try {
    const o = asObject(await readJson(request))
    onlyKeys(o, ['status'])
    const actor = { username: auth.session.username, role: auth.session.role }
    return NextResponse.json({ recommendation: await setRecommendationStatus(prisma, id, o.status, actor) })
  } catch (error) {
    return errorResponse(error, 'update recommendation')
  }
}
