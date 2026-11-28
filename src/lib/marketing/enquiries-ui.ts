// ZP-1116 (MM-11): labels for the enquiry screens. Pure, safe in the browser.
export const ENQUIRY_CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp', PHONE: 'Phone call or text', INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', EMAIL: 'Email', IN_SHOP: 'In the shop', OTHER: 'Somewhere else',
}
export const ENQUIRY_STATUS_LABELS: Record<string, string> = { NEW: 'New', CONTACTED: 'Contacted', WAITING: 'Waiting on them', WON: 'Won', LOST: 'Lost' }
export const ENQUIRY_STATUS_CLASSES: Record<string, string> = {
  NEW: 'bg-sky-50 text-sky-800 border-sky-200',
  CONTACTED: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  WAITING: 'bg-amber-50 text-amber-800 border-amber-200',
  WON: 'bg-brand-olive-50 text-brand-olive-700 border-brand-olive-200',
  LOST: 'bg-slate-100 text-slate-600 border-slate-200',
}
export const CONVERSATION_LABELS: Record<string, string> = { OWNER_RECORDED: 'Written down by you', PROVIDER_OBSERVED: 'Seen in the connected inbox' }

export const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Written down', STATUS: 'Moved', NOTE: 'Note', ASSIGNED: 'Assigned', FOLLOW_UP: 'Follow-up date', SALE_LINKED: 'Linked to a sale',
  SALE_UNLINKED: 'Sale link removed', CONTACT_SET: 'Contact set', REPLY_COPIED: 'Reply copied (not sent by VYRA)', REPLY_SENT_BY_OWNER: 'You said you sent a reply',
}

const when = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' }).format(d)

/** "Follow up 3 Dec, 10:00" / "Follow-up overdue since …" / "No follow-up set". */
export function followUpLine(at: string | null, status: string, now = new Date()): string {
  if (status === 'WON' || status === 'LOST') return ENQUIRY_STATUS_LABELS[status]
  if (!at) return 'No follow-up set'
  const d = new Date(at)
  return d.getTime() <= now.getTime() ? `Follow-up due since ${when(d)}` : `Follow up ${when(d)}`
}
