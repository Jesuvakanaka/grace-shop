// VYRA Marketing hub (ZP-1200): small pure helpers for the screens. No server imports, safe in the browser.
import { CHANNELS, getChannel, type ChannelDef, type ChannelFamily } from './channels'

export const FAMILY_LABELS: Record<ChannelFamily, string> = {
  meta: 'Facebook and Instagram',
  whatsapp: 'WhatsApp',
  google: 'Google',
  video: 'Video',
  social: 'Other social',
  messages: 'Email and text messages',
  partners: 'People who help you sell',
  offline: 'Offline',
}
const FAMILY_ORDER: ChannelFamily[] = ['meta', 'whatsapp', 'google', 'video', 'social', 'messages', 'partners', 'offline']

/** Group any list of channel-like items by family, in a fixed order, empty families left out. */
export function groupByFamily<T extends { family: ChannelFamily }>(items: readonly T[]): { family: ChannelFamily; label: string; items: T[] }[] {
  return FAMILY_ORDER.map((family) => ({ family, label: FAMILY_LABELS[family], items: items.filter((i) => i.family === family) })).filter((g) => g.items.length > 0)
}

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Waiting for approval', APPROVED: 'Approved', SCHEDULED: 'Scheduled', PUBLISHING: 'Posting now',
  PUBLISHED: 'Published', SHARED: 'Shared', FAILED: 'Failed', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
}

export const STATUS_CLASSES: Record<string, string> = {
  DRAFT: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-800 border-amber-200',
  APPROVED: 'bg-sky-50 text-sky-800 border-sky-200',
  SCHEDULED: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  PUBLISHING: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  PUBLISHED: 'bg-brand-olive-50 text-brand-olive-700 border-brand-olive-200',
  SHARED: 'bg-brand-olive-50 text-brand-olive-700 border-brand-olive-200',
  FAILED: 'bg-rose-50 text-rose-700 border-rose-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200',
}

export type PostActionName = 'submit' | 'approve' | 'reject' | 'schedule' | 'unschedule' | 'publish' | 'retry' | 'share' | 'cancel'

export interface ActionButton {
  action: PostActionName
  label: string
  tone: 'primary' | 'secondary' | 'danger'
  /** Needs a date and time first. */
  needsDate?: boolean
}

const MAX_ATTEMPTS = 3

/** The buttons to show for a post. The server still decides what is allowed. */
export function availableActions(post: { status: string; channelKind: string; attempts?: number }): ActionButton[] {
  const ch = getChannel(post.channelKind)
  const auto = !!ch && ch.mode === 'api' && ch.capabilities.publish
  switch (post.status) {
    case 'DRAFT':
      return [{ action: 'submit', label: 'Submit for approval', tone: 'primary' }, { action: 'cancel', label: 'Cancel', tone: 'danger' }]
    case 'PENDING_APPROVAL':
      return [{ action: 'approve', label: 'Approve', tone: 'primary' }, { action: 'reject', label: 'Reject', tone: 'danger' }]
    case 'APPROVED': {
      const out: ActionButton[] = []
      if (auto) {
        out.push({ action: 'publish', label: 'Publish now', tone: 'primary' })
        if (ch?.capabilities.schedule) out.push({ action: 'schedule', label: 'Schedule', tone: 'secondary', needsDate: true })
      } else {
        out.push({ action: 'share', label: 'Mark as shared', tone: 'primary' })
      }
      out.push({ action: 'cancel', label: 'Cancel', tone: 'danger' })
      return out
    }
    case 'SCHEDULED':
      return [{ action: 'unschedule', label: 'Unschedule', tone: 'secondary' }, { action: 'cancel', label: 'Cancel', tone: 'danger' }]
    case 'FAILED': {
      const out: ActionButton[] = []
      if (auto && (post.attempts ?? 0) < MAX_ATTEMPTS) out.push({ action: 'retry', label: 'Try again', tone: 'primary' })
      out.push({ action: 'cancel', label: 'Cancel', tone: 'danger' })
      return out
    }
    default:
      return []
  }
}

/** True when the words can still be edited (editing sends it back to a draft). */
export const isEditable = (status: string) => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'REJECTED'].includes(status)

