// ZP-507: "Love it" hearts, pure parts. Safe on the client and the server.
// Tested in tests/loves.test.ts. See docs/storefront/hearts.md.
import { isUuidV4 } from '@/lib/analytics/events'
import { isValidSlug } from '@/lib/storefront-model/slug'

export const LOVES_ENDPOINT = '/api/public/loves'
/** localStorage: the slugs this phone loves (JSON array, most recent last). */
export const LOVES_STORAGE_KEY = 'vyra:loves'
/** Under this many loves no number is shown ("Love" / "Love it", never "Loved by 1"). */
export const LOVE_COUNT_MIN_SHOWN = 3
/** The phone remembers at most this many loved pieces (the oldest are forgotten). */
export const LOVED_MAX_STORED = 500

export type LoveRequest = { slug: string; on: boolean; device: string }

const REQUEST_KEYS = new Set(['slug', 'on', 'device'])

/** The request body: exactly { slug, on, device } (device: the analytics device id, a UUID v4). */
export function parseLoveRequest(body: unknown): { ok: true; value: LoveRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Expected an object' }
  const raw = body as Record<string, unknown>
  if (Object.keys(raw).some((k) => !REQUEST_KEYS.has(k))) return { ok: false, error: 'Unknown field' }
  if (!isValidSlug(raw.slug)) return { ok: false, error: 'Bad slug' }
  if (typeof raw.on !== 'boolean') return { ok: false, error: 'Bad on' }
  const device = typeof raw.device === 'string' ? raw.device.toLowerCase() : null
  if (!isUuidV4(device)) return { ok: false, error: 'Bad device' }
  return { ok: true, value: { slug: raw.slug, on: raw.on, device } }
}

/**
 * The count to show: the (cached, up to a minute old) server count plus what
 * this phone changed since the page loaded. Never below 0.
 */
export function displayLoves(server: number | null | undefined, lovedNow: boolean, lovedAtLoad: boolean): number {
  const base = typeof server === 'number' && Number.isFinite(server) ? Math.max(0, Math.floor(server)) : 0
  return Math.max(0, base + (lovedNow ? 1 : 0) - (lovedAtLoad ? 1 : 0))
}

const formatCount = (n: number) => new Intl.NumberFormat('en-US').format(n)

/** Under the heart on the feed rail: "Love", or the number from 3. */
export function feedLoveText(loves: number): string {
  return loves >= LOVE_COUNT_MIN_SHOWN ? formatCount(loves) : 'Love'
}

/** The product page pill: "Love it", or "Loved by 24" from 3. */
export function productLoveText(loves: number): string {
  return loves >= LOVE_COUNT_MIN_SHOWN ? `Loved by ${formatCount(loves)}` : 'Love it'
}

/**
 * The heart button's accessible name. It contains the visible text (WCAG
 * 2.5.3 label in name): "Love <name>" (rail, "Love" shown), "Love it, <name>"
 * (pill, "Love it" shown), and from 3 loves "Love <name>, loved by 24"
 * (rail "24", pill "Loved by 24"). aria-pressed says whether it is loved.
 */
export function loveButtonLabel(variant: 'rail' | 'pill', name: string, loves: number): string {
  if (loves >= LOVE_COUNT_MIN_SHOWN) return `Love ${name}, loved by ${formatCount(loves)}`
  return variant === 'pill' ? `Love it, ${name}` : `Love ${name}`
}

/** The stored list: valid slugs, unique, in order; anything else is an empty list. */
export function parseLovedSlugs(raw: string | null | undefined): string[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  for (const v of parsed) if (isValidSlug(v)) seen.add(v)
  return [...seen].slice(-LOVED_MAX_STORED)
}

export function serializeLovedSlugs(slugs: Iterable<string>): string {
  return JSON.stringify([...slugs].slice(-LOVED_MAX_STORED))
}

/** Add (as the most recent) or remove a slug. Returns a new list. */
export function withLoved(slugs: readonly string[], slug: string, on: boolean): string[] {
  const rest = slugs.filter((s) => s !== slug)
  return on ? [...rest, slug].slice(-LOVED_MAX_STORED) : rest
}
