// ZP-1200: work out this week's advice (facts from code, wording from the AI when a key exists, rule text otherwise).
// OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { generateRecommendations } from '@/lib/marketing/ai/recommend'
import { marketingAuth } from '@/lib/marketing/guard'
import { errorResponse } from '@/lib/website/http'

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const actor = { username: auth.session.username, role: auth.session.role }
    return NextResponse.json({ result: await generateRecommendations(prisma, actor) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'generate recommendations')
  }
}
