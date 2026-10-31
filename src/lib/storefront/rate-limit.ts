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
 * last entry is used.
 *
 * Load-balancer caveat: behind an external HTTP(S) load balancer the last
 * entry is the balancer's address, so every client would share one bucket.
 * If one is added, take the entry the balancer appends for the client
 * (second from last) instead.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  const last = forwarded?.split(',').map((s) => s.trim()).filter(Boolean).pop()
  const raw = last ?? headers.get('x-real-ip')
  return raw ? ipBucket(raw) : 'unknown'
}

/**
 * Rate-limit bucket for an address: IPv4 as is; IPv6 by its /64 prefix
 * ("2001:db8:1:2::/64"), because one subscriber usually has a whole /64 and
 * could otherwise rotate addresses to get fresh buckets; IPv4-mapped IPv6
 * as the IPv4 address. Anything unparsable is used as is (max 64 chars).
 */
export function ipBucket(address: string): string {
  let s = address.trim().toLowerCase()
  if (s.startsWith('[')) {
    const end = s.indexOf(']')
    s = end > 0 ? s.slice(1, end) : s.slice(1)
  }
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(s)
  if (v4WithPort) return v4WithPort[1]
  s = s.replace(/%.*$/, '') // zone id
  const groups = s.includes(':') ? expandIpv6(s) : null
  if (!groups) return s.slice(0, 64)
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.')
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`
}

/** Eight 16-bit groups, or null when it is not an IPv6 address. */
function expandIpv6(input: string): number[] | null {
  let s = input
  let tail: number[] = []
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (v4) {
    const b = v4.slice(1).map(Number)
    if (b.some((n) => n > 255)) return null
    tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]]
    s = s.slice(0, -v4[0].length)
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) =>
    part === '' ? [] : part.split(':').map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN))
  const head = parse(halves[0])
  const rest = halves.length === 2 ? parse(halves[1]) : []
  if ([...head, ...rest].some(Number.isNaN)) return null
  const missing = 8 - tail.length - head.length - rest.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  return [...head, ...new Array<number>(halves.length === 2 ? missing : 0).fill(0), ...rest, ...tail]
}