export interface CharCount { count: number; max: number; left: number; over: boolean; near: boolean }
export function charCount(text: string, max: number): CharCount {
  const count = text.length
  return { count, max, left: max - count, over: count > max, near: count <= max && max - count <= Math.max(10, Math.round(max * 0.1)) }
}

/** The words plus the tracking link, for a share bundle. The link is not added twice. */
export function shareCaption(post: { text: string; link: string | null }): string {
  const t = post.text.trim()
  if (!post.link || t.includes(post.link)) return t
  return `${t}\n\n${post.link}`
}

/** Whether a channel is manual ("you post it") or automatic. */
export const modeLabel = (ch: Pick<ChannelDef, 'mode'>) => (ch.mode === 'api' ? 'Automatic' : 'You post it')

// ─── Live status ───────────────────────────────────────────────────────────────

export interface LiveStatus { env: boolean; settings: boolean; connectedChannels: number }

/** Plain reasons live posting is off. Empty when everything allows it. */
export function liveBlockers(live: LiveStatus): string[] {
  const out: string[] = []
  if (!live.env) out.push('The server switch is off (GRACE_MARKETING_LIVE is not "true" on this server).')
  if (!live.settings) out.push('The live switch in Marketing settings is off.')
  if (live.connectedChannels === 0) out.push('No channel is connected yet.')
  return out
}

// ─── Dates ─────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')
/** Local calendar day key, YYYY-MM-DD. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Value for <input type="datetime-local"> in the browser's own time zone. */
export function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return ''
  const x = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(x.getTime())) return ''
  return `${dayKey(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`
}

/** ISO string from a datetime-local value, or null when empty or invalid. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export interface DayPost { id: number; status: string; scheduledFor: string | Date | null; publishedAt: string | Date | null }

/** The next `days` days from `start` (local), each with the posts due (scheduled) or sent (published/shared) that day. */
export function weekBuckets<T extends DayPost>(posts: readonly T[], start: Date, days = 7): { key: string; date: Date; posts: T[] }[] {
  const out = Array.from({ length: days }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return { key: dayKey(date), date, posts: [] as T[] }
  })
  for (const p of posts) {
    const when = p.status === 'PUBLISHED' || p.status === 'SHARED' ? p.publishedAt : p.scheduledFor
    if (!when) continue
    const d = new Date(when)
    if (Number.isNaN(d.getTime())) continue
    out.find((b) => b.key === dayKey(d))?.posts.push(p)
  }
  return out
}

/** Published or shared in the 7 days up to `now`. */
export function publishedThisWeek(posts: readonly DayPost[], now: Date): number {
  const from = now.getTime() - 7 * 86_400_000
  return posts.filter((p) => (p.status === 'PUBLISHED' || p.status === 'SHARED') && p.publishedAt && new Date(p.publishedAt).getTime() >= from && new Date(p.publishedAt).getTime() <= now.getTime()).length
}

/** Manual-channel posts that are approved and waiting to be shared by hand. */
export function shareBundlesReady<T extends { status: string; channelKind: string }>(posts: readonly T[]): T[] {
  return posts.filter((p) => p.status === 'APPROVED' && getChannel(p.channelKind)?.mode === 'manual')
}

export const channelLabel = (kind: string) => getChannel(kind)?.label ?? kind
export const ALL_CHANNELS = CHANNELS

// ─── Money ─────────────────────────────────────────────────────────────────────

/** "12.50" or "$12.50" -> 1250 cents. Empty -> null. Anything else invalid -> undefined. */
export function usdToCents(v: string): number | null | undefined {
  const t = v.trim().replace(/^\$/, '').replace(/,/g, '')
  if (t === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined
  return Math.round(Number(t) * 100)
}

export function centsToUsd(c: number | null | undefined): string {
  return c === null || c === undefined ? '' : (c / 100).toFixed(2)
}

// ─── AI, plan and connect helpers (ZP-1200) ────────────────────────────────────

/** "AI cost: 2¢" / "AI cost: less than 1¢" / "AI cost: $1.20". Null when there is no cost to show. */
export function costText(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents) || cents < 0) return null
  if (cents === 0) return 'AI cost: less than 1¢'
  return cents < 100 ? `AI cost: ${cents}¢` : `AI cost: $${(cents / 100).toFixed(2)}`
}

