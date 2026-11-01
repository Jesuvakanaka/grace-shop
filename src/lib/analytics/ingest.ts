// ZP-493: POST /api/public/events, the collection endpoint. Server only.
//
// Order of checks (cheapest and most protective first):
//   1. Same origin: Origin must match Host, Sec-Fetch-Site (when sent) must be
//      same-origin                                                    -> 403
//   2. GPC / DNT, bots, headless browsers, staff with a valid admin
//      session cookie: nothing is stored                              -> 204
//   3. Per-IP event budget, 1 token for the request (IP in memory only) -> 429
//   4. Content type text/plain (sendBeacon) or application/json         -> 415
//   5. Body at most MAX_BODY_BYTES                                      -> 413
//   6. JSON + envelope (version, ids, 1..20 events)                     -> 400
//   7. Per-IP event budget for the events, new visit ids per IP per
//      hour, per-visit event budget, events per visit per day          -> 429
//   8. Each event against the allow-list (./events.ts): invalid events
//      are dropped one by one
//   9. Slugs must be published pieces (else the event is dropped); size /
//      colour must be one of the piece's own options (else the prop is dropped)
//  10. Stored with createMany skipDuplicates on the client's event id    -> 204
// Responses carry no body (except the 400 reason) and Cache-Control: no-store.
// Nothing about the request (IP, user agent, cookie) is stored or logged.
import type { PrismaClient } from '@prisma/client'
import prisma from '@/lib/db'
import { getSession } from '@/lib/auth'
import { PUBLIC_PRODUCT_WHERE } from '@/lib/storefront/queries'
import { splitOptions } from '@/lib/storefront/product-enquiry'
import { clientKey } from '@/lib/storefront/rate-limit'
import { analyticsDay, cleanText, dayToDate, validateBatch, type PropValue, type ValidEvent } from './events'
import {
  DailyCounter,
  EventBudget,
  IP_EVENT_BUDGET,
  NEW_VISITS_PER_IP_PER_HOUR,
  NewVisitLimiter,
  VISIT_EVENT_BUDGET,
  VISIT_EVENTS_PER_DAY,
  type BudgetResult,
} from './limits'
import { isBotRequest, isOptedOutRequest } from './privacy'

/** 20 events of the largest kind are about 5 KB; 32 KB leaves room and stops junk. */
export const MAX_BODY_BYTES = 32 * 1024

type Db = Pick<PrismaClient, 'product' | 'analyticsEvent'>

export type EventsHandlerOptions = {
  db?: Db
  ipBudget?: EventBudget
  visitBudget?: EventBudget
  visitDaily?: DailyCounter
  newVisits?: NewVisitLimiter
  now?: () => Date
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...NO_STORE, ...extra } })
}
function tooMany(limit: BudgetResult & { ok: false }): Response {
  return empty(429, { 'Retry-After': String(limit.retryAfterSeconds) })
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

/**
 * Staff browsing the site while signed in to the back office (same host on
 * UAT, where the site lives under /site) are not visitors. The session
 * cookie is host-only and HttpOnly; the browser sends it with sendBeacon and
 * with the fetch fallback (credentials: same-origin). A forged or expired
 * token, or a server without JWT_SECRET, counts as a normal visitor.
 */
async function isStaffRequest(request: Request): Promise<boolean> {
  if (!request.headers.get('cookie')?.includes('auth-token=')) return false
  try {
    return (await getSession(request)) !== null
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

type Piece = { id: number; sizes: string[]; colours: string[] }

/** The piece's own spelling of an option, matched case-insensitively; null when it is not one of them. */
function matchOption(value: PropValue | undefined, options: string[]): string | null {
  if (typeof value !== 'string') return null
  const wanted = cleanText(value).toLowerCase()
  return options.find((o) => cleanText(o).toLowerCase() === wanted) ?? null
}

/** Keep size / colour only when they are one of the piece's published options. */
function checkOptions(event: ValidEvent, piece: Piece | undefined): Record<string, PropValue> {
  if (!('size' in event.props) && !('colour' in event.props)) return event.props
  const props = { ...event.props }
  for (const [key, options] of [
    ['size', piece?.sizes ?? []],
    ['colour', piece?.colours ?? []],
  ] as const) {
    if (!(key in props)) continue
    const match = matchOption(props[key], options)
    if (match === null) delete props[key]
    else props[key] = match
  }
  return props
}

export function createEventsHandler(options: EventsHandlerOptions = {}) {
  const db = options.db ?? prisma
  const ipBudget = options.ipBudget ?? new EventBudget(IP_EVENT_BUDGET)
  const visitBudget = options.visitBudget ?? new EventBudget(VISIT_EVENT_BUDGET)
  const visitDaily = options.visitDaily ?? new DailyCounter({ limit: VISIT_EVENTS_PER_DAY })
  const newVisits = options.newVisits ?? new NewVisitLimiter({ perHour: NEW_VISITS_PER_IP_PER_HOUR })
  const now = options.now ?? (() => new Date())

  return async function handleEvents(request: Request): Promise<Response> {
    const headers = request.headers
    if (!isSameOrigin(headers)) return empty(403)
    if (isOptedOutRequest(headers) || isBotRequest(headers)) return empty(204)
    if (await isStaffRequest(request)) return empty(204)

    const ip = clientKey(headers)
    const requestCost = ipBudget.take(ip, 1)
    if (!requestCost.ok) return tooMany(requestCost)

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

    // Every event sent counts, valid or not.
    const count = batch.events.length + batch.dropped
    const ipEvents = ipBudget.take(ip, count)
    if (!ipEvents.ok) return tooMany(ipEvents)
    if (!newVisits.allow(ip, batch.visitId)) return empty(429, { 'Retry-After': '600' })
    const visitEvents = visitBudget.take(batch.visitId, count)
    if (!visitEvents.ok) return tooMany(visitEvents)
    if (!visitDaily.add(batch.visitId, count)) return empty(429, { 'Retry-After': '3600' })

    if (batch.events.length === 0) return empty(204)

    try {
      const slugs = [...new Set(batch.events.map((e) => e.slug).filter((s): s is string => s !== null))]
      const rows = slugs.length
        ? await db.product.findMany({
            where: { ...PUBLIC_PRODUCT_WHERE, slug: { in: slugs } },
            select: { id: true, slug: true, sizes: true, colours: true },
          })
        : []
      const pieces = new Map<string, Piece>(
        rows.map((p) => [p.slug as string, { id: p.id, sizes: splitOptions(p.sizes), colours: splitOptions(p.colours) }]),
      )

      const data = batch.events
        .filter((e) => e.slug === null || pieces.has(e.slug))
        .map((e) => {
          const piece = e.slug === null ? undefined : pieces.get(e.slug)
          return {
            eventId: e.id,
            occurredAt: e.occurredAt,
            receivedAt,
            day: dayToDate(analyticsDay(e.occurredAt)),
            visitId: batch.visitId,
            deviceId: batch.deviceId,
            type: e.type,
            slug: e.slug,
            productId: piece?.id ?? null,
            page: e.page,
            collection: e.collection,
            props: checkOptions(e, piece),
          }
        })
      if (data.length) await db.analyticsEvent.createMany({ data, skipDuplicates: true })
      return empty(204)
    } catch (error) {
      // Never log the payload or the request: only that storing failed.
      console.error('Analytics events not stored', error instanceof Error ? error.name : 'error')
      return empty(503)
    }
  }
}
