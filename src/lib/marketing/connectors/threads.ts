// VYRA Marketing hub (ZP-1200): Threads connector (Meta Threads API), two steps: container, then threads_publish.
// Docs checked 2026-11-26:
//   https://developers.facebook.com/docs/threads/posts/            (create container, publish, 30 s wait, 250 posts / 24 h, 500 chars, 5 links)
//   https://developers.facebook.com/documentation/threads/reference/publishing  (container status: GET /{container}?fields=status,error_message)
//   POST https://graph.threads.net/v1.0/{threads-user-id}/threads          media_type=TEXT|IMAGE, text, image_url, link_attachment (TEXT only), access_token
//   POST https://graph.threads.net/v1.0/{threads-user-id}/threads_publish  creation_id, access_token
// The version in the docs' examples is v1.0 (the docs do not name a newer one); override with env THREADS_API_VERSION.
// Permissions: threads_basic, threads_content_publish. The token goes in the request body (POST) as the docs show and in the
// query on GET; it is never put in an error message. The same go-live checks as the Facebook connector run first.
import { assertCanGoLive } from '../flags'
import type { Connector, ConnectorContext, ConnectorPost, FetchLike, PublishResult, VerifyResult } from './types'

export const THREADS_API_VERSION = 'v1.0'
export const THREADS_MAX_TEXT = 500

export function threadsBase(env: Record<string, string | undefined> = process.env): string {
  const v = (env.THREADS_API_VERSION ?? '').trim()
  return `https://graph.threads.net/${/^v\d+\.\d+$/.test(v) ? v : THREADS_API_VERSION}`
}

class ThreadsError extends Error {
  constructor(message: string, public readonly httpStatus: number, public readonly code: number | null, public readonly retryable: boolean) {
    super(message)
  }
}

const token = (c: Record<string, string>) => (c.accessToken ?? '').trim()

function plain(code: number | null, status: number, metaMessage: string): { message: string; retryable: boolean } {
  const meta = metaMessage ? ` (Threads says: ${metaMessage.slice(0, 200)})` : ''
  if (code === 190) return { message: `Threads no longer accepts the saved access token. It has expired or been revoked: connect the channel again with a new token.${meta}`, retryable: false }
  if (code === 10 || code === 200) return { message: `The token is missing a permission (threads_basic, threads_content_publish). Generate a new token with both.${meta}`, retryable: false }
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) return { message: `Threads is limiting how often VYRA can post right now (250 posts in 24 hours). Try later.${meta}`, retryable: true }
  if (status >= 500 || code === 1 || code === 2) return { message: `Threads had a temporary problem. Try again in a few minutes.${meta}`, retryable: true }
  return { message: `Threads did not accept the request.${meta}`, retryable: false }
}

