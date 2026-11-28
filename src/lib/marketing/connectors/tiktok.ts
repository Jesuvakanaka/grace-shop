// VYRA Marketing hub (ZP-1200): TikTok connector, Content Posting API, "upload to inbox" (draft) flow ONLY.
// Docs: https://developers.tiktok.com/doc/content-posting-api-reference-upload-video and
// https://developers.tiktok.com/doc/content-posting-api-reference-photo-post . Checked 2026-11-26.
//   Video  POST https://open.tiktokapis.com/v2/post/publish/inbox/video/init/   scope video.upload
//          { source_info:{ source:'PULL_FROM_URL', video_url } }  (domain must be verified in the TikTok developer portal)
//          or FILE_UPLOAD { video_size, chunk_size, total_chunk_count } then PUT the bytes to data.upload_url
//          (Content-Type, Content-Length, Content-Range). Used when config.uploadMode === 'file'.
//   Photos POST https://open.tiktokapis.com/v2/post/publish/content/init/      scope video.upload
//          { media_type:'PHOTO', post_mode:'MEDIA_UPLOAD', post_info:{ title<=90, description<=4000 },
//            source_info:{ source:'PULL_FROM_URL', photo_images:[<=35 urls], photo_cover_index:0 } }
// Both answer { data:{ publish_id }, error:{ code:'ok' } }. Limits: 6 init calls a minute per token, at most 5 pending
// drafts per 24 hours. DIRECT_POST is deliberately never used: Michael finishes the post in the TikTok app.
// verify(): GET /v2/user/info/ (scope user.info.basic). Credentials: accessToken.
import type { Connector, ConnectorContext, ConnectorPost, PublishResult, VerifyResult, FetchLike } from './types'
import { type Obj, download, failure, gateOrThrow, jsonOf, networkFailure, splitTitle, videoUrlOf, withLink } from './common'

export const TIKTOK_API = 'https://open.tiktokapis.com/v2'
export const TIKTOK_INBOX_MESSAGE = 'Sent to your TikTok inbox: open TikTok to post it'
const token = (c: Record<string, string>) => (c.accessToken ?? '').trim()
const CHUNK = 64 * 1024 * 1024

function mapError(status: number, code: string, message: string): PublishResult {
  const detail = [code, message].filter(Boolean).join(': ')
  if (code === 'access_token_invalid' || code === 'scope_not_authorized' || status === 401) return failure(401, 'TikTok', detail, { tokenExpired: true })
  if (code === 'rate_limit_exceeded' || status === 429) return failure(429, 'TikTok', detail)
  if (code === 'spam_risk_too_many_pending_share') {
    return { ok: false, retryable: false, code: 403, error: 'TikTok allows 5 drafts waiting in the inbox per day. Open TikTok, post or delete some, then try again tomorrow.' }
  }
  if (code === 'url_ownership_unverified') {
    return { ok: false, retryable: false, code: 403, error: 'TikTok does not trust the address the file is on. Verify the VYRA website domain in the TikTok developer portal (URL properties), or set config uploadMode to "file".' }
  }
  if (code === 'app_version_check_failed') return { ok: false, retryable: false, code: 400, error: 'The TikTok app on your phone is too old for photo drafts. Update it (version 31.8 or later).' }
  if (code === 'internal_error' || status >= 500) return failure(500, 'TikTok', detail)
  return failure(status, 'TikTok', detail)
}

