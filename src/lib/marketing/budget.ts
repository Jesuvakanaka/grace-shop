// VYRA Marketing hub (ZP-1200): the ad spend cap. Rule 2: never create or raise a budget that would
// push a month's committed spend above MarketingSettings.monthlySpendCapCents (0 = no spend possible).
// Months and days are Harare calendar months and days (Africa/Harare is UTC+2 all year, no daylight saving).
//
// committed(month) = for every ad that is ACTIVE, PAUSED_ON_PLATFORM, APPROVED or CREATING:
//                      daily budget x the days of that month still to come within startsAt..endsAt
//                  + the spend already recorded for that month (MarketingMetric rows of ads).
// Today counts as a full day AND today's recorded spend counts too: slightly pessimistic on purpose.
import { WebsiteError } from '@/lib/website/http'
import type { Db } from './audit'

export const HARARE_OFFSET_MS = 2 * 3_600_000
const DAY_MS = 86_400_000

/** Ad statuses whose daily budget is committed (money that may be spent). */
export const COMMITTING_STATUSES = ['ACTIVE', 'PAUSED_ON_PLATFORM', 'APPROVED', 'CREATING'] as const

export interface BudgetAd {
  status?: string
  dailyBudgetCents: number
  startsAt: Date
  endsAt: Date | null
}

/** Days since 1970-01-01 of the Harare calendar day containing `d`. */
export function harareDayIndex(d: Date): number {
  return Math.floor((d.getTime() + HARARE_OFFSET_MS) / DAY_MS)
}

/** First Harare day of the month containing `d`, and the first day of the next month (both as day indexes). */
export function harareMonthDays(d: Date): { first: number; nextFirst: number; label: string } {
  const x = new Date(d.getTime() + HARARE_OFFSET_MS)
  const y = x.getUTCFullYear()
  const m = x.getUTCMonth()
  return {
    first: Date.UTC(y, m, 1) / DAY_MS,
    nextFirst: Date.UTC(y, m + 1, 1) / DAY_MS,
    label: `${y}-${String(m + 1).padStart(2, '0')}`,
  }
}

/** The UTC-midnight Dates matching `@db.Date` for the first day of the month and of the next month. */
export function monthDateBounds(d: Date): { start: Date; end: Date; label: string } {
  const { first, nextFirst, label } = harareMonthDays(d)
  return { start: new Date(first * DAY_MS), end: new Date(nextFirst * DAY_MS), label }
}

/** How many Harare days of `month` (any instant in it) the ad can still run: from today or startsAt to endsAt. */
export function remainingDaysInMonth(ad: Pick<BudgetAd, 'startsAt' | 'endsAt'>, now: Date, month: Date = now): number {
  const { first, nextFirst } = harareMonthDays(month)
  const from = Math.max(harareDayIndex(now), harareDayIndex(ad.startsAt), first)
  // An end time of exactly midnight does not include that day.
  const lastDay = ad.endsAt ? harareDayIndex(new Date(ad.endsAt.getTime() - 1)) : Number.POSITIVE_INFINITY
  const to = Math.min(nextFirst, lastDay + 1)
  return Math.max(0, to - from)
}

/** What the ad can still spend in `month`, in cents. */
export function adCommitmentCents(ad: BudgetAd, now: Date, month: Date = now): number {
  if (!Number.isFinite(ad.dailyBudgetCents) || ad.dailyBudgetCents <= 0) return 0
  return ad.dailyBudgetCents * remainingDaysInMonth(ad, now, month)
}

