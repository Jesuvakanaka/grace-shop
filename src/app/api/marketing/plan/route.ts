// ZP-1200: propose a schedule for the week's approved posts. Saves nothing. OWNER only. Body { start }.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { planWeek } from '@/lib/marketing/ai/plan'
import { marketingAuth } from '@/lib/marketing/guard'
import { getSettings } from '@/lib/marketing/settings'
import { asObject, date, onlyKeys } from '@/lib/marketing/validate'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const body = asObject(await readJson(request))
    onlyKeys(body, ['start'])
    const start = date(body.start, 'start')
    if (!start) return badRequest('Choose the first day of the week.', 'start')
    return NextResponse.json({ plan: await planWeek(prisma, { start, settings: await getSettings(prisma) }) })
  } catch (error) {
    return errorResponse(error, 'plan the week')
  }
}
