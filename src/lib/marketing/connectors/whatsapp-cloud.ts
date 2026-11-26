// VYRA Marketing hub (ZP-1200): WhatsApp Business Cloud API connector (template messages to opted-in customers only).
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages (checked 2026-11-26).
//   POST https://graph.facebook.com/<version>/<phone-number-id>/messages   Authorization: Bearer <token>, JSON
//   { messaging_product:'whatsapp', recipient_type:'individual', to:'<digits>', type:'template',
//     template:{ name, language:{code}, components:[{type:'body', parameters:[{type:'text', text}]}] } }
//   Success: { messages:[{ id:'wamid...' }] }.  Errors: { error:{ message, code, error_data } }.
// Marketing messages outside the 24-hour customer-service window MUST be approved templates, so this connector
// never sends free text. Meta charges per marketing template message delivered.
// verify(): GET /<phone-number-id>?fields=verified_name,display_phone_number.
import { graphBase } from './meta-graph'
import type { Connector, ConnectorContext, ConnectorMessage, ConnectorPost, PublishResult, SendResult, VerifyResult, FetchLike } from './types'
import { gateOrThrow, jsonOf, networkFailure } from './common'

const token = (c: Record<string, string>) => (c.accessToken ?? '').trim()
const phoneId = (c: Record<string, string>, ext: string | null) => (c.phoneNumberId ?? ext ?? '').trim()

/** Meta codes for "try again later": rate limits (130429, 131056, 80007) and temporary errors (131000, 2, 1). */
const RETRY = new Set([1, 2, 4, 17, 80007, 130429, 131000, 131056, 133016])

export function whatsappPayload(m: ConnectorMessage): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: m.to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: m.templateName,
      language: { code: m.templateLanguage || 'en' },
      ...(m.templateVars.length > 0 ? { components: [{ type: 'body', parameters: m.templateVars.map((t) => ({ type: 'text', text: t })) }] } : {}),
    },
  }
}

export const whatsappCloudConnector: Connector = {
  kind: 'WHATSAPP_CLOUD',
  messagesOnly: true,

  async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
    const t = token(credentials)
    const id = phoneId(credentials, null)
    if (!t || !id) return { ok: false, error: 'The phone number ID and the access token are both needed.' }
    try {
      const res = await fetchFn(`${graphBase()}/${id}?fields=verified_name,display_phone_number`, { method: 'GET', headers: { Authorization: `Bearer ${t}` } })
      const b = await jsonOf(res)
      if (!res.ok) {
        const code = Number(b?.error?.code)
        if (res.status === 401 || code === 190) return { ok: false, error: 'WhatsApp did not accept the token. It may have expired: make a new permanent token and try again.' }
        return { ok: false, error: `WhatsApp could not find that phone number ID with this token${b?.error?.message ? ` (Meta says: ${String(b.error.message).slice(0, 200)})` : ''}.` }
      }
      return { ok: true, externalId: String(b?.id ?? id), name: [b?.verified_name, b?.display_phone_number].filter(Boolean).join(' ') || null }
    } catch (e) {
      return { ok: false, error: networkFailure('WhatsApp', e).error }
    }
  },

  /** Posts are not sent here: customer messages go out one by one from the Messages screen. */
  async publish(_post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
    gateOrThrow(ctx)
    return { ok: false, retryable: false, error: 'WhatsApp messages are sent from the Messages screen, to people who opted in.' }
  },

  async send(m: ConnectorMessage, ctx: ConnectorContext): Promise<SendResult> {
    gateOrThrow(ctx)
    const t = token(ctx.credentials)
    const id = phoneId(ctx.credentials, ctx.externalId)
    if (!t || !id) return { ok: false, retryable: false, error: 'This channel has no phone number ID or token saved.' }
    if (!m.templateName) return { ok: false, retryable: false, error: 'WhatsApp marketing messages need an approved template name. Free text is not allowed outside the 24-hour window.' }
    if (!/^\+[1-9]\d{7,14}$/.test(m.to)) return { ok: false, retryable: false, error: 'The phone number is not in international format.' }
    try {
      const res = await ctx.fetch(`${graphBase()}/${id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(whatsappPayload(m)),
      })
      const b = await jsonOf(res)
      const wamid = b?.messages?.[0]?.id
      if (res.ok && typeof wamid === 'string') return { ok: true, externalId: wamid }
      const code = Number(b?.error?.code) || res.status
      const msg = typeof b?.error?.message === 'string' ? b.error.message.slice(0, 200) : ''
      const extra = msg ? ` (Meta says: ${msg})` : ''
      if (res.status === 401 || code === 190) return { ok: false, retryable: false, code: 401, error: `WhatsApp no longer accepts the saved token: connect the channel again.${extra}` }
      if (res.ok) return { ok: false, retryable: false, error: 'WhatsApp did not say whether the message was sent. Check before trying again.' }
      if (RETRY.has(code) || res.status === 429 || res.status >= 500) return { ok: false, retryable: true, code, error: `WhatsApp is busy or limiting messages right now.${extra}` }
      if (code === 132001 || code === 132000 || code === 132012) return { ok: false, retryable: false, code, error: `WhatsApp does not accept this template (name, language or fields do not match the approved one).${extra}` }
      if (code === 131049) return { ok: false, retryable: false, code, error: `WhatsApp chose not to deliver this marketing message to this person.${extra}` }
      return { ok: false, retryable: false, code, error: `WhatsApp did not accept the message.${extra}` }
    } catch (e) {
      return networkFailure('WhatsApp', e)
    }
  },
}
