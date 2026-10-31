// In-memory token bucket per key (ZP-484). Best effort: each server instance
// (Cloud Run container) has its own buckets, and they reset on restart. It
// only blunts scraping of GET /api/public/products; it is not a quota.

export type TakeResult = { ok: true } | { ok: false; retryAfterSeconds: number }

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>()
  private readonly capacity: number
  private readonly refillPerMs: number
  private readonly maxKeys: number
  private readonly now: () => number

  constructor(options: { capacity: number; refillPerSecond: number; maxKeys?: number; now?: () => number }) {
    this.capacity = options.capacity
    this.refillPerMs = options.refillPerSecond / 1000
    this.maxKeys = options.maxKeys ?? 10_000
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.buckets.size
  }

  take(key: string): TakeResult {
    const now = this.now()
    let bucket = this.buckets.get(key)
    if (bucket) {
      this.buckets.delete(key) // re-insert below: Map order = least recently used first
      bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.at) * this.refillPerMs)
      bucket.at = now
    } else {
      bucket = { tokens: this.capacity, at: now }
      while (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value
        if (oldest === undefined) break
        this.buckets.delete(oldest)
      }
    }
    this.buckets.set(key, bucket)
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return { ok: true }
    }
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / this.refillPerMs / 1000)) }
  }
}

/**
 * Client key from X-Forwarded-For. Cloud Run appends the real client address
 * as the LAST entry (earlier entries are whatever the client sent), so the
 * last entry is used. Behind an extra load balancer this would be the
 * balancer's address; revisit then.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  const last = forwarded?.split(',').map((s) => s.trim()).filter(Boolean).pop()
  return (last ?? headers.get('x-real-ip') ?? 'unknown').slice(0, 64)
}
