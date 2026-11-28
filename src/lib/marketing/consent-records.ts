// VYRA Marketing Manager (ZP-1117, MM-12): the one place a consent row is written. Server only.
// - Opting back in after an opt-out needs new evidence (MM-12-AC4).
// - An opt-out takes the person off every message still waiting to go to them for that channel and purpose, at
//   once (MM-12-AC1). Sending also checks again right before each message. Skipped messages are never brought back.
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { CONSENT_FOR_CHANNEL, restorationProblem, type ConsentChannel, type ConsentPurpose, type ConsentStatus } from './consent'

/** The consent purpose a message of this purpose needs. */
export const PURPOSE_FOR_BROADCAST: Readonly<Record<string, ConsentPurpose>> = { PROMOTION: 'PROMOTION', REVIEW_REQUEST: 'FEEDBACK' }

export interface ConsentWrite {
  contactId: number
  channel: ConsentChannel
  purpose: ConsentPurpose
  status: ConsentStatus
  method: string
  evidence: string | null
  recordedBy: string
}

/** Write one history row. Returns how many waiting messages the person was taken off (opt-outs only). */
export async function writeConsent(db: Db, w: ConsentWrite, audit: { via?: string } = {}): Promise<{ withdrawn: number }> {
  if (w.status === 'OPTED_IN') {
    const rows = await db.marketingConsent.findMany({ where: { contactId: w.contactId, channel: w.channel } })
    const problem = restorationProblem(rows, w.channel, w.purpose, w.evidence)
    if (problem) throw new WebsiteError(409, problem, { field: 'evidence' })
  }
  await db.marketingConsent.create({ data: { contactId: w.contactId, channel: w.channel, purpose: w.purpose, status: w.status, method: w.method, evidence: w.evidence, recordedBy: w.recordedBy } })
  const withdrawn = w.status === 'OPTED_OUT' ? await withdrawPending(db, w.contactId, w.channel, w.purpose) : 0
  await writeAudit(db, {
    actor: w.recordedBy, action: w.status === 'OPTED_IN' ? 'consent.opt_in' : 'consent.opt_out', entity: 'contact', entityId: w.contactId,
    detail: { channel: w.channel, purpose: w.purpose, method: w.method, withdrawn, ...(audit.via ? { via: audit.via } : {}) },
  })
  return { withdrawn }
}

/** Take the contact off every waiting message that needs this channel and purpose. */
export async function withdrawPending(db: Db, contactId: number, channel: ConsentChannel, purpose: ConsentPurpose): Promise<number> {
  const kinds = Object.entries(CONSENT_FOR_CHANNEL).filter(([, c]) => c === channel).map(([k]) => k)
  const purposes = Object.entries(PURPOSE_FOR_BROADCAST).filter(([, p]) => p === purpose).map(([k]) => k)
  const res = await db.marketingBroadcastRecipient.updateMany({
    where: { contactId, status: 'PENDING', broadcast: { channelKind: { in: kinds }, purpose: { in: purposes } } },
    data: { status: 'SKIPPED', error: 'Opted out.' },
  })
  return res.count
}
