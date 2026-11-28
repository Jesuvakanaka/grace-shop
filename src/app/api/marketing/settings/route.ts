// ZP-1200: marketing settings. OWNER only.
// ZP-1106: also the shop's truth (setup): what is confirmed, by whom and when, and what is still to ask.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { getSettings, getSetupState, updateSettings } from '@/lib/marketing/settings'
import { liveAllowedByEnv } from '@/lib/marketing/flags'
import { errorResponse, readJson } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ settings: await getSettings(prisma), setup: await getSetupState(prisma), liveAllowedByEnv: liveAllowedByEnv() })
  } catch (error) {
    return errorResponse(error, 'get marketing settings')
  }
}

export async function PUT(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const settings = await updateSettings(prisma, await readJson(request), auth.session.username)
    return NextResponse.json({ settings, setup: await getSetupState(prisma), liveAllowedByEnv: liveAllowedByEnv() })
  } catch (error) {
    return errorResponse(error, 'update marketing settings')
  }
}
