// ZP-1100: clear one AI photo so the next run makes it again. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { regenerateSlot } from '@/lib/capture/run'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid draft id')
  const body = (await readJson(request)) as { slot?: unknown } | undefined
  try {
    return NextResponse.json({ draft: await regenerateSlot(prisma, id, body?.slot) })
  } catch (error) {
    return errorResponse(error, 'regenerate capture photo')
  }
}