async function init(fetchFn: FetchLike, accessToken: string, path: string, body: unknown): Promise<{ result: PublishResult | null; data: Obj | null }> {
  const res = await fetchFn(`${TIKTOK_API}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body),
  })
  const b = await jsonOf(res)
  const code = typeof b?.error?.code === 'string' ? b.error.code : ''
  if (!res.ok || (code && code !== 'ok')) return { result: mapError(res.status, code, String(b?.error?.message ?? '')), data: null }
  return { result: null, data: b?.data ?? null }
}

export const tiktokConnector: Connector = {
  kind: 'TIKTOK',

  async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
    const t = token(credentials)
    if (!t) return { ok: false, error: 'No TikTok access token was given.' }
    try {
      const res = await fetchFn(`${TIKTOK_API}/user/info/?fields=open_id,display_name`, { method: 'GET', headers: { Authorization: `Bearer ${t}` } })
      const b = await jsonOf(res)
      const code = typeof b?.error?.code === 'string' ? b.error.code : ''
      if (!res.ok || (code && code !== 'ok')) {
        const r = mapError(res.status, code, String(b?.error?.message ?? ''))
        return { ok: false, error: r.ok ? 'TikTok refused the token.' : r.error }
      }
      return { ok: true, externalId: b?.data?.user?.open_id ?? null, name: b?.data?.user?.display_name ?? null }
    } catch (e) {
      return { ok: false, error: networkFailure('TikTok', e).error }
    }
  },

  async publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
    gateOrThrow(ctx)
    const t = token(ctx.credentials)
    if (!t) return { ok: false, error: 'This channel has no TikTok access token saved.', retryable: false }
    const videoUrl = videoUrlOf(ctx, post.imageUrls)
    const photos = post.imageUrls.filter((u) => u !== videoUrl).slice(0, 35)
    const wantsVideo = post.format === 'VIDEO' || post.format === 'REEL'
    if (wantsVideo && !videoUrl) return { ok: false, error: 'TikTok needs a video file. Add a video link (config.videoUrl) or attach a video to the post.', retryable: false }
    if (!wantsVideo && photos.length === 0) return { ok: false, error: 'TikTok needs a video or photos. Add one to the post.', retryable: false }
    try {
      let publishId: string | undefined
      if (wantsVideo && videoUrl) {
        if (ctx.config?.uploadMode === 'file') {
          const file = await download(ctx.fetch, videoUrl)
          const size = file.bytes.byteLength
          const chunk = Math.min(size, CHUNK)
          const total = Math.max(1, Math.floor(size / chunk))
          const r = await init(ctx.fetch, t, '/post/publish/inbox/video/init/', { source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: total } })
          if (r.result) return r.result
          const uploadUrl = r.data?.upload_url
          publishId = r.data?.publish_id
          if (typeof uploadUrl !== 'string' || !publishId) return { ok: false, error: 'TikTok did not give an upload address. Try again.', retryable: true }
          const mime = /^video\/(mp4|quicktime|webm)$/.test(file.type) ? file.type : 'video/mp4'
          for (let i = 0; i < total; i++) {
            const start = i * chunk
            const end = i === total - 1 ? size : start + chunk
            const put = await ctx.fetch(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': mime, 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
              body: file.bytes.slice(start, end),
            })
            if (!put.ok) return failure(put.status, 'TikTok', 'the video upload was refused')
          }
        } else {
          const r = await init(ctx.fetch, t, '/post/publish/inbox/video/init/', { source_info: { source: 'PULL_FROM_URL', video_url: videoUrl } })
          if (r.result) return r.result
          publishId = r.data?.publish_id
        }
      } else {
        const { title, rest } = splitTitle(post.text, 90)
        const r = await init(ctx.fetch, t, '/post/publish/content/init/', {
          media_type: 'PHOTO',
          post_mode: 'MEDIA_UPLOAD',
          post_info: { title, description: withLink(rest, post.link).slice(0, 4000) },
          source_info: { source: 'PULL_FROM_URL', photo_images: photos, photo_cover_index: 0 },
        })
        if (r.result) return r.result
        publishId = r.data?.publish_id
      }
      if (!publishId) return { ok: false, error: 'TikTok did not confirm the draft. Check your TikTok inbox before trying again.', retryable: false, uncertain: true }
      return { ok: true, externalId: publishId, externalUrl: null, message: TIKTOK_INBOX_MESSAGE }
    } catch (e) {
      return networkFailure('TikTok', e)
    }
  },
}
