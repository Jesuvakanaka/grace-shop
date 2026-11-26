// ZP-1200: apply a proposed plan. OWNER only. Body { items: [{ postId, scheduledFor }] }.
// API channels are scheduled through the normal status machine; manual channels are skipped
// (they only get a suggested day, nothing is stored for them).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { getChannel } from '@/lib/marketing/channels'
import { transitionPost } from '@/lib/marketing/posts'
import { asObject, date, onlyKeys } from '@/lib/marketing/validate'
import { WebsiteError, badRequest, errorResponse, readJson } from '@/lib/website/http'

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const body = asObject(await readJson(request))
    onlyKeys(body, ['items'])
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 200) return badRequest('items must be a list of 1 to 200 posts', 'items')
    const items = body.items.map((raw, i) => {
      const o = asObject(raw)
      const postId = Number(o.postId)
      if (!Number.isInteger(postId) || postId < 1) throw new WebsiteError(400, `Item ${i + 1}: invalid postId`, { field: 'items' })
      const scheduledFor = date(o.scheduledFor, 'scheduledFor')
      if (!scheduledFor) throw new WebsiteError(400, `Item ${i + 1}: choose a time`, { field: 'items' })
      return { postId, scheduledFor }
    })
    const actor = { username: auth.session.username, role: auth.session.role }
    const results: { postId: number; result: 'scheduled' | 'suggested' | 'failed'; scheduledFor?: string; error?: string }[] = []
    for (const it of items) {
      const post = await prisma.marketingPost.findUnique({ where: { id: it.postId }, select: { channelKind: true } })
      if (!post) {
        results.push({ postId: it.postId, result: 'failed', error: 'Post not found.' })
        continue
      }
      const ch = getChannel(post.channelKind)
      if (ch && ch.mode === 'manual') {
        // Manual channels are shared by hand: just hand back the suggested day.
        results.push({ postId: it.postId, result: 'suggested', scheduledFor: it.scheduledFor.toISOString() })
        continue
      }
      try {
        await transitionPost(prisma, it.postId, 'schedule', actor, { scheduledFor: it.scheduledFor })
        results.push({ postId: it.postId, result: 'scheduled', scheduledFor: it.scheduledFor.toISOString() })
      } catch (error) {
        if (!(error instanceof WebsiteError)) throw error
        results.push({ postId: it.postId, result: 'failed', error: error.message })
      }
    }
    return NextResponse.json({ results })
  } catch (error) {
    return errorResponse(error, 'apply the plan')
  }
}
