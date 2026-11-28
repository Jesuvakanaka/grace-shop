// VYRA Marketing hub (ZP-1200): YouTube connector, Data API v3 videos.insert (resumable upload).
// Docs: https://developers.google.com/youtube/v3/docs/videos/insert, https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
// and https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits. Checked 2026-11-26.
//   1. POST https://oauth2.googleapis.com/token  grant_type=refresh_token -> access_token
//   2. POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
//      headers X-Upload-Content-Length / X-Upload-Content-Type, JSON metadata -> 200 with a Location header (session URL)
//   3. PUT <Location> with the whole file -> 200 { id }
// Quota: default 100 videos.insert calls per day per project. Scope youtube.upload (verify also needs youtube.readonly).
// Credentials: clientId, clientSecret, refreshToken. Privacy comes from config.privacy: private | unlisted (default) | public.
// A video file is required: config.videoUrl or a video among the post's files.
import type { Connector, ConnectorContext, ConnectorPost, PublishResult, VerifyResult, FetchLike } from './types'
import { type Obj, download, failure, gateOrThrow, jsonOf, networkFailure, splitTitle, videoUrlOf, withLink } from './common'

export const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'
const PRIVACY = ['private', 'unlisted', 'public'] as const
export type YouTubePrivacy = (typeof PRIVACY)[number]

export function privacyOf(config: Record<string, unknown> | null): YouTubePrivacy {
  const p = config?.privacy
  return typeof p === 'string' && (PRIVACY as readonly string[]).includes(p) ? (p as YouTubePrivacy) : 'unlisted'
}

class AuthError extends Error {
  constructor(public readonly expired: boolean, message: string) { super(message) }
}

async function accessTokenFor(fetchFn: FetchLike, c: Record<string, string>): Promise<string> {
  const clientId = (c.clientId ?? '').trim()
  const clientSecret = (c.clientSecret ?? '').trim()
  const refreshToken = (c.refreshToken ?? '').trim()
  if (!clientId || !clientSecret || !refreshToken) throw new AuthError(false, 'The YouTube client ID, client secret and refresh token must all be saved.')
  const res = await fetchFn(YOUTUBE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
  })
  const b = await jsonOf(res)
  if (!res.ok || typeof b?.access_token !== 'string') {
    const expired = b?.error === 'invalid_grant' || b?.error === 'invalid_client' || res.status === 400 || res.status === 401
    throw new AuthError(expired, String(b?.error_description ?? b?.error ?? `HTTP ${res.status}`))
  }
  return b.access_token
}

const reasonOf = (b: Obj | null): string => String(b?.error?.errors?.[0]?.reason ?? b?.error?.status ?? '')

/** Error mapping for the upload calls. */
function mapError(status: number, reason: string, detail: string): PublishResult {
  if (status === 403 && (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'uploadLimitExceeded')) {
    return { ok: false, retryable: false, code: 403, error: 'YouTube allows about 100 uploads a day for this project and the limit is used up. Try again tomorrow.' }
  }
  if (status === 403 && reason === 'rateLimitExceeded') return failure(429, 'YouTube', detail)
  return failure(status, 'YouTube', detail)
}

export const youtubeConnector: Connector = {
  kind: 'YOUTUBE',

  async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
    try {
      const at = await accessTokenFor(fetchFn, credentials)
      const res = await fetchFn('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { method: 'GET', headers: { Authorization: `Bearer ${at}` } })
      const b = await jsonOf(res)
      if (!res.ok) return { ok: false, error: failure(res.status, 'YouTube', String(b?.error?.message ?? '')).error }
      const ch = b?.items?.[0]
      if (!ch) return { ok: false, error: 'The Google login works but it has no YouTube channel. Create a channel for VYRA first.' }
      return { ok: true, externalId: ch.id ?? null, name: ch.snippet?.title ?? null }
    } catch (e) {
      if (e instanceof AuthError) return { ok: false, error: failure(401, 'Google', e.message, { tokenExpired: e.expired }).error }
      return { ok: false, error: networkFailure('YouTube', e).error }
    }
  },

  async publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
    gateOrThrow(ctx)
    const videoUrl = videoUrlOf(ctx, post.imageUrls)
    if (!videoUrl) return { ok: false, error: 'YouTube needs a video file. Add a video link (config.videoUrl) or attach a video to the post.', retryable: false }
    const { title, rest } = splitTitle(post.text.replace(/[<>]/g, ''), 100)
    if (!title) return { ok: false, error: 'The video needs a title: put it on the first line of the post.', retryable: false }
    const description = withLink(rest, post.link).slice(0, 5000)
    const privacy = privacyOf(ctx.config)
    try {
      const at = await accessTokenFor(ctx.fetch, ctx.credentials)
      const file = await download(ctx.fetch, videoUrl)
      const init = await ctx.fetch(YOUTUBE_UPLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${at}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(file.bytes.byteLength),
          'X-Upload-Content-Type': file.type.startsWith('video/') ? file.type : 'video/*',
        },
        body: JSON.stringify({ snippet: { title, description, categoryId: '22' }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } }),
      })
      if (!init.ok) {
        const b = await jsonOf(init)
        return mapError(init.status, reasonOf(b), String(b?.error?.message ?? ''))
      }
      const session = init.headers.get('location')
      if (!session) return { ok: false, error: 'YouTube did not give an upload address. Try again.', retryable: true }
      const put = await ctx.fetch(session, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': file.type.startsWith('video/') ? file.type : 'video/*', 'Content-Length': String(file.bytes.byteLength) },
        body: file.bytes,
      })
      const out = await jsonOf(put)
      if (!put.ok) return mapError(put.status, reasonOf(out), String(out?.error?.message ?? ''))
      const id = typeof out?.id === 'string' ? out.id : null
      if (!id) return { ok: false, error: 'YouTube did not say whether the video was uploaded. Check YouTube Studio before trying again.', retryable: false, uncertain: true }
      return { ok: true, externalId: id, externalUrl: `https://www.youtube.com/watch?v=${id}`, message: `Uploaded to YouTube as ${privacy}.${privacy === 'public' ? '' : ' Open YouTube Studio to make it public when you are ready.'}` }
    } catch (e) {
      if (e instanceof AuthError) return failure(401, 'Google', e.message, { tokenExpired: e.expired })
      return networkFailure('YouTube', e)
    }
  },
}
