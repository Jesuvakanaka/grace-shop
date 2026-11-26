// ZP-1200: marketing posts. OWNER only. GET ?status=&channel=&from=&to= (from/to match the scheduled or published time).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { listPosts } from '@/lib/marketing/posts'
import { errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const q = new URL(request.url).searchParams
  try {
    return NextResponse.json({
      posts: await listPosts(prisma, { status: q.get('status'), channel: q.get('channel'), from: q.get('from'), to: q.get('to') }),
    })
  } catch (error) {
    return errorResponse(error, 'list posts')
  }
}
