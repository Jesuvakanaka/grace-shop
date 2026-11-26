// ZP-1100: do the NEXT step of a capture draft (listing, or one AI photo). OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { runNextStep } from '@/lib/capture/run'
import { badRequest, errorResponse } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid draft id')
  try {
    return NextResponse.json({ draft: await runNextStep(prisma, id) })
  } catch (error) {
    return errorResponse(error, 'run capture step')
  }
}
