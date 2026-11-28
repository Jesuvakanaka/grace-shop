// VYRA Marketing hub (ZP-1200): Facebook Page connector (Graph API, Facebook Login path).
// Posts now (Meta-side scheduling is not used; the hub schedules itself).
//   1 photo      POST /{page}/photos  url, caption, published=true
//   2+ photos    each POST /{page}/photos published=false, then POST /{page}/feed message + attached_media[i]
//   no photo     POST /{page}/feed    message (+ link)
import { assertCanGoLive } from '../flags'
import type { Connector, ConnectorContext, ConnectorPost, InsightsResult, PublishResult, VerifyResult, FetchLike } from './types'
import { failureOf, graphClient } from './meta-graph'

const token = (c: Record<string, string>) => (c.accessToken ?? '').trim()

/** The words with the tracked link on the end when it is not already there. */
function withLink(post: ConnectorPost): string {
  const text = post.text.trim()
  if (!post.link || text.includes(post.link)) return text
  return text ? `${text}\n\n${post.link}` : post.link
}

export const facebookPageConnector: Connector = {
  kind: 'FACEBOOK_PAGE',

  async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
    try {
      const me = await graphClient(fetchFn).get<{ id?: string; name?: string }>('me', token(credentials), { fields: 'id,name' })
      return { ok: true, externalId: me.id ?? null, name: me.name ?? null }
    } catch (e) {
      return { ok: false, error: failureOf(e).error }
    }
  },

  async publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
    // Belt and braces: the caller has checked too. Fails closed when the gate input is missing.
    assertCanGoLive(ctx.gate ?? { settings: null, channel: null, post: null })
    const accessToken = token(ctx.credentials)
    const pageId = ctx.externalId
    if (!accessToken || !pageId) return { ok: false, error: 'This channel has no access token or Page ID saved.', retryable: false }
    if (post.format !== 'POST') return { ok: false, error: `Facebook ${post.format.toLowerCase()} posts cannot be published automatically yet. Use a normal post.`, retryable: false }
    const g = graphClient(ctx.fetch)
    try {
      const message = withLink(post)
      let id: string | undefined
      let postId: string | undefined
      if (post.imageUrls.length === 1) {
        const r = await g.post<{ id?: string; post_id?: string }>(`${pageId}/photos`, accessToken, {
          url: post.imageUrls[0], caption: message, published: true,
        })
        id = r.id
        postId = r.post_id ?? r.id
      } else if (post.imageUrls.length > 1) {
        const params: Record<string, string | boolean> = { message }
        let i = 0
        for (const url of post.imageUrls) {
          const photo = await g.post<{ id?: string }>(`${pageId}/photos`, accessToken, { url, published: false })
          if (!photo.id) throw new Error('Facebook did not return a photo ID.')
          params[`attached_media[${i++}]`] = JSON.stringify({ media_fbid: photo.id })
        }
        const r = await g.post<{ id?: string }>(`${pageId}/feed`, accessToken, params)
        id = r.id
        postId = r.id
      } else {
        const r = await g.post<{ id?: string }>(`${pageId}/feed`, accessToken, {
          message: post.text.trim(), link: post.link ?? undefined,
        })
        id = r.id
        postId = r.id
      }
      if (!id || !postId) return { ok: false, error: 'Facebook did not say whether the post went out. Check the Page before trying again.', retryable: false, uncertain: true }
      return { ok: true, externalId: postId, externalUrl: `https://www.facebook.com/${postId}` }
    } catch (e) {
      return failureOf(e)
    }
  },

  async fetchInsights(externalId, ctx): Promise<InsightsResult> {
    const accessToken = token(ctx.credentials)
    try {
      const r = await graphClient(ctx.fetch).get<{ data?: { name: string; values?: { value?: unknown }[] }[] }>(
        `${externalId}/insights`, accessToken, { metric: 'post_impressions,post_impressions_unique,post_clicks' },
      )
      const val = (name: string) => {
        const v = r.data?.find((d) => d.name === name)?.values?.[0]?.value
        return typeof v === 'number' ? v : undefined
      }
      return { ok: true, metrics: { impressions: val('post_impressions'), reach: val('post_impressions_unique'), clicks: val('post_clicks') } }
    } catch (e) {
      return { ok: false, error: failureOf(e).error, metrics: {} }
    }
  },
}
