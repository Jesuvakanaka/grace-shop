// ZP-1200: marketing settings. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { getSettings, updateSettings } from '@/lib/marketing/settings'
import { liveAllowedByEnv } from '@/lib/marketing/flags'
import { errorResponse, readJson } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ settings: await getSettings(prisma), liveAllowedByEnv: liveAllowedByEnv() })
  } catch (error) {
    return errorResponse(error, 'get marketing settings')
  }
}

export async function PUT(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const settings = await updateSettings(prisma, await readJson(request), auth.session.username)
    return NextResponse.json({ settings, liveAllowedByEnv: liveAllowedByEnv() })
  } catch (error) {
    return errorResponse(error, 'update marketing settings')
  }
}
