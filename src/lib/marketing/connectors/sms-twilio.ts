// VYRA Marketing hub (ZP-1200): SMS connector, Twilio Programmable Messaging.
// Docs: https://www.twilio.com/docs/sms/api/message-resource (checked 2026-11-26).
//   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
//   Basic auth AccountSid:AuthToken, application/x-www-form-urlencoded: To, From (or MessagingServiceSid when it starts MG), Body.
//   Success 201 { sid:'SM...', status:'queued' }.  Error { code, message, status, more_info }.
//   21610 = the recipient replied STOP to this sender (Twilio blocks it); 21211/21614 = bad number.
// Every text ends with "Reply STOP to opt out." unless it already says STOP.
// verify(): GET /2010-04-01/Accounts/{AccountSid}.json
import type { Connector, ConnectorContext, ConnectorMessage, ConnectorPost, PublishResult, SendResult, VerifyResult, FetchLike } from './types'
import { gateOrThrow, jsonOf, networkFailure } from './common'

const BASE = 'https://api.twilio.com/2010-04-01'
export const SMS_STOP_LINE = 'Reply STOP to opt out.'

const auth = (c: Record<string, string>) => `Basic ${Buffer.from(`${(c.accountSid ?? '').trim()}:${(c.authToken ?? '').trim()}`).toString('base64')}`
const sid = (c: Record<string, string>) => (c.accountSid ?? '').trim()

/** The text as sent: the words plus the opt-out line. */
export const withStopLine = (text: string) => (/\bSTOP\b/i.test(text) ? text.trim() : `${text.trim()}\n${SMS_STOP_LINE}`)

export const smsTwilioConnector: Connector = {
  kind: 'SMS',
  messagesOnly: true,

  async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
    if (!sid(credentials) || !(credentials.authToken ?? '').trim()) return { ok: false, error: 'The Twilio account ID and the auth token are both needed.' }
    if (!/^AC[0-9a-fA-F]{32}$/.test(sid(credentials))) return { ok: false, error: 'The Twilio account ID starts with AC and is 34 characters long.' }
    try {
      const res = await fetchFn(`${BASE}/Accounts/${sid(credentials)}.json`, { method: 'GET', headers: { Authorization: auth(credentials) } })
      const b = await jsonOf(res)
      if (!res.ok) return { ok: false, error: res.status === 401 ? 'Twilio did not accept the account ID and auth token.' : `Twilio could not check the account${b?.message ? ` (Twilio says: ${String(b.message).slice(0, 200)})` : ''}.` }
      return { ok: true, externalId: sid(credentials), name: typeof b?.friendly_name === 'string' ? b.friendly_name : null }
    } catch (e) {
      return { ok: false, error: networkFailure('Twilio', e).error }
    }
  },

  async publish(_post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
    gateOrThrow(ctx)
    return { ok: false, retryable: false, error: 'Text messages are sent from the Messages screen, to people who opted in.' }
  },

  async send(m: ConnectorMessage, ctx: ConnectorContext): Promise<SendResult> {
    gateOrThrow(ctx)
    const from = (ctx.credentials.from ?? '').trim()
    if (!sid(ctx.credentials) || !(ctx.credentials.authToken ?? '').trim() || !from) return { ok: false, retryable: false, error: 'This channel has no Twilio account, token or sender saved.' }
    if (!/^\+[1-9]\d{7,14}$/.test(m.to)) return { ok: false, retryable: false, error: 'The phone number is not in international format.' }
    if (!m.text.trim()) return { ok: false, retryable: false, error: 'The message has no words.' }
    const form = new URLSearchParams()
    form.set('To', m.to)
    form.set(/^MG[0-9a-fA-F]{32}$/.test(from) ? 'MessagingServiceSid' : 'From', from)
    form.set('Body', withStopLine(m.text))
    try {
      const res = await ctx.fetch(`${BASE}/Accounts/${sid(ctx.credentials)}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: auth(ctx.credentials), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
      const b = await jsonOf(res)
      if (res.ok && typeof b?.sid === 'string') return { ok: true, externalId: b.sid }
      const code = Number(b?.code) || res.status
      const extra = typeof b?.message === 'string' ? ` (Twilio says: ${b.message.slice(0, 200)})` : ''
      if (code === 21610) return { ok: false, retryable: false, code, optedOut: true, error: `This person replied STOP, so Twilio will not text them.${extra}` }
      if (res.status === 401) return { ok: false, retryable: false, code: 401, error: `Twilio no longer accepts the saved account and token: connect the channel again.${extra}` }
      if (res.status === 429 || res.status >= 500) return { ok: false, retryable: true, code, error: `Twilio is busy or limiting messages right now.${extra}` }
      if (res.ok) return { ok: false, retryable: false, error: 'Twilio did not say whether the text was sent. Check before trying again.' }
      return { ok: false, retryable: false, code, error: `Twilio did not accept the text.${extra}` }
    } catch (e) {
      return networkFailure('Twilio', e)
    }
  },
}
