// VYRA Marketing hub (ZP-1200): propose when each approved post should go out this week.
// Pure code (reads, never writes). Times are Harare (UTC+2, no daylight saving). Server only.
import type { MarketingSettings } from '@prisma/client'
import type { Db } from '../audit'
import { getChannel } from '../channels'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const HARARE_OFFSET_HOURS = 2
export const FALLBACK_HOURS = [12, 19]
/** The same channel is never posted twice within this many hours. */
export const MIN_GAP_HOURS = 3
const OTHER_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]

export interface PlanItem {
  postId: number
  channelKind: string
  mode: 'api' | 'manual'
  /** API channels: the proposed time. Apply it with POST /api/marketing/plan/apply. */
  scheduledFor: string | null
  /** Manual channels: only a suggested day and time; nothing is stored for them. */
  suggestedFor: string | null
  /** Harare day, YYYY-MM-DD. */
  day: string | null
}
export interface Plan {
  weekStart: string
  bestHours: number[]
  items: PlanItem[]
  /** Posts that did not fit (weekly target reached or no free slot). */
  unplaced: number[]
}

/** 00:00 Harare of the Harare day that contains `d`, as a UTC instant. */
export function hararedayStart(d: Date): Date {
  const shifted = new Date(d.getTime() + HARARE_OFFSET_HOURS * HOUR_MS)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - HARARE_OFFSET_HOURS * HOUR_MS)
}
const dayLabel = (instant: Date) => new Date(instant.getTime() + HARARE_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10)

/** The busiest visit hours (Harare) of the last 8 weeks; 12:00 and 19:00 when there is no data. */
export async function bestHours(db: Db, now: Date, count = 3): Promise<number[]> {
  const rows = await db.analyticsDailyHour.groupBy({
    by: ['hour'],
    where: { day: { gte: new Date(now.getTime() - 56 * DAY_MS) } },
    _sum: { visits: true },
  })
  const ranked = rows
    .map((r) => ({ hour: r.hour, visits: r._sum.visits ?? 0 }))
    .filter((r) => r.visits > 0 && r.hour >= 7 && r.hour <= 22)
    .sort((a, b) => b.visits - a.visits || a.hour - b.hour)
    .slice(0, count)
    .map((r) => r.hour)
  return ranked.length >= 2 ? ranked.sort((a, b) => a - b) : FALLBACK_HOURS
}

export async function planWeek(db: Db, input: { start: Date; settings: Pick<MarketingSettings, 'weeklyPostTarget'>; now?: Date }): Promise<Plan> {
  const now = input.now ?? new Date()
  const weekStart = hararedayStart(input.start)
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS)
  const hours = await bestHours(db, now)

  const posts = await db.marketingPost.findMany({ where: { status: 'APPROVED', scheduledFor: null }, orderBy: { id: 'asc' }, take: 200 })
  const already = await db.marketingPost.findMany({
    where: { status: { in: ['SCHEDULED', 'PUBLISHING', 'PUBLISHED'] }, OR: [{ scheduledFor: { gte: weekStart, lt: weekEnd } }, { publishedAt: { gte: weekStart, lt: weekEnd } }] },
    select: { channelKind: true, scheduledFor: true, publishedAt: true },
  })
  // Instants already taken, per channel and per day (for spacing and spreading).
  const taken = new Map<string, number[]>()
  const perDay = new Array<number>(7).fill(0)
  const take = (kind: string, t: Date) => {
    taken.set(kind, [...(taken.get(kind) ?? []), t.getTime()])
    const i = Math.floor((t.getTime() - weekStart.getTime()) / DAY_MS)
    if (i >= 0 && i < 7) perDay[i]++
  }
  for (const a of already) {
    const t = a.scheduledFor ?? a.publishedAt
    if (t) take(a.channelKind, t)
  }

  let room = Math.max(0, input.settings.weeklyPostTarget - already.length)
  const items: PlanItem[] = []
  const unplaced: number[] = []
  const free = (kind: string, t: number) => (taken.get(kind) ?? []).every((x) => Math.abs(x - t) >= MIN_GAP_HOURS * HOUR_MS)

  for (const post of posts) {
    const ch = getChannel(post.channelKind)
    if (!ch || room <= 0) {
      unplaced.push(post.id)
      continue
    }
    let best = null as { t: number; day: number } | null
    for (const pool of [hours, OTHER_HOURS.filter((h) => !hours.includes(h))]) {
      for (let day = 0; day < 7; day++) {
        for (const h of pool) {
          const t = weekStart.getTime() + day * DAY_MS + h * HOUR_MS
          if (t <= now.getTime() || !free(post.channelKind, t)) continue
          if (!best || perDay[day] < perDay[best.day] || (perDay[day] === perDay[best.day] && t < best.t)) best = { t, day }
        }
      }
      if (best) break
    }
    if (!best) {
      unplaced.push(post.id)
      continue
    }
    const when = new Date(best.t)
    take(post.channelKind, when)
    room--
    const api = ch.mode === 'api' && ch.capabilities.publish && ch.capabilities.schedule
    items.push({
      postId: post.id,
      channelKind: post.channelKind,
      mode: api ? 'api' : 'manual',
      scheduledFor: api ? when.toISOString() : null,
      suggestedFor: api ? null : when.toISOString(),
      day: dayLabel(when),
    })
  }
  items.sort((a, b) => (a.scheduledFor ?? a.suggestedFor ?? '').localeCompare(b.scheduledFor ?? b.suggestedFor ?? ''))
  return { weekStart: weekStart.toISOString(), bestHours: hours, items, unplaced }
}
