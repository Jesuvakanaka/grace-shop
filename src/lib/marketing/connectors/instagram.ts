// VYRA Marketing hub (ZP-1200): Instagram connector (professional account linked to a Page).
// Flow: check the 24-hour publishing quota, create container(s), wait until FINISHED, media_publish.
//   photo     POST /{ig}/media image_url, caption
//   carousel  children: POST /{ig}/media image_url, is_carousel_item=true; then media_type=CAROUSEL, children, caption
//   story     POST /{ig}/media media_type=STORIES, image_url (no caption is shown)
// JPEG only; no shopping tags or filters. 50 API posts per 24 hours.
import { assertCanGoLive } from '../flags'
import type { Connector, ConnectorContext, ConnectorPost, InsightsResult, PublishResult, VerifyResult, FetchLike } from './types'
import { failureOf, graphClient, MetaGraphError, type GraphClient } from './meta-graph'

const token = (c: Record<string, string>) => (c.accessToken ?? '').trim()

/** Waiting for Instagram to process a container never goes beyond 5 minutes. */
export const MAX_WAIT_MS = 5 * 60 * 1000

export interface InstagramOptions {
  /** Pause between status checks (injectable so tests do not wait). */
  sleep?: (ms: number) => Promise<void>
  pollIntervalMs?: number
  maxWaitMs?: number
}

async function waitUntilFinished(g: GraphClient, accessToken: string, containerId: string, o: Required<InstagramOptions>): Promise<void> {
  const maxWait = Math.min(o.maxWaitMs, MAX_WAIT_MS)
  const polls = Math.max(1, Math.ceil(maxWait / Math.max(o.pollIntervalMs, 1)))
  for (let i = 0; i < polls; i++) {
    const r = await g.get<{ status_code?: string }>(containerId, accessToken, { fields: 'status_code' })
    const s = r.status_code
    if (s === 'FINISHED' || s === 'PUBLISHED') return
    if (s === 'ERROR' || s === 'EXPIRED') {
      throw new MetaGraphError(
        s === 'EXPIRED' ? 'Instagram dropped the photo before it was published (it waited too long). Try again.' : 'Instagram could not process the photo. Check it is a JPEG that can be downloaded from the public link.',
        null, null, null, 200, null,
      )
    }
    await o.sleep(o.pollIntervalMs)
  }
  const e = new MetaGraphError('Instagram is still processing the photo after a few minutes. Try again later.', 1, null, null, 200, null)
  throw e
}

export function createInstagramConnector(opts: InstagramOptions = {}): Connector {
  const o: Required<InstagramOptions> = {
    sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    pollIntervalMs: opts.pollIntervalMs ?? 3000,
    maxWaitMs: opts.maxWaitMs ?? 2 * 60 * 1000,
  }
  return {
    kind: 'INSTAGRAM',

    async verify(credentials, fetchFn: FetchLike, igUserId?: string): Promise<VerifyResult> {
      try {
        const g = graphClient(fetchFn)
        const id = igUserId ?? credentials.igUserId
        if (id) {
          const r = await g.get<{ id?: string; username?: string }>(id, token(credentials), { fields: 'id,username' })
          return { ok: true, externalId: r.id ?? id, name: r.username ?? null }
        }
        const me = await g.get<{ id?: string; name?: string }>('me', token(credentials), { fields: 'id,name' })
        return { ok: true, externalId: me.id ?? null, name: me.name ?? null }
      } catch (e) {
        return { ok: false, error: failureOf(e).error }
      }
    },

    async publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
      assertCanGoLive(ctx.gate ?? { settings: null, channel: null, post: null })
      const accessToken = token(ctx.credentials)
      const ig = ctx.externalId
      if (!accessToken || !ig) return { ok: false, error: 'This channel has no access token or Instagram account ID saved.', retryable: false }
      if (post.format === 'REEL') return { ok: false, error: 'Instagram Reels need a video and cannot be published from photos.', retryable: false }
      if (post.imageUrls.length === 0) return { ok: false, error: 'Instagram posts need at least one photo.', retryable: false }
      if (post.format === 'CAROUSEL' && post.imageUrls.length < 2) return { ok: false, error: 'An Instagram carousel needs at least two photos.', retryable: false }
      if (post.imageUrls.length > 10) return { ok: false, error: 'Instagram allows at most 10 photos in one post.', retryable: false }
      const g = graphClient(ctx.fetch)
      try {
        // The 24-hour quota first: nothing is created when it is used up.
        const lim = await g.get<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(`${ig}/content_publishing_limit`, accessToken, { fields: 'quota_usage,config' })
        const row = lim.data?.[0]
        const total = row?.config?.quota_total ?? 50
        if ((row?.quota_usage ?? 0) >= total) {
          return { ok: false, error: `Instagram allows ${total} posts in 24 hours through the API and that limit is used up. Try again tomorrow.`, retryable: false }
        }

        let creationId: string | undefined
        if (post.format === 'STORY') {
          const c = await g.post<{ id?: string }>(`${ig}/media`, accessToken, { media_type: 'STORIES', image_url: post.imageUrls[0] })
          creationId = c.id
        } else if (post.imageUrls.length === 1) {
          const c = await g.post<{ id?: string }>(`${ig}/media`, accessToken, { image_url: post.imageUrls[0], caption: post.text })
          creationId = c.id
        } else {
          const children: string[] = []
          for (const url of post.imageUrls) {
            const c = await g.post<{ id?: string }>(`${ig}/media`, accessToken, { image_url: url, is_carousel_item: true })
            if (!c.id) throw new Error('Instagram did not return a photo ID.')
            children.push(c.id)
          }
          for (const id of children) await waitUntilFinished(g, accessToken, id, o)
          const c = await g.post<{ id?: string }>(`${ig}/media`, accessToken, { media_type: 'CAROUSEL', children: children.join(','), caption: post.text })
          creationId = c.id
        }
        if (!creationId) return { ok: false, error: 'Instagram did not accept the photo.', retryable: false }
        await waitUntilFinished(g, accessToken, creationId, o)
        const pub = await g.post<{ id?: string }>(`${ig}/media_publish`, accessToken, { creation_id: creationId })
        if (!pub.id) return { ok: false, error: 'Instagram did not say whether the post went out. Check the account before trying again.', retryable: false }
        let externalUrl: string | null = null
        try {
          const m = await g.get<{ permalink?: string }>(pub.id, accessToken, { fields: 'permalink' })
          externalUrl = m.permalink ?? null
        } catch {
          externalUrl = null // the post is out; the link is only a convenience
        }
        return { ok: true, externalId: pub.id, externalUrl }
      } catch (e) {
        return failureOf(e)
      }
    },

    async fetchInsights(externalId, ctx): Promise<InsightsResult> {
      try {
        const r = await graphClient(ctx.fetch).get<{ data?: { name: string; values?: { value?: unknown }[] }[] }>(
          `${externalId}/insights`, token(ctx.credentials), { metric: 'reach,likes,comments,shares,saved' },
        )
        const val = (name: string) => {
          const v = r.data?.find((d) => d.name === name)?.values?.[0]?.value
          return typeof v === 'number' ? v : undefined
        }
        return { ok: true, metrics: { reach: val('reach'), likes: val('likes'), comments: val('comments'), shares: val('shares') } }
      } catch (e) {
        return { ok: false, error: failureOf(e).error, metrics: {} }
      }
    },
  }
}

export const instagramConnector: Connector = createInstagramConnector()