async function call<T>(fetchFn: FetchLike, method: 'GET' | 'POST', path: string, accessToken: string, params: Record<string, string | undefined>): Promise<T> {
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
  pairs.push(['access_token', accessToken])
  let url = `${threadsBase()}/${path.replace(/^\/+/, '')}`
  const init: RequestInit = { method, headers: { Accept: 'application/json' } }
  if (method === 'GET') url += `?${new URLSearchParams(pairs).toString()}`
  else {
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded'
    init.body = new URLSearchParams(pairs).toString()
  }
  let res: Response
  try {
    res = await fetchFn(url, init)
  } catch {
    throw new ThreadsError('Could not reach Threads. Check the server has internet access and try again.', 0, null, true)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const err = (body as { error?: { code?: number; message?: string } } | null)?.error
  if (!res.ok || err) {
    const code = typeof err?.code === 'number' ? err.code : null
    const p = plain(code, res.status, typeof err?.message === 'string' ? err.message : '')
    throw new ThreadsError(p.message, res.status, code, p.retryable)
  }
  return (body ?? {}) as T
}

const failure = (e: unknown) =>
  e instanceof ThreadsError
    ? { ok: false as const, error: e.message, retryable: e.retryable, ...(e.code !== null ? { code: e.code } : {}), ...(e.httpStatus === 0 ? { uncertain: true } : {}) }
    : { ok: false as const, error: e instanceof Error ? e.message : 'Publishing failed.', retryable: false }

export interface ThreadsOptions {
  sleep?: (ms: number) => Promise<void>
  /** Wait before publishing (the docs recommend about 30 seconds). Status is polled instead when possible. */
  pollIntervalMs?: number
  maxChecks?: number
}

/** The container parameters for a post. Pure. A link goes as link_attachment on text posts, and inside the words on photo posts. */
export function buildContainerParams(post: ConnectorPost): Record<string, string> {
  const text = post.text.trim()
  if (post.imageUrls.length > 0) {
    const withLink = post.link && !text.includes(post.link) ? `${text}\n\n${post.link}`.trim() : text
    return { media_type: 'IMAGE', image_url: post.imageUrls[0], ...(withLink ? { text: withLink } : {}) }
  }
  return { media_type: 'TEXT', text, ...(post.link ? { link_attachment: post.link } : {}) }
}

export function createThreadsConnector(opts: ThreadsOptions = {}): Connector {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const interval = opts.pollIntervalMs ?? 5000
  const maxChecks = opts.maxChecks ?? 12

  return {
    kind: 'THREADS',

    async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
      try {
        const me = await call<{ id?: string; username?: string }>(fetchFn, 'GET', 'me', token(credentials), { fields: 'id,username' })
        if (!me.id) return { ok: false, error: 'Threads did not say which profile this token belongs to.' }
        return { ok: true, externalId: me.id, name: me.username ? `@${me.username}` : null }
      } catch (e) {
        return { ok: false, error: failure(e).error }
      }
    },

    async publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
      assertCanGoLive(ctx.gate ?? { settings: null, channel: null, post: null }) // fail closed, same as Facebook
      const accessToken = token(ctx.credentials)
      const userId = ctx.externalId
      if (!accessToken || !userId) return { ok: false, error: 'This channel has no access token or Threads profile saved.', retryable: false }
      if (post.format !== 'POST') return { ok: false, error: `Threads ${post.format.toLowerCase()} posts cannot be published automatically. Use a normal post.`, retryable: false }
      if (post.imageUrls.length > 1) return { ok: false, error: 'A Threads post takes one photo here (carousels are not supported yet).', retryable: false }
      const params = buildContainerParams(post)
      if (!params.text && !params.image_url) return { ok: false, error: 'A Threads post needs some words or a photo.', retryable: false }
      if ((params.text ?? '').length > THREADS_MAX_TEXT) return { ok: false, error: `Threads posts are at most ${THREADS_MAX_TEXT} characters (the tracked link counts on photo posts). Shorten the words.`, retryable: false }
      try {
        const container = await call<{ id?: string }>(ctx.fetch, 'POST', `${userId}/threads`, accessToken, params)
        if (!container.id) return { ok: false, error: 'Threads did not accept the post.', retryable: false }
        // Wait for processing: poll the container status (docs: about 30 seconds on average).
        let ready = false
        for (let i = 0; i < maxChecks && !ready; i++) {
          const s = await call<{ status?: string; error_message?: string }>(ctx.fetch, 'GET', container.id, accessToken, { fields: 'status,error_message' })
          if (s.status === 'FINISHED' || s.status === 'PUBLISHED') ready = true
          else if (s.status === 'ERROR' || s.status === 'EXPIRED') {
            return { ok: false, error: `Threads could not process the post${s.error_message ? ` (${s.error_message.slice(0, 150)})` : ''}.`, retryable: false }
          } else await sleep(interval)
        }
        if (!ready) return { ok: false, error: 'Threads is still processing the post after a minute. Try again later.', retryable: true }
        const pub = await call<{ id?: string }>(ctx.fetch, 'POST', `${userId}/threads_publish`, accessToken, { creation_id: container.id })
        if (!pub.id) return { ok: false, error: 'Threads did not say whether the post went out. Check the profile before trying again.', retryable: false }
        let url: string | null = null
        try {
          const m = await call<{ permalink?: string }>(ctx.fetch, 'GET', pub.id, accessToken, { fields: 'permalink' })
          url = m.permalink ?? null
        } catch {
          url = null // the post is out; the link is a convenience
        }
        return { ok: true, externalId: pub.id, externalUrl: url }
      } catch (e) {
        return failure(e)
      }
    },
  }
}

export const threadsConnector: Connector = createThreadsConnector()
