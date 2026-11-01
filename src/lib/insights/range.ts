// ZP-505: date ranges of the Insights page. Pure.
// Days are analytics days in Africa/Harare ("YYYY-MM-DD"), like the rollups.
// Presets end TODAY and include it: "7 days" = today and the 6 days before.
import { addDays, analyticsDay, dayToDate, isDay } from '@/lib/analytics/events'
import { ROLLUP_RETENTION_MONTHS } from '@/lib/analytics/rollup'

export const INSIGHTS_PRESETS = ['today', '7d', '30d', 'custom'] as const
export type InsightsPreset = (typeof INSIGHTS_PRESETS)[number]

export type InsightsRange = { preset: InsightsPreset; from: string; to: string; days: number }

/** The longest range a custom choice may span (a year and a bit). */
export const MAX_RANGE_DAYS = 400
/** Rollups are kept 25 months: older days have no data at all. */
export const OLDEST_DAY_OFFSET = Math.ceil(ROLLUP_RETENTION_MONTHS * 30.5)

const PRESET_DAYS: Record<Exclude<InsightsPreset, 'custom'>, number> = { today: 1, '7d': 7, '30d': 30 }

export function daysBetween(from: string, to: string): number {
  return Math.round((dayToDate(to).getTime() - dayToDate(from).getTime()) / 86_400_000) + 1
}

export type RangeResult = { ok: true; range: InsightsRange } | { ok: false; error: string }

/** `?range=today|7d|30d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD` (default 7d). */
export function parseInsightsRange(params: URLSearchParams, now: Date = new Date()): RangeResult {
  const today = analyticsDay(now)
  const preset = params.get('range') ?? '7d'
  if (preset === 'today' || preset === '7d' || preset === '30d') {
    const days = PRESET_DAYS[preset]
    return { ok: true, range: { preset, from: addDays(today, -(days - 1)), to: today, days } }
  }
  if (preset !== 'custom') return { ok: false, error: 'range must be today, 7d, 30d or custom' }
  const from = params.get('from')
  const to = params.get('to')
  if (!isDay(from) || !isDay(to)) return { ok: false, error: 'A custom range needs from and to dates (YYYY-MM-DD)' }
  if (from > to) return { ok: false, error: 'The start date is after the end date' }
  if (to > today) return { ok: false, error: 'The end date is in the future' }
  if (from < addDays(today, -OLDEST_DAY_OFFSET)) {
    return { ok: false, error: `Insights keep ${ROLLUP_RETENTION_MONTHS} months; choose a later start date` }
  }
  const days = daysBetween(from, to)
  if (days > MAX_RANGE_DAYS) return { ok: false, error: `Choose at most ${MAX_RANGE_DAYS} days` }
  return { ok: true, range: { preset: 'custom', from, to, days } }
}

/** Every day of the range, oldest first. */
export function rangeDays(range: Pick<InsightsRange, 'from' | 'to'>): string[] {
  const out: string[] = []
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d)
  return out
}
