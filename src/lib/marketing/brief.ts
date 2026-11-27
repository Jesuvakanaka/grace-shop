// VYRA Marketing hub: the structured brief behind every piece of content. Pure.
// A brief names one job, one reader, one message, the proof, a TRUE reason to act now
// (worked out here from shop data, never by the AI) and one action.
import { NEW_ARRIVAL_DAYS } from '@/lib/storefront-model/rules'
import { SHOP_TIME_ZONE } from '@/lib/storefront/visit-model'

export const JOBS = ['GET_SEEN', 'EARN_TRUST', 'GET_PERMISSION', 'OFFER_CLOSE', 'KEEP'] as const
export type Job = (typeof JOBS)[number]

/** Owner-facing names. */
export const JOB_LABEL: Record<Job, string> = {
  GET_SEEN: 'Get seen',
  EARN_TRUST: 'Earn trust',
  GET_PERMISSION: 'Get permission',
  OFFER_CLOSE: 'Offer and close',
  KEEP: 'Keep customers',
}

/** One line under the choice, so the owner knows what each job is for. */
export const JOB_HINT: Record<Job, string> = {
  GET_SEEN: 'For people who do not know the shop yet. Earns attention, sells nothing.',
  EARN_TRUST: 'For people who have noticed the shop. Shows proof and answers a doubt.',
  GET_PERMISSION: 'Invites people to join your contact list.',
  OFFER_CLOSE: 'For people ready to buy. Makes the offer and asks for the order.',
  KEEP: 'For people who have bought. Thanks them and asks for one small thing.',
}

/** The names the writer prompt uses. */
export const JOB_PROMPT: Record<Job, string> = {
  GET_SEEN: 'GET SEEN',
  EARN_TRUST: 'EARN TRUST',
  GET_PERMISSION: 'GET PERMISSION',
  OFFER_CLOSE: 'OFFER AND CLOSE',
  KEEP: 'KEEP CUSTOMERS',
}

export const ACTION_CHOICES = [
  'Follow us, or save or share this post',
  'Look at the product',
  'Ask us a question',
  'Join our list',
  'Order now',
  'Message us to order',
  'Leave a review',
] as const

export const DEFAULT_ACTION: Record<Job, string> = {
  GET_SEEN: 'Follow us, or save or share this post',
  EARN_TRUST: 'Look at the product',
  GET_PERMISSION: 'Join our list',
  OFFER_CLOSE: 'Message us to order',
  KEEP: 'Leave a review',
}

export const isJob = (v: unknown): v is Job => typeof v === 'string' && (JOBS as readonly string[]).includes(v)

export const URGENCY_KINDS = ['NONE', 'NEW_IN', 'FEW_LEFT', 'PREORDER', 'CAMPAIGN_ENDS', 'OWN'] as const
export type UrgencyKind = (typeof URGENCY_KINDS)[number]

export interface UrgencyOption {
  kind: UrgencyKind
  /** What the owner sees in the list. */
  label: string
  /** The exact true sentence handed to the writer; null for NONE and OWN. */
  text: string | null
}

export interface UrgencyProduct {
  published: boolean
  publishedAt: Date | null
  currentQuantity: number
  listingType: string
  preorderShipFrom: Date | null
}
export interface UrgencyCampaign {
  name: string
  endsAt: Date | null
}

const DAY_MS = 86_400_000
/** Stock at or under this counts as "few left". */
export const FEW_LEFT_MAX = 3
/** A campaign end further away than this is not a reason to act now. */
export const CAMPAIGN_END_DAYS = 21

const longDate = (d: Date) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: SHOP_TIME_ZONE }).format(d)
/** preorderShipFrom is a calendar date (stored at UTC midnight): print it without shifting the day. */
const calendarDate = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d)

/**
 * The reasons to act now that are TRUE at this moment. "None" and "My own reason" are always
 * offered; the others only when the shop's own data backs them.
 */
export function urgencyOptions(product: UrgencyProduct | null, campaign: UrgencyCampaign | null, now: Date = new Date()): UrgencyOption[] {
  const out: UrgencyOption[] = [{ kind: 'NONE', label: 'None', text: null }]
  if (product) {
    if (product.published && product.publishedAt) {
      const age = (now.getTime() - product.publishedAt.getTime()) / DAY_MS
      if (age >= 0 && age <= 7) out.push({ kind: 'NEW_IN', label: 'New in this week', text: 'New in this week.' })
      else if (age > 7 && age <= NEW_ARRIVAL_DAYS) out.push({ kind: 'NEW_IN', label: 'New in', text: 'A new arrival.' })
    }
    if (product.listingType === 'PRE_ORDER') {
      const ship = product.preorderShipFrom
      if (ship && ship.getTime() >= now.getTime() - DAY_MS) {
        const t = `On pre-order now, shipping from ${calendarDate(ship)}.`
        out.push({ kind: 'PREORDER', label: t.replace(/\.$/, ''), text: t })
      }
    } else if (product.currentQuantity >= 1 && product.currentQuantity <= FEW_LEFT_MAX) {
      const t = `Only ${product.currentQuantity} left in stock.`
      out.push({ kind: 'FEW_LEFT', label: t.replace(/\.$/, ''), text: t })
    }
  }
  if (campaign?.endsAt) {
    const left = (campaign.endsAt.getTime() - now.getTime()) / DAY_MS
    if (left > 0 && left <= CAMPAIGN_END_DAYS) {
      const t = `${campaign.name} ends on ${longDate(campaign.endsAt)}.`
      out.push({ kind: 'CAMPAIGN_ENDS', label: t.replace(/\.$/, ''), text: t })
    }
  }
  out.push({ kind: 'OWN', label: 'My own reason (I will type it)', text: null })
  return out
}

/**
 * The sentence the writer may use, or null for "write no urgency".
 * `stale` is true when the owner chose a reason that is no longer true: it is dropped, not sent.
 */
export function resolveUrgency(kind: string | null | undefined, ownText: string | null | undefined, options: readonly UrgencyOption[]): { text: string | null; stale: boolean } {
  if (!kind || kind === 'NONE') return { text: null, stale: false }
  if (kind === 'OWN') {
    const t = ownText?.trim()
    return { text: t ? t : null, stale: false }
  }
  const o = options.find((x) => x.kind === kind)
  return o?.text ? { text: o.text, stale: false } : { text: null, stale: true }
}

export interface BriefPlan {
  job: Job
  /** "who, in what moment"; null lets the writer pick the likeliest buyer from the facts. */
  reader: string | null
  message: string | null
  proof: string | null
  /** A true sentence, or null for none. */
  urgency: string | null
  action: string
}

/** Content made before the brief existed has no job: it is treated as an offer with the owner's words as the message. */
export function planFromContent(
  c: { job?: string | null; reader?: string | null; message?: string | null; proof?: string | null; action?: string | null },
  urgency: string | null,
  fallback: { reader?: string | null; message?: string | null } = {},
): BriefPlan {
  const job: Job = isJob(c.job) ? c.job : 'OFFER_CLOSE'
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
  return {
    job,
    reader: clean(c.reader) ?? clean(fallback.reader),
    message: clean(c.message) ?? clean(fallback.message),
    proof: clean(c.proof),
    urgency,
    action: clean(c.action) ?? DEFAULT_ACTION[job],
  }
}
