// VYRA Marketing hub (ZP-1200): unsubscribe links. The token is an HMAC of contactId + channel, so it cannot be
// forged or changed to unsubscribe someone else. It does not expire: an old email must still work. Server only.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { writeAudit, type Db } from './audit'
import { CONSENT_CHANNELS, type ConsentChannel } from './consent'
import { CONSENT_PURPOSES, latestConsent } from './consent'
import { writeConsent } from './consent-records'

const INFO = 'grace-marketing-unsubscribe-v1'

function key(): Buffer {
  const secret = process.env.MARKETING_TOKEN_KEY ?? process.env.JWT_SECRET
  if (!secret) throw new Error('Set MARKETING_TOKEN_KEY (or JWT_SECRET) before sending messages.')
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), INFO, 32))
}

const mac = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url')

/** `<contactId>.<CHANNEL>.<hmac>` */
export function signUnsubscribeToken(contactId: number, channel: ConsentChannel): string {
  const payload = `${contactId}.${channel}`
  return `${payload}.${mac(payload)}`
}

/** The contact and channel, or null for anything that was not made by signUnsubscribeToken (tampered, truncated, junk). */
export function verifyUnsubscribeToken(token: unknown): { contactId: number; channel: ConsentChannel } | null {
  if (typeof token !== 'string' || token.length > 200) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [id, channel, sig] = parts
  if (!/^[1-9]\d{0,9}$/.test(id) || !(CONSENT_CHANNELS as readonly string[]).includes(channel)) return null
  const expected = Buffer.from(mac(`${id}.${channel}`))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return { contactId: Number(id), channel: channel as ConsentChannel }
}

export function unsubscribeUrl(origin: string, contactId: number, channel: ConsentChannel): string {
  return `${origin.replace(/\/+$/, '')}/api/public/marketing/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(contactId, channel))}`
}

/** Writes OPTED_OUT (history row) unless the contact is already opted out for that channel. Returns what happened. */
export async function applyUnsubscribe(db: Db, token: unknown): Promise<'done' | 'already' | 'invalid'> {
  const t = verifyUnsubscribeToken(token)
  if (!t) return 'invalid'
  const contact = await db.marketingContact.findUnique({ where: { id: t.contactId }, select: { id: true } })
  if (!contact) return 'invalid'
  const rows = await db.marketingConsent.findMany({ where: { contactId: t.contactId, channel: t.channel } })
  // MM-12: the link stops every kind of message on that channel (offers and review requests alike).
  const open = CONSENT_PURPOSES.filter((p) => latestConsent(rows, t.channel, p)?.status !== 'OPTED_OUT')
  if (open.length === 0) return 'already'
  for (const purpose of open) {
    await writeConsent(db, { contactId: t.contactId, channel: t.channel, purpose, status: 'OPTED_OUT', method: 'Used the unsubscribe link', evidence: null, recordedBy: 'self:unsubscribe' }, { via: 'unsubscribe link' })
  }
  return 'done'
}
