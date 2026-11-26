// VYRA Marketing hub (ZP-1200): email connector, Brevo (formerly Sendinblue) transactional email API v3.
// Docs: https://developers.brevo.com/reference/send-transac-email (checked 2026-11-26).
//   POST https://api.brevo.com/v3/smtp/email   header api-key: <key>, JSON
//   { sender:{name,email}, to:[{email,name?}], subject, htmlContent, textContent, headers:{ 'List-Unsubscribe', 'List-Unsubscribe-Post' } }
//   Success 201 { messageId:'<...>' }.  Errors { code, message }.
// Every email carries the unsubscribe link in the footer AND as List-Unsubscribe headers (one-click, RFC 8058);
// an email with no unsubscribe link is never sent. verify(): GET https://api.brevo.com/v3/account.
import type { Connector, ConnectorContext, ConnectorMessage, ConnectorPost, PublishResult, SendResult, VerifyResult, FetchLike } from './types'
import { gateOrThrow, jsonOf, networkFailure } from './common'

const BASE = 'https://api.brevo.com/v3'
export const EMAIL_SENDER_NAME = 'VYRA'
const key = (c: Record<string, string>) => (c.apiKey ?? '').trim()

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Plain text to simple HTML: paragraphs, line breaks, links made clickable. */
export function emailHtml(text: string, unsubscribeUrl: string): string {
  const body = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
    .join('\n')
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#222">\n${body}\n<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">\n<p style="font-size:13px;color:#666">You are getting this because you asked to hear from ${EMAIL_SENDER_NAME}. <a href="${esc(unsubscribeUrl)}">Unsubscribe</a></p>\n</body></html>`
}

export const emailText = (text: string, unsubscribeUrl: string) => `${text.trim()}\n\n--\nYou are getting this because you asked to hear from ${EMAIL_SENDER_NAME}.\nUnsubscribe: ${unsubscribeUrl}`

export function brevoPayload(m: ConnectorMessage, senderEmail: string): Record<string, unknown> {
  const url = m.unsubscribeUrl as string
  return {
    sender: { name: EMAIL_SENDER_NAME, email: senderEmail },
    to: [{ email: m.to, ...(m.toName ? { name: m.toName } : {}) }],
    subject: m.subject,
    htmlContent: emailHtml(m.text, url),
    textContent: emailText(m.text, url),
    headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }
}

export const emailBrevoConnector: Connector = {
  kind: 'EMAIL',
  messagesOnly: true,

  async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
    if (!key(credentials)) return { ok: false, error: 'No Brevo API key was given.' }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((credentials.senderEmail ?? '').trim())) return { ok: false, error: 'The sender email address does not look right.' }
    try {
      const res = await fetchFn(`${BASE}/account`, { method: 'GET', headers: { 'api-key': key(credentials), accept: 'application/json' } })
      const b = await jsonOf(res)
      if (!res.ok) return { ok: false, error: res.status === 401 ? 'Brevo did not accept the API key.' : `Brevo could not check the key${b?.message ? ` (Brevo says: ${String(b.message).slice(0, 200)})` : ''}.` }
      return { ok: true, externalId: (credentials.senderEmail ?? '').trim(), name: typeof b?.companyName === 'string' ? b.companyName : typeof b?.email === 'string' ? b.email : null }
    } catch (e) {
      return { ok: false, error: networkFailure('Brevo', e).error }
    }
  },

  async publish(_post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
    gateOrThrow(ctx)
    return { ok: false, retryable: false, error: 'Emails are sent from the Messages screen, to people who opted in.' }
  },

  async send(m: ConnectorMessage, ctx: ConnectorContext): Promise<SendResult> {
    gateOrThrow(ctx)
    const sender = (ctx.credentials.senderEmail ?? ctx.externalId ?? '').trim()
    if (!key(ctx.credentials) || !sender) return { ok: false, retryable: false, error: 'This channel has no Brevo key or sender address saved.' }
    if (!m.unsubscribeUrl) return { ok: false, retryable: false, error: 'Every email must carry an unsubscribe link. This one has none, so it was not sent.' }
    if (!m.subject?.trim()) return { ok: false, retryable: false, error: 'The email has no subject.' }
    if (!m.text.trim()) return { ok: false, retryable: false, error: 'The email has no words.' }
    try {
      const res = await ctx.fetch(`${BASE}/smtp/email`, {
        method: 'POST',
        headers: { 'api-key': key(ctx.credentials), 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(brevoPayload(m, sender)),
      })
      const b = await jsonOf(res)
      if (res.ok && typeof b?.messageId === 'string') return { ok: true, externalId: b.messageId }
      const extra = typeof b?.message === 'string' ? ` (Brevo says: ${b.message.slice(0, 200)})` : ''
      if (res.status === 401) return { ok: false, retryable: false, code: 401, error: `Brevo no longer accepts the saved API key: connect the channel again.${extra}` }
      if (res.status === 429 || res.status >= 500) return { ok: false, retryable: true, code: res.status, error: `Brevo is busy or limiting emails right now.${extra}` }
      if (res.ok) return { ok: false, retryable: false, error: 'Brevo did not say whether the email was sent. Check before trying again.' }
      return { ok: false, retryable: false, code: res.status, error: `Brevo did not accept the email (is the sender address verified in Brevo?).${extra}` }
    } catch (e) {
      return networkFailure('Brevo', e)
    }
  },
}
