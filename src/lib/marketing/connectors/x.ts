// VYRA Marketing hub (ZP-1200): X connector, API v2.
// Docs: https://docs.x.com/x-api/media/quickstart/media-upload-chunked and https://docs.x.com/x-api/posts/create-post
// Checked 2026-11-26.
//   Media (v2, the old v1.1 upload.twitter.com endpoint is not used):
//     POST https://api.x.com/2/media/upload/initialize        JSON { media_type, total_bytes, media_category:'tweet_image' } -> data.id
//     POST https://api.x.com/2/media/upload/{id}/append       multipart { segment_index, media } (chunks of 4 MB, server max 8 MB)
//     POST https://api.x.com/2/media/upload/{id}/finalize     -> data.id
//   Post: POST https://api.x.com/2/tweets  JSON { text, media:{ media_ids:[...] } } -> data.id
//   verify(): GET https://api.x.com/2/users/me
// Credentials: accessToken (OAuth 2.0 user token, scopes tweet.read tweet.write users.read media.write offline.access).
// Cost (pay per use): $0.015 per post, $0.20 per post containing a link. Reported in the result message.
import type { Connector, ConnectorContext, ConnectorPost, PublishResult, VerifyResult, FetchLike } from './types'
import { type Obj, download, failure, gateOrThrow, jsonOf, networkFailure, withLink } from './common'

export const X_API = 'https://api.x.com/2'
const token = (c: Record<string, string>) => (c.accessToken ?? '').trim()
const CHUNK = 4 * 1024 * 1024
const POST_COST_CENTS = 1.5
const LINK_POST_COST_CENTS = 20
/** A link always counts as 23 characters on X (t.co). */
const LINK_WEIGHT = 23

export function expectedCostText(hasLink: boolean): string {
  return hasLink ? 'Expected X cost: $0.20 (post with a link).' : 'Expected X cost: $0.015 (post without a link).'
}
export const expectedCostCents = (hasLink: boolean) => (hasLink ? LINK_POST_COST_CENTS : POST_COST_CENTS)

const errText = (b: Obj | null) =>
  typeof b?.detail === 'string' ? b.detail : typeof b?.title === 'string' ? b.title : Array.isArray(b?.errors) ? String(b.errors[0]?.message ?? '') : ''

class XError extends Error {
  constructor(public readonly status: number, public readonly detail: string) { super(detail) }
}

async function xJson(fetchFn: FetchLike, url: string, accessToken: string, body: unknown): Promise<Obj> {
  const res = await fetchFn(url, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const b = await jsonOf(res)
  if (!res.ok) throw new XError(res.status, errText(b))
  return b ?? {}
}

async function uploadImage(fetchFn: FetchLike, accessToken: string, url: string): Promise<string> {
  const file = await download(fetchFn, url)
  const total = file.bytes.byteLength
  const init = await xJson(fetchFn, `${X_API}/media/upload/initialize`, accessToken, { media_type: file.type, total_bytes: total, media_category: 'tweet_image' })
  const id = init.data?.id
  if (typeof id !== 'string') throw new XError(502, 'X did not return a media ID.')
  for (let i = 0, off = 0; off < total; i++, off += CHUNK) {
    const form = new FormData()
    form.append('segment_index', String(i))
    form.append('media', new Blob([file.bytes.slice(off, off + CHUNK)], { type: file.type }), 'media')
    const res = await fetchFn(`${X_API}/media/upload/${id}/append`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form })
    if (!res.ok) throw new XError(res.status, errText(await jsonOf(res)))
  }
  const fin = await xJson(fetchFn, `${X_API}/media/upload/${id}/finalize`, accessToken, undefined)
  return String(fin.data?.id ?? id)
}

export const xConnector: Connector = {
  kind: 'X',

  async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
    const t = token(credentials)
    if (!t) return { ok: false, error: 'No X access token was given.' }
    try {
      const res = await fetchFn(`${X_API}/users/me`, { method: 'GET', headers: { Authorization: `Bearer ${t}` } })
      const b = await jsonOf(res)
      if (!res.ok) return { ok: false, error: failure(res.status, 'X', errText(b)).error }
      return { ok: true, externalId: b?.data?.id ?? null, name: b?.data?.username ? `@${b.data.username}` : null }
    } catch (e) {
      return { ok: false, error: networkFailure('X', e).error }
    }
  },

  async publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
    gateOrThrow(ctx)
    const t = token(ctx.credentials)
    if (!t) return { ok: false, error: 'This channel has no X access token saved.', retryable: false }
    if (post.format !== 'POST') return { ok: false, error: `X ${post.format.toLowerCase()} posts cannot be published automatically. Use a normal post.`, retryable: false }
    const body = post.text.trim()
    const hasLink = !!post.link
    const text = withLink(body, post.link)
    const weight = body.includes(post.link ?? '\0') ? text.length : body.length + (post.link ? 2 + LINK_WEIGHT : 0)
    if (!text) return { ok: false, error: 'The post has no words.', retryable: false }
    if (weight > 280) return { ok: false, error: `X posts can be 280 characters at most (a link counts as ${LINK_WEIGHT}). This one is ${weight}. Shorten it.`, retryable: false }
    try {
      const mediaIds: string[] = []
      for (const url of post.imageUrls.slice(0, 4)) mediaIds.push(await uploadImage(ctx.fetch, t, url))
      const payload: Record<string, unknown> = { text }
      if (mediaIds.length) payload.media = { media_ids: mediaIds }
      const out = await xJson(ctx.fetch, `${X_API}/tweets`, t, payload)
      const id = out.data?.id
      if (typeof id !== 'string') return { ok: false, error: 'X did not say whether the post went out. Check the account before trying again.', retryable: false }
      const message = expectedCostText(hasLink)
      console.info(`[marketing] X post ${id} created. ${message}`)
      return { ok: true, externalId: id, externalUrl: `https://x.com/i/status/${id}`, message }
    } catch (e) {
      if (e instanceof XError) {
        if (e.status === 402) return { ok: false, retryable: false, code: 402, error: `The X developer account is out of credit. Add credit in the X developer portal. ${expectedCostText(hasLink)}` }
        return failure(e.status, 'X', e.detail)
      }
      return networkFailure('X', e)
    }
  },
}
