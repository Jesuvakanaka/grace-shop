// ZP-493: POST /api/public/events, the collection endpoint. Server only.
//
// Order of checks (cheapest and most protective first):
//   1. Same origin: Origin must match Host, Sec-Fetch-Site (when sent) must be
//      same-origin                                               -> 403
//   2. GPC / DNT, bots, headless browsers: nothing is stored      -> 204
//   3. Rate limit per IP (in memory; the IP is never stored)       -> 429
//   4. Content type text/plain (sendBeacon) or application/json    -> 415
//   5. Body at most MAX_BODY_BYTES                                 -> 413
//   6. JSON + strict schema (./events.ts), at most 50 events       -> 400
//   7. Rate limit per visit id                                     -> 429
//   8. Slugs must be published pieces; other events are dropped    -> 204
// Responses carry no body and Cache-Control: no-store.
import type { PrismaClient } from '@prisma/client'
import prisma from '@/lib/db'
import { PUBLIC_PRODUCT_WHERE } from '@/lib/storefront/queries'
import { TokenBucketLimiter, clientKey } from '@/lib/storefront/rate-limit'
import { analyticsDay, dayToDate, validateBatch } from './events'
import { isBotRequest, isOptedOutRequest } from './privacy'

/** 50 events of the largest kind are about 12 KB; 32 KB leaves room and stops junk. */
export const MAX_BODY_BYTES = 32 * 1024

/**
 * Per IP: 120 requests burst, 2 per second after. Generous on purpose:
 * mobile carriers put many phones behind one address. A normal visit sends
 * about one request every 10 s.
 */
export const IP_LIMIT = { capacity: 120, refillPerSecond: 2 }
/** Per visit: 30 requests burst, then one every 5 s (the client flushes at most every 10 s unless 20 events queue up). */
export const VISIT_LIMIT = { capacity: 30, refillPerSecond: 0.2 }

type Db = Pick<PrismaClient, 'product' | 'analyticsEvent'>

export type EventsHandlerOptions = {
  db?: Db
  ipLimiter?: TokenBucketLimiter
  visitLimiter?: TokenBucketLimiter
  now?: () => Date
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...NO_STORE, ...extra } })
}

/** Origin's host[:port] must equal the Host header; Sec-Fetch-Site, when present, must be same-origin. */
export function isSameOrigin(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') return false
  const origin = headers.get('origin')
  const host = headers.get('host')
  if (!origin || origin === 'null' || !host) return false
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    return url.host.toLowerCase() === host.trim().toLowerCase()
  } catch {
    return false
  }
}

function contentTypeOk(value: string | null): boolean {
  const type = (value ?? '').split(';')[0].trim().toLowerCase()
  return type === 'text/plain' || type === 'application/json'
}

/** Read at most `max` bytes; null when the body is larger. */
async function readLimited(request: Request, max: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    all.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all)
}

export function createEventsHandler(options: EventsHandlerOptions = {}) {
  const db = options.db ?? prisma
  const ipLimiter = options.ipLimiter ?? new TokenBucketLimiter(IP_LIMIT)
  const visitLimiter = options.visitLimiter ?? new TokenBucketLimiter(VISIT_LIMIT)
  const now = options.now ?? (() => new Date())

  return async function handleEvents(request: Request): Promise<Response> {
    const headers = request.headers
    if (!isSameOrigin(headers)) return empty(403)
    if (isOptedOutRequest(headers) || isBotRequest(headers)) return empty(204)

    const ipLimit = ipLimiter.take(clientKey(headers))
    if (!ipLimit.ok) return empty(429, { 'Retry-After': String(ipLimit.retryAfterSeconds) })

    if (!contentTypeOk(headers.get('content-type'))) return empty(415)
    const declared = Number(headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return empty(413)
    let raw: string | null
    try {
      raw = await readLimited(request, MAX_BODY_BYTES)
    } catch {
      return empty(400)
    }
    if (raw === null) return empty(413)

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return empty(400)
    }
    const receivedAt = now()
    const batch = validateBatch(parsed, receivedAt)
    if (!batch.ok) {
      return new Response(JSON.stringify({ error: batch.error }), {
        status: 400,
        headers: { ...NO_STORE, 'Content-Type': 'application/json' },
      })
    }

    const visitLimit = visitLimiter.take(batch.visitId)
    if (!visitLimit.ok) return empty(429, { 'Retry-After': String(visitLimit.retryAfterSeconds) })

    try {
      const slugs = [...new Set(batch.events.map((e) => e.slug).filter((s): s is string => s !== null))]
      const pieces = slugs.length
        ? await db.product.findMany({ where: { ...PUBLIC_PRODUCT_WHERE, slug: { in: slugs } }, select: { id: true, slug: true } })
        : []
      const productIds = new Map(pieces.map((p) => [p.slug as string, p.id]))

      const data = batch.events
        .filter((e) => e.slug === null || productIds.has(e.slug))
        .map((e) => ({
          occurredAt: e.occurredAt,
          receivedAt,
          day: dayToDate(analyticsDay(e.occurredAt)),
          visitId: batch.visitId,
          deviceId: batch.deviceId,
          type: e.type,
          slug: e.slug,
          productId: e.slug === null ? null : (productIds.get(e.slug) ?? null),
          page: e.page,
          collection: e.collection,
          props: e.props,
        }))
      if (data.length) await db.analyticsEvent.createMany({ data })
      return empty(204)
    } catch (error) {
      // Never log the payload: only that storing failed.
      console.error('Analytics events not stored', error instanceof Error ? error.name : 'error')
      return empty(503)
    }
  }
}
