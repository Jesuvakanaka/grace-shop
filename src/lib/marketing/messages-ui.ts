// ZP-1200: labels and button rules for the Contacts, Messages and Partners screens. Pure (safe in the browser).
export const CONSENT_CHANNEL_LABELS: Record<string, string> = { WHATSAPP: 'WhatsApp', SMS: 'Text messages', EMAIL: 'Email' }
export const CONSENT_STATE_LABELS: Record<string, string> = { OPTED_IN: 'Agreed', OPTED_OUT: 'Stopped', NONE: 'No answer' }
export const CONSENT_STATE_CLASSES: Record<string, string> = {
  OPTED_IN: 'bg-brand-olive-50 text-brand-olive-700 border-brand-olive-200',
  OPTED_OUT: 'bg-rose-50 text-rose-700 border-rose-200',
  NONE: 'bg-slate-100 text-slate-600 border-slate-200',
}
export const SOURCE_LABELS: Record<string, string> = { ENQUIRY: 'Enquiry', MANUAL: 'Added by hand', IMPORT: 'Imported', STOREFRONT: 'Website' }

export const MESSAGE_CHANNEL_LABELS: Record<string, string> = { EMAIL: 'Email', SMS: 'Text message (SMS)', WHATSAPP_CLOUD: 'WhatsApp message' }

export const BROADCAST_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Waiting for approval', APPROVED: 'Approved', SENDING: 'Sending', SENT: 'Sent',
  FAILED: 'Some did not go out', CANCELLED: 'Cancelled', REJECTED: 'Rejected',
}
export const BROADCAST_STATUS_CLASSES: Record<string, string> = {
  DRAFT: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-800 border-amber-200',
  APPROVED: 'bg-sky-50 text-sky-800 border-sky-200',
  SENDING: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  SENT: 'bg-brand-olive-50 text-brand-olive-700 border-brand-olive-200',
  FAILED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
}

export interface BroadcastButton { action: 'submit' | 'approve' | 'reject' | 'send' | 'retry' | 'continue' | 'cancel'; label: string; tone: 'primary' | 'secondary' | 'danger'; confirm?: string }

/** The buttons for a message in each status (the server decides what is really allowed). */
export function broadcastButtons(status: string, audience: number): BroadcastButton[] {
  switch (status) {
    case 'DRAFT': return [{ action: 'submit', label: 'Send for approval', tone: 'primary' }, { action: 'cancel', label: 'Cancel', tone: 'danger', confirm: 'Cancel this message?' }]
    case 'PENDING_APPROVAL': return [
      { action: 'approve', label: 'Approve these exact words', tone: 'primary' },
      { action: 'reject', label: 'Reject', tone: 'secondary' },
      { action: 'cancel', label: 'Cancel', tone: 'danger', confirm: 'Cancel this message?' },
    ]
    case 'APPROVED': return [
      { action: 'send', label: `Send to ${audience} ${audience === 1 ? 'person' : 'people'} now`, tone: 'primary', confirm: `This sends a real message to ${audience} ${audience === 1 ? 'person' : 'people'} who agreed to hear from you. Send it?` },
      { action: 'cancel', label: 'Cancel', tone: 'danger', confirm: 'Cancel this message?' },
    ]
    case 'SENDING': return [{ action: 'continue', label: 'Send the next batch', tone: 'primary' }, { action: 'cancel', label: 'Stop sending', tone: 'danger', confirm: 'Stop sending? The people not yet messaged will not get it.' }]
    case 'FAILED': return [{ action: 'retry', label: 'Try the failed ones again', tone: 'primary', confirm: 'Try again for the people it did not reach? People who already got it are not messaged twice.' }, { action: 'cancel', label: 'Cancel', tone: 'danger', confirm: 'Cancel this message?' }]
    default: return []
  }
}

/** Plain-language progress: "12 sent, 1 did not go out, 2 skipped (of 15)". */
export function progressLine(b: { plannedCount: number; sentCount: number; failedCount: number; skippedCount: number }): string {
  if (b.plannedCount === 0) return 'Nobody planned yet.'
  const parts = [`${b.sentCount} sent`]
  if (b.failedCount) parts.push(`${b.failedCount} did not go out`)
  if (b.skippedCount) parts.push(`${b.skippedCount} skipped`)
  return `${parts.join(', ')} (of ${b.plannedCount})`
}
