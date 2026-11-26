// ZP-1200: hub status for the screens: is the hub on, and why live posting is off. OWNER only; 404 when the hub is off.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { getHubStatus } from '@/lib/marketing/status'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json(await getHubStatus(prisma))
  } catch (error) {
    return errorResponse(error, 'get marketing status')
  }
}
