// ZP-493: abuse limits for POST /api/public/events. In memory, per server
// instance (Cloud Run container), reset on restart: they blunt floods and
// junk, they are not quotas. Keys are an IP bucket (src/lib/storefront/
// rate-limit.ts ipBucket: IPv4, or the IPv6 /64) or a visit id; nothing here
// is ever written to the database or logs. Every map is bounded.
//
// Numbers (docs/storefront/analytics.md, "Limits"): Zimbabwean mobile
// carriers put many phones behind one address (carrier-grade NAT), so the
// per-IP budget is sized for ~30 people browsing the feed at once:
//   - one person scrolling actively: ~0.5 events/s, a full batch = 20 events;
//   - per IP: burst 30 x (20 + 1) = 630 -> 640 tokens, refill 30 x 0.5 = 15/s -> 20/s;
//   - per visit: burst 200, refill 2/s (4x an active person), at most 3,000
//     events per analytics day (a normal visit sends ~50);
//   - new visit ids per IP per hour: 300 (30 people, each a few visits/tabs).
// A request costs 1 token plus 1 per event in it.

export const IP_EVENT_BUDGET = { capacity: 640, refillPerSecond: 20 }
export const VISIT_EVENT_BUDGET = { capacity: 200, refillPerSecond: 2 }
export const VISIT_EVENTS_PER_DAY = 3_000
export const NEW_VISITS_PER_IP_PER_HOUR = 300

const DEFAULT_MAX_KEYS = 20_000

export type BudgetResult = { ok: true } | { ok: false; retryAfterSeconds: number }

/** Delete the oldest entries until there is room (Map order = least recently used first). */
function makeRoom<K, V>(map: Map<K, V>, maxKeys: number) {
  while (map.size >= maxKeys) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

/** Token bucket per key, charged by cost (events), refilled continuously. */
export class EventBudget {
  private readonly buckets = new Map<string, { tokens: number; at: number }>()
  private readonly capacity: number
  private readonly refillPerMs: number
  private readonly maxKeys: number
  private readonly now: () => number

  constructor(options: { capacity: number; refillPerSecond: number; maxKeys?: number; now?: () => number }) {
    this.capacity = options.capacity
    this.refillPerMs = options.refillPerSecond / 1000
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.buckets.size
  }

  /** Spend `cost` tokens if there are enough; otherwise spend nothing. */
  take(key: string, cost: number): BudgetResult {
    const now = this.now()
    let bucket = this.buckets.get(key)
    if (bucket) {
      this.buckets.delete(key)
      bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.at) * this.refillPerMs)
      bucket.at = now
    } else {
      makeRoom(this.buckets, this.maxKeys)
      bucket = { tokens: this.capacity, at: now }
    }
    this.buckets.set(key, bucket)
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost
      return { ok: true }
    }
    const missing = cost - bucket.tokens
    const seconds = this.refillPerMs > 0 ? Math.ceil(missing / this.refillPerMs / 1000) : 3600
    return { ok: false, retryAfterSeconds: Math.max(1, Math.min(3600, seconds)) }
  }
}

/** Count per key per fixed 24 h window (starting at the key's first use). */
export class DailyCounter {
  private readonly counts = new Map<string, { count: number; since: number }>()
  private readonly limit: number
  private readonly maxKeys: number
  private readonly now: () => number

  constructor(options: { limit: number; maxKeys?: number; now?: () => number }) {
    this.limit = options.limit
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS
    this.now = options.now ?? Date.now
  }

  /** Add n if the total stays within the limit; returns whether it was added. */
  add(key: string, n: number): boolean {
    const now = this.now()
    let entry = this.counts.get(key)
    if (entry) this.counts.delete(key)
    if (!entry || now - entry.since >= 24 * 3_600_000) {
      if (!entry) makeRoom(this.counts, this.maxKeys)
      entry = { count: 0, since: now }
    }
    this.counts.set(key, entry)
    if (entry.count + n > this.limit) return false
    entry.count += n
    return true
  }
}

/** At most `perHour` distinct new visit ids per key (IP) per fixed hour window. */
export class NewVisitLimiter {
  private readonly windows = new Map<string, { since: number; ids: Set<string> }>()
  private readonly perHour: number
  private readonly maxKeys: number
  private readonly now: () => number

  constructor(options: { perHour: number; maxKeys?: number; now?: () => number }) {
    this.perHour = options.perHour
    this.maxKeys = options.maxKeys ?? 5_000
    this.now = options.now ?? Date.now
  }

  allow(key: string, visitId: string): boolean {
    const now = this.now()
    let w = this.windows.get(key)
    if (w) this.windows.delete(key)
    if (!w || now - w.since >= 3_600_000) {
      if (!w) makeRoom(this.windows, this.maxKeys)
      w = { since: now, ids: new Set() }
    }
    this.windows.set(key, w)
    if (w.ids.has(visitId)) return true
    if (w.ids.size >= this.perHour) return false
    w.ids.add(visitId)
    return true
  }
}