/** Pure: committed spend of a month from ad rows and the spend already recorded in that month. */
export function computeCommittedCents(input: { ads: BudgetAd[]; recordedSpendCents: number; now: Date; month?: Date }): number {
  const month = input.month ?? input.now
  const committing = new Set<string>(COMMITTING_STATUSES)
  const ads = input.ads.filter((a) => a.status !== undefined && committing.has(a.status))
  return ads.reduce((sum, a) => sum + adCommitmentCents(a, input.now, month), 0) + Math.max(0, input.recordedSpendCents)
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

export interface CapProposal {
  dailyBudgetCents: number
  startsAt: Date
  endsAt: Date | null
}

/**
 * Pure. Throws a plain 409 when `committedCents` (everything committed in that month EXCLUDING the ad
 * being created or changed) plus this ad's own commitment would exceed the cap.
 * A cap of 0 (or less) means no spend is possible at all, for any month.
 */
export function assertWithinCap(
  settings: { monthlySpendCapCents: number } | null | undefined,
  proposed: CapProposal,
  committedCents: number,
  now: Date = new Date(),
  month: Date = now,
): void {
  const cap = settings?.monthlySpendCapCents ?? 0
  if (proposed.dailyBudgetCents <= 0) return // spends nothing
  if (!(cap > 0)) {
    throw new WebsiteError(409, 'No ad spend is allowed yet: set a monthly spend cap in the marketing settings first.', { blocked: 'cap' })
  }
  const own = adCommitmentCents(proposed, now, month)
  if (committedCents + own > cap) {
    const left = Math.max(0, cap - committedCents)
    throw new WebsiteError(
      409,
      `This ad would commit ${dollars(own)} in ${harareMonthDays(month).label}, but only ${dollars(left)} is left of the ${dollars(cap)} monthly cap (${dollars(committedCents)} is already committed). Lower the daily budget, shorten the ad, or raise the cap in the settings.`,
      { blocked: 'cap', capCents: cap, committedCents, wantedCents: own },
    )
  }
}

/** Committed spend of the month containing `month`. `excludeAdId` leaves out that ad's commitment (not its recorded spend). */
export async function committedSpendCents(db: Db, now: Date = new Date(), opts: { month?: Date; excludeAdId?: number } = {}): Promise<number> {
  const month = opts.month ?? now
  const ads = await db.marketingAd.findMany({
    where: { status: { in: [...COMMITTING_STATUSES] }, ...(opts.excludeAdId ? { id: { not: opts.excludeAdId } } : {}) },
    select: { status: true, dailyBudgetCents: true, startsAt: true, endsAt: true },
  })
  const { start, end } = monthDateBounds(month)
  const recorded = await db.marketingMetric.aggregate({
    where: { entity: 'AD', day: { gte: start, lt: end } },
    _sum: { spendCents: true },
  })
  return computeCommittedCents({ ads, recordedSpendCents: recorded._sum.spendCents ?? 0, now, month })
}

/** One instant (midday of the 1st) per month an ad can spend in: the current month through the end month, at most 12. */
export function monthsToCheck(ad: Pick<BudgetAd, 'startsAt' | 'endsAt'>, now: Date): Date[] {
  const out: Date[] = []
  let cursorFirst = harareMonthDays(now).first
  const endDay = ad.endsAt ? harareDayIndex(new Date(ad.endsAt.getTime() - 1)) : null
  for (let i = 0; i < 12; i++) {
    if (endDay !== null && cursorFirst > endDay) break
    const m = new Date(cursorFirst * DAY_MS - HARARE_OFFSET_MS + 12 * 3_600_000)
    if (i === 0 || remainingDaysInMonth(ad, now, m) > 0) out.push(m)
    cursorFirst = harareMonthDays(m).nextFirst
    if (endDay === null && i >= 1) break // open-ended: the current and the next month are checked
  }
  return out
}

/** Check a new ad or a change against the cap for every month it can spend in. Throws a plain 409. */
export async function checkAdCap(
  db: Db,
  settings: { monthlySpendCapCents: number } | null | undefined,
  proposed: CapProposal & { id?: number },
  now: Date = new Date(),
): Promise<void> {
  if (proposed.dailyBudgetCents <= 0) return
  if (!((settings?.monthlySpendCapCents ?? 0) > 0)) assertWithinCap(settings, proposed, 0, now) // throws "no spend allowed"
  for (const month of monthsToCheck(proposed, now)) {
    const committed = await committedSpendCents(db, now, { month, excludeAdId: proposed.id })
    assertWithinCap(settings, proposed, committed, now, month)
  }
}

export interface BudgetSummary {
  month: string
  capCents: number
  committedCents: number
  remainingCents: number
  recordedSpendCents: number
}

export async function budgetSummary(db: Db, settings: { monthlySpendCapCents: number }, now: Date = new Date()): Promise<BudgetSummary> {
  const committedCents = await committedSpendCents(db, now)
  const { start, end, label } = monthDateBounds(now)
  const recorded = await db.marketingMetric.aggregate({ where: { entity: 'AD', day: { gte: start, lt: end } }, _sum: { spendCents: true } })
  const capCents = Math.max(0, settings.monthlySpendCapCents)
  return { month: label, capCents, committedCents, remainingCents: Math.max(0, capCents - committedCents), recordedSpendCents: recorded._sum.spendCents ?? 0 }
}
