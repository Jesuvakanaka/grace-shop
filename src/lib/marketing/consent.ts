// VYRA Marketing hub (ZP-1200): contact details and consent. The rules that decide who may be messaged.
// A message may go only to a contact whose LATEST consent row for that exact channel is OPTED_IN.
// Pure apart from the two database helpers at the bottom.

export const CONSENT_CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL'] as const
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number]
export const CONSENT_STATUSES = ['OPTED_IN', 'OPTED_OUT'] as const
export type ConsentStatus = (typeof CONSENT_STATUSES)[number]
export const CONTACT_SOURCES = ['ENQUIRY', 'MANUAL', 'IMPORT', 'STOREFRONT'] as const
/**
 * MM-12: what a permission is for. PROMOTION covers offers and new stock; FEEDBACK covers review and feedback
 * requests. Permission for one never covers the other. A service reply to the customer's own enquiry needs none.
 */
export const CONSENT_PURPOSES = ['PROMOTION', 'FEEDBACK'] as const
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

/** The consent channel a broadcast channel needs. WhatsApp consent does not allow SMS, and so on. */
export const CONSENT_FOR_CHANNEL: Readonly<Record<string, ConsentChannel>> = {
  WHATSAPP_CLOUD: 'WHATSAPP',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
}

export interface ConsentRow {
  channel: string
  /** Rows from before MM-12 have no purpose: they were for promotion. */
  purpose?: string | null
  status: string
  recordedAt: Date | string
  id: number
}

const at = (r: ConsentRow) => new Date(r.recordedAt).getTime()

const purposeOf = (r: ConsentRow) => r.purpose || 'PROMOTION'

/** The row that counts for a channel and purpose: the newest by recordedAt, a higher id breaking a tie. Null when none. */
export function latestConsent<T extends ConsentRow>(rows: readonly T[], channel: string, purpose: string = 'PROMOTION'): T | null {
  let best: T | null = null
  for (const r of rows) {
    if (r.channel !== channel || purposeOf(r) !== purpose) continue
    if (!best || at(r) > at(best) || (at(r) === at(best) && r.id > best.id)) best = r
  }
  return best
}

/** True only when the latest row for exactly this channel and purpose says OPTED_IN. No row, or OPTED_OUT, is false. */
export function isOptedIn(rows: readonly ConsentRow[], channel: string, purpose: string = 'PROMOTION'): boolean {
  return latestConsent(rows, channel, purpose)?.status === 'OPTED_IN'
}

/**
 * MM-12-AC4: opting back in after an opt-out needs new evidence: some evidence, and not the evidence of any earlier
 * row for this channel and purpose. Returns why not, or null when the new row may be written.
 */
export function restorationProblem(rows: readonly (ConsentRow & { evidence?: string | null })[], channel: string, purpose: string, evidence: string | null): string | null {
  const latest = latestConsent(rows, channel, purpose)
  if (latest?.status !== 'OPTED_OUT') return null
  const e = evidence?.trim().toLowerCase() ?? ''
  if (!e) return 'This person opted out before. Opting them back in needs new evidence: write down when and how they asked again.'
  const used = rows.some((r) => r.channel === channel && purposeOf(r) === purpose && (r.evidence ?? '').trim().toLowerCase() === e)
  if (used) return 'That evidence was already used before the opt-out. Opting back in needs new evidence.'
  return null
}

/** Current promotional state per channel: 'OPTED_IN' | 'OPTED_OUT' | 'NONE'. */
export function consentSummary(rows: readonly ConsentRow[], purpose: string = 'PROMOTION'): Record<ConsentChannel, ConsentStatus | 'NONE'> {
  const out = {} as Record<ConsentChannel, ConsentStatus | 'NONE'>
  for (const c of CONSENT_CHANNELS) out[c] = (latestConsent(rows, c, purpose)?.status as ConsentStatus | undefined) ?? 'NONE'
  return out
}

/**
 * Phone number to E.164. Zimbabwe (+263) is the default: "0771234567", "263771234567", "00263771234567",
 * "771234567" and "+263 77 123 4567" all become +263771234567. Other countries must start with + (or 00).
 * Null when it cannot be a phone number.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim().replace(/[\s().-]/g, '')
  if (!s) return null
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  if (!s.startsWith('+')) {
    if (/^0\d{9}$/.test(s)) s = `+263${s.slice(1)}`
    else if (/^263\d{9}$/.test(s)) s = `+${s}`
    else if (/^7\d{8}$/.test(s)) s = `+263${s}`
    else return null
  }
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null
  if (s.startsWith('+263') && !/^\+263\d{9}$/.test(s)) return null
  return s
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  if (s.length > 254 || !/^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/.test(s)) return null
  return s
}

/** The address a channel sends to, or null when the contact has none. */
export function addressFor(channelKind: string, c: { phone: string | null; email: string | null }): string | null {
  return channelKind === 'EMAIL' ? c.email : c.phone
}

/** Yes/no words for a CSV consent column. Anything else (including blank) is "no answer". */
export function parseConsentCell(v: string | undefined): ConsentStatus | null {
  const s = (v ?? '').trim().toLowerCase()
  if (['yes', 'y', 'true', '1', 'opted_in', 'opted in', 'opt in', 'opt-in', 'subscribed', 'agreed'].includes(s)) return 'OPTED_IN'
  if (['no', 'n', 'false', '0', 'opted_out', 'opted out', 'opt out', 'opt-out', 'unsubscribed', 'stop'].includes(s)) return 'OPTED_OUT'
  return null
}
