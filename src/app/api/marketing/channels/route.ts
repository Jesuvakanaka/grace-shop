// ZP-1200: the channel registry merged with saved channel rows. OWNER only. Never returns credentials.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { listChannels } from '@/lib/marketing/channel-rows'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ channels: await listChannels(prisma) })
  } catch (error) {
    return errorResponse(error, 'list marketing channels')
  }
}
