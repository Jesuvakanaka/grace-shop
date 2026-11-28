// VYRA Marketing hub (ZP-1200): Telegram channel connector, Bot API.
// Docs: https://core.telegram.org/bots/api (Bot API 10.3, checked 2026-11-26).
// Every method is POST https://api.telegram.org/bot<token>/<method> with JSON, answers { ok, result } or
// { ok:false, error_code, description, parameters:{ retry_after } }.
//   1 photo  sendPhoto { chat_id, photo:<url>, caption }       caption max 1024
//   2-10     sendMediaGroup { chat_id, media:[{type:'photo', media:<url>, caption (first only)}] }
//   none     sendMessage { chat_id, text }                      text max 4096
// A caption over 1024 characters is sent as a message right after the photo(s) instead.
// verify(): getMe + getChat. Credentials: botToken. Channel (@username or chat id): channel externalId.
import type { Connector, ConnectorContext, ConnectorPost, PublishResult, VerifyResult, FetchLike } from './types'
import { type Obj, type Failure, failure, gateOrThrow, jsonOf, networkFailure, withLink } from './common'

const base = (token: string) => `https://api.telegram.org/bot${token}`
const botToken = (c: Record<string, string>) => (c.botToken ?? '').trim()
const CAPTION_MAX = 1024
const TEXT_MAX = 4096

interface TgReply { ok: boolean; status: number; result?: Obj; description: string; retryAfter?: number }

async function call(fetchFn: FetchLike, token: string, method: string, payload: Record<string, unknown>): Promise<TgReply> {
  const res = await fetchFn(`${base(token)}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  const b = await jsonOf(res)
  const ok = res.ok && b?.ok === true
  const status = ok ? 200 : Number(b?.error_code) || res.status
  return { ok, status, result: b?.result, description: typeof b?.description === 'string' ? b.description : '', retryAfter: Number(b?.parameters?.retry_after) || undefined }
}

const fail = (r: TgReply): Failure => failure(r.status, 'Telegram', r.description.replace(/bot\d+:[\w-]+/g, 'bot***'))

export const telegramConnector: Connector = {
  kind: 'TELEGRAM',

  async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
    const t = botToken(credentials)
    const chat = (credentials.channel ?? credentials.chatId ?? '').trim()
    if (!t) return { ok: false, error: 'No Telegram bot token was given.' }
    try {
      const me = await call(fetchFn, t, 'getMe', {})
      if (!me.ok) return { ok: false, error: fail(me).error as string }
      if (!chat) return { ok: false, error: 'No channel name or chat ID was given.' }
      const c = await call(fetchFn, t, 'getChat', { chat_id: chat })
      if (!c.ok) return { ok: false, error: `The bot token works but Telegram cannot find the channel ${chat}. Add the bot to the channel as an administrator. ${c.description}`.trim() }
      return { ok: true, externalId: c.result?.id != null ? String(c.result.id) : chat, name: c.result?.title ?? c.result?.username ?? null }
    } catch (e) {
      return { ok: false, error: networkFailure('Telegram', e).error }
    }
  },

  async publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
    gateOrThrow(ctx)
    const t = botToken(ctx.credentials)
    const chat = ctx.externalId
    if (!t || !chat) return { ok: false, error: 'This channel has no Telegram bot token or channel saved.', retryable: false }
    if (post.format !== 'POST') return { ok: false, error: `Telegram ${post.format.toLowerCase()} posts cannot be published automatically. Use a normal post.`, retryable: false }
    const text = withLink(post.text, post.link)
    if (!text) return { ok: false, error: 'The post has no words.', retryable: false }
    const images = post.imageUrls.slice(0, 10)
    try {
      let first: TgReply
      let extra: TgReply | null = null
      if (images.length === 0) {
        if (text.length > TEXT_MAX) return { ok: false, error: `Telegram messages can be ${TEXT_MAX} characters at most. Shorten the post.`, retryable: false }
        first = await call(ctx.fetch, t, 'sendMessage', { chat_id: chat, text })
      } else {
        const caption = text.length <= CAPTION_MAX ? text : undefined
        if (!caption && text.length > TEXT_MAX) return { ok: false, error: `Telegram messages can be ${TEXT_MAX} characters at most. Shorten the post.`, retryable: false }
        if (images.length === 1) {
          first = await call(ctx.fetch, t, 'sendPhoto', { chat_id: chat, photo: images[0], ...(caption ? { caption } : {}) })
        } else {
          first = await call(ctx.fetch, t, 'sendMediaGroup', {
            chat_id: chat,
            media: images.map((u, i) => ({ type: 'photo', media: u, ...(i === 0 && caption ? { caption } : {}) })),
          })
        }
        if (first.ok && !caption) extra = await call(ctx.fetch, t, 'sendMessage', { chat_id: chat, text })
      }
      if (!first.ok) return fail(first)
      const msg = Array.isArray(first.result) ? first.result[0] : first.result
      const messageId = msg?.message_id
      if (messageId == null) return { ok: false, error: 'Telegram did not say whether the post went out. Check the channel before trying again.', retryable: false, uncertain: true }
      const username = typeof msg?.chat?.username === 'string' ? msg.chat.username : chat.startsWith('@') ? chat.slice(1) : null
      const note = extra && !extra.ok ? 'The photos went out but the long text did not: check the channel.' : undefined
      return { ok: true, externalId: `${msg?.chat?.id ?? chat}:${messageId}`, externalUrl: username ? `https://t.me/${username}/${messageId}` : null, ...(note ? { message: note } : {}) }
    } catch (e) {
      return networkFailure('Telegram', e)
    }
  },
}
