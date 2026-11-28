// VYRA Marketing hub (ZP-1200): small helpers shared by the Pinterest, Telegram, X, YouTube and TikTok connectors.
import { assertCanGoLive } from '../flags'
import type { ConnectorContext, FetchLike, PublishResult } from './types'

/** Fails closed: throws a 409 WebsiteError unless every go-live condition holds. Call before ANY request. */
export function gateOrThrow(ctx: ConnectorContext): void {
  assertCanGoLive(ctx.gate ?? { settings: null, channel: null, post: null })
}

/**
 * ZP-1124: a step the connector knows came BEFORE any request that could create the post (a photo it could
 * not download, a missing setting). Nothing can be on the platform, so the outcome is a plain failure, never uncertain.
 */
export class NotSentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotSentError'
  }
}

/** Parsed JSON from a platform: its shape is the platform's, checked field by field where used. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>

export type Failure = Extract<PublishResult, { ok: false }>

export const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?.*)?$/i

/** The video link of a post: config.videoUrl first, else the first attached file that looks like a video. */
export function videoUrlOf(ctx: ConnectorContext, imageUrls: string[]): string | null {
  const v = ctx.config?.videoUrl
  if (typeof v === 'string' && /^https:\/\//i.test(v.trim())) return v.trim()
  return imageUrls.find((u) => VIDEO_EXT.test(u)) ?? null
}

export async function jsonOf(res: Response): Promise<Obj | null> {
  try {
    const t = await res.text()
    if (!t) return null
    const v = JSON.parse(t)
    return v && typeof v === 'object' ? (v as Obj) : null
  } catch {
    return null
  }
}

/**
 * Map an HTTP status to a result the runner understands.
 * 401 = token no longer valid (code 401, not retryable); 429 = retryable.
 * 5xx = uncertain (ZP-1124, MM-09-AC2): the platform may have created the post before it failed to answer,
 * so the post is never retried blind. This is also applied to pre-steps (a photo upload), which is cautious but safe.
 */
export function failure(status: number, platform: string, detail: string, opts: { tokenExpired?: boolean; retryable?: boolean } = {}): Failure {
  const extra = detail ? ` (${platform} says: ${detail.slice(0, 200)})` : ''
  if (opts.tokenExpired || status === 401) {
    return { ok: false, retryable: false, code: 401, error: `${platform} no longer accepts the saved access. It has expired or been revoked: connect the channel again.${extra}` }
  }
  if (status === 429 || opts.retryable) {
    return { ok: false, retryable: true, code: 429, error: `${platform} is limiting how often VYRA can post right now. It will work again later.${extra}` }
  }
  if (status >= 500) return { ok: false, retryable: false, uncertain: true, code: status, error: `${platform} had a problem and did not answer clearly.${extra}` }
  if (status === 403) return { ok: false, retryable: false, code: 403, error: `${platform} refused this request (the account or app may lack a permission).${extra}` }
  return { ok: false, retryable: false, code: status, error: `${platform} did not accept the post.${extra}` }
}

/** Download a file (photo or video) the platform needs uploaded by us. Throws a plain Error on failure. */
export async function download(fetchFn: FetchLike, url: string): Promise<{ bytes: ArrayBuffer; type: string }> {
  const res = await fetchFn(url)
  if (!res.ok) throw new NotSentError(`Could not download the file ${url} (HTTP ${res.status}).`)
  return { bytes: await res.arrayBuffer(), type: res.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream' }
}

/**
 * A network-level failure (fetch threw): no secrets in the text. The request may have reached the
 * platform before the connection broke, so for a post it is `uncertain` (the post may be out).
 */
export function networkFailure(platform: string, e: unknown): Failure {
  if (e instanceof NotSentError) return { ok: false, retryable: false, error: e.message }
  const msg = e instanceof Error ? e.message : 'unknown error'
  return { ok: false, retryable: true, uncertain: true, error: `Could not reach ${platform}: ${msg.slice(0, 160)}` }
}

/** First line (trimmed, max n characters) used as a title; the rest as a body. */
export function splitTitle(text: string, max: number): { title: string; rest: string } {
  const t = text.trim()
  const nl = t.indexOf('\n')
  let first = (nl === -1 ? t : t.slice(0, nl)).trim()
  let rest = nl === -1 ? '' : t.slice(nl + 1).trim()
  if (first.length > max) {
    const cut = first.slice(0, max)
    const sp = cut.lastIndexOf(' ')
    const head = sp > max * 0.5 ? cut.slice(0, sp) : cut
    rest = `${first.slice(head.length).trim()}${rest ? `\n${rest}` : ''}`.trim()
    first = head.trim()
  }
  return { title: first, rest }
}

export function withLink(text: string, link: string | null): string {
  const t = text.trim()
  if (!link || t.includes(link)) return t
  return t ? `${t}\n\n${link}` : link
}
