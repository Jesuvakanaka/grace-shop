// VYRA Marketing Manager (ZP-1124, MM-04-AC3/AC4): nothing goes out outside its campaign. Pure.
// A campaign's start and end are calendar days in the shop's time zone, both inclusive:
// a post may go out from 00:00 on the start day until 23:59 on the end day (Harare time).
// Approving on the last day never extends the campaign.
import { SHOP_TIME_ZONE } from '@/lib/storefront/visit-model'

export interface WindowCampaign {
  id: number
  name: string
  status: string
  startsAt: Date | null
  endsAt: Date | null
}

/** Campaign statuses in which nothing may go out. */
export const STOPPED_CAMPAIGN_STATUSES = ['PAUSED', 'ENDED', 'ARCHIVED'] as const

/** The calendar day (YYYY-MM-DD) of an instant in the shop's time zone. */
export function shopDay(d: Date, timeZone: string = SHOP_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** "5 Dec 2026" for the owner. */
export function shopDayLabel(d: Date, timeZone: string = SHOP_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

/** True when the campaign's last day is over (in shop time). A campaign with no end date never expires. */
export function campaignHasEnded(c: Pick<WindowCampaign, 'endsAt'>, now: Date): boolean {
  return !!c.endsAt && shopDay(now) > shopDay(c.endsAt)
}

/**
 * Why nothing of this campaign may go out right now, or null when it may.
 * No campaign (content made outside any campaign) is not restricted here.
 */
export function campaignBlockReason(c: WindowCampaign | null | undefined, now: Date): string | null {
  if (!c) return null
  const name = `"${c.name}"`
  if (c.status === 'ARCHIVED') return `The campaign ${name} is archived, so nothing from it goes out.`
  if (c.status === 'ENDED') return `The campaign ${name} has ended, so nothing from it goes out.`
  if (c.status === 'PAUSED') return `The campaign ${name} is paused. Resume it first.`
  if (c.startsAt && shopDay(now) < shopDay(c.startsAt)) return `The campaign ${name} starts on ${shopDayLabel(c.startsAt)}. Nothing goes out before then.`
  if (c.endsAt && campaignHasEnded(c, now)) return `The campaign ${name} ended on ${shopDayLabel(c.endsAt)}. Nothing goes out after its last day.`
  return null
}