export interface DraftOutcomeDto { posts: { id: number }[]; failed: { channel: string; reason: string }[]; costCents: number }

/** Plain sentences for the result of "Write with AI". */
export function draftSummary(o: DraftOutcomeDto): { message: string; failures: string[]; cost: string | null } {
  const n = o.posts.length
  const message = n === 0 ? 'The AI did not write any posts.' : `The AI wrote ${n} post${n === 1 ? '' : 's'}. Read them, then submit for approval.`
  return { message, failures: o.failed.map((f) => `${channelLabel(f.channel)}: ${f.reason}`), cost: costText(o.costCents) }
}

/** True when the post can be rewritten by AI (the server allows only these). */
export const canRewrite = (status: string) => status === 'DRAFT' || status === 'REJECTED'

export interface PlanItemDto { postId: number; channelKind: string; mode: 'api' | 'manual'; scheduledFor: string | null; suggestedFor: string | null; day: string | null }

/** Items grouped by the (local) day they fall on, in time order. */
export function groupPlanByDay<T extends PlanItemDto>(items: readonly T[]): { key: string; date: Date; items: T[] }[] {
  const when = (i: T) => i.scheduledFor ?? i.suggestedFor
  const sorted = [...items]
    .filter((i) => when(i) && !Number.isNaN(new Date(when(i)!).getTime()))
    .sort((a, b) => new Date(when(a)!).getTime() - new Date(when(b)!).getTime())
  const out: { key: string; date: Date; items: T[] }[] = []
  for (const i of sorted) {
    const d = new Date(when(i)!)
    const key = dayKey(d)
    const g = out.find((x) => x.key === key)
    if (g) g.items.push(i)
    else out.push({ key, date: d, items: [i] })
  }
  return out
}

/** Body items for /api/marketing/plan/apply: ticked items only, with their proposed (or suggested) time. */
export function planApplyBody(items: readonly PlanItemDto[], unticked: ReadonlySet<number>): { postId: number; scheduledFor: string }[] {
  return items.filter((i) => !unticked.has(i.postId)).flatMap((i) => {
    const t = i.scheduledFor ?? i.suggestedFor
    return t ? [{ postId: i.postId, scheduledFor: t }] : []
  })
}

export interface PlanResultDto { postId: number; result: 'scheduled' | 'suggested' | 'failed'; error?: string }
export function planResultText(r: PlanResultDto): string {
  return r.result === 'scheduled' ? 'Scheduled' : r.result === 'suggested' ? 'Suggested day (you post it by hand)' : `Not scheduled: ${r.error ?? 'unknown problem'}`
}

/** Link that opens new content with a product preselected. */
export const newContentHref = (productId: number) => `/marketing/content/new?productId=${productId}`
/** The preselected product id from a query string, or null. */
export function productIdFromQuery(search: string): number | null {
  const v = new URLSearchParams(search).get('productId')
  const n = v ? Number(v) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

/** "Connected as X, token ends ...1234, connected on 3 Nov 2026 by owner". */
export function connectedAsText(c: { name: string; tokenHint: string | null; connectedAt: string | null; connectedBy?: string | null }): string {
  const parts = [`Connected as ${c.name}`]
  if (c.tokenHint) parts.push(`token ends ...${c.tokenHint}`)
  if (c.connectedAt) {
    const d = new Date(c.connectedAt)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`connected on ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}${c.connectedBy ? ` by ${c.connectedBy}` : ''}`)
    }
  }
  return parts.join(', ')
}

/** Checks the connect form before sending. A plain message, or null when fine. */
export function connectFormError(pageId: string, token: string): string | null {
  if (!/^\d{5,30}$/.test(pageId.trim())) return 'The Page ID is a number (digits only).'
  if (token.trim() === '') return 'Paste the access token.'
  if (/\s/.test(token.trim())) return 'The access token must not contain spaces.'
  return null
}

export const attemptsLeft = (attempts: number | undefined) => Math.max(0, MAX_ATTEMPTS - (attempts ?? 0))
export const viewOnlineLabel = (channelKind: string) => (channelKind === 'INSTAGRAM' ? 'View on Instagram' : channelKind === 'FACEBOOK_PAGE' ? 'View on Facebook' : 'See it online')
