// VYRA Marketing hub (ZP-1200): Pinterest connector, API v5.
// Docs: https://developers.pinterest.com/docs/api/v5/pins-create/ and https://developers.pinterest.com/docs/content/update/
// Checked 2026-11-26. POST https://api.pinterest.com/v5/pins (scope pins:write; also boards:read to verify),
// body { board_id, title, description, link, media_source:{source_type:'image_url', url} }, answers 201 { id }.
// verify(): GET /v5/user_account (scope user_accounts:read). Pin limits used: title 100, description 800 characters.
// Credentials: accessToken. Board: channel externalId (or config.boardId).
import type { Connector, ConnectorContext, ConnectorPost, PublishResult, VerifyResult, FetchLike } from './types'
import { type Obj, failure, gateOrThrow, jsonOf, networkFailure, splitTitle } from './common'

export const PINTEREST_API = 'https://api.pinterest.com/v5'
const token = (c: Record<string, string>) => (c.accessToken ?? '').trim()
const msgOf = (b: Obj | null) => (typeof b?.message === 'string' ? b.message : '')

export const pinterestConnector: Connector = {
  kind: 'PINTEREST',

  async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
    const t = token(credentials)
    if (!t) return { ok: false, error: 'No Pinterest access token was given.' }
    try {
      const res = await fetchFn(`${PINTEREST_API}/user_account`, { method: 'GET', headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } })
      const body = await jsonOf(res)
      if (!res.ok) return { ok: false, error: failure(res.status, 'Pinterest', msgOf(body)).error }
      return { ok: true, externalId: typeof body?.id === 'string' ? body.id : null, name: typeof body?.username === 'string' ? body.username : null }
    } catch (e) {
      return { ok: false, error: networkFailure('Pinterest', e).error }
    }
  },

  async publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
    gateOrThrow(ctx)
    const t = token(ctx.credentials)
    const boardId = ctx.externalId || (typeof ctx.config?.boardId === 'string' ? ctx.config.boardId : '')
    if (!t) return { ok: false, error: 'This channel has no Pinterest access token saved.', retryable: false }
    if (!boardId) return { ok: false, error: 'This channel has no Pinterest board ID saved. Each pin goes to one board.', retryable: false }
    if (post.format !== 'PIN' && post.format !== 'POST') return { ok: false, error: `Pinterest cannot publish a ${post.format.toLowerCase()} automatically. Use a pin.`, retryable: false }
    if (post.imageUrls.length === 0) return { ok: false, error: 'A pin needs a picture. Add one to the post.', retryable: false }
    const { title, rest } = splitTitle(post.text, 100)
    const description = rest.slice(0, 800)
    const body: Record<string, unknown> = {
      board_id: boardId,
      title,
      description,
      media_source: { source_type: 'image_url', url: post.imageUrls[0] },
    }
    if (post.link) body.link = post.link
    try {
      const res = await ctx.fetch(`${PINTEREST_API}/pins`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
      const out = await jsonOf(res)
      if (!res.ok) return failure(res.status, 'Pinterest', msgOf(out), { retryable: out?.code === 8 })
      const id = typeof out?.id === 'string' ? out.id : null
      if (!id) return { ok: false, error: 'Pinterest did not say whether the pin was created. Check the board before trying again.', retryable: false }
      return { ok: true, externalId: id, externalUrl: `https://www.pinterest.com/pin/${id}/` }
    } catch (e) {
      return networkFailure('Pinterest', e)
    }
  },
}
