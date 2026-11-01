// ZP-507: POST /api/public/loves { slug, on, device }. Server only.
//
// Order of checks (cheapest and most protective first):
//   1. Same origin (Origin = Host, Sec-Fetch-Site same-origin)          -> 403
//   2. Bots and headless browsers: nothing stored                       -> 204
//   3. Per-IP budget (IP in memory only, never stored or logged)        -> 429
//   4. Content type application/json or text/plain                      -> 415
//   5. Body at most MAX_LOVE_BODY_BYTES                                 -> 413
//   6. Exactly { slug, on, device } (parseLoveRequest)                  -> 400
//   7. Per-device budget, then the daily cap per device                 -> 429
//   8. A published piece (published, slug, published category)          -> 404
//   9. setLove with the salted hash of device + product                 -> 204
// Unlike analytics, a heart is the visitor's own action: GPC / DNT do not
// block it (the browser simply has no device id then and sends nothing),
// and staff signed in to the back office count like anyone else.
// Responses have no body (except 400's reason) and Cache-Control: no-store.
// Limits are in memory per instance, like src/lib/analytics/limits.ts.
import type { PrismaClient } from '@prisma/client'
import prisma from '@/lib/db'
import { DailyCounter, EventBudget, type BudgetResult } from '@/lib/analytics/limits'
import { isSameOrigin } from '@/lib/analytics/ingest'
import { isBotRequest } from '@/lib/analytics/privacy'
import { PUBLIC_PRODUCT_WHERE } from '@/lib/storefront/queries'
import { clientKey } from '@/lib/storefront/rate-limit'
import { setLove } from './db'
import { loveHash, loveHashKey } from './hash'
import { parseLoveRequest } from './model'

/** { slug (<= 96), on, device (36) } is under 200 bytes. */
export const MAX_LOVE_BODY_BYTES = 1024

/**
 * Per IP: ~30 people behind one carrier-NAT address, each tapping a few
 * hearts a minute (burst 120, 1 per second sustained).
 */
export const LOVE_IP_BUDGET = { capacity: 120, refillPerSecond: 1 }
/** Per device: a quick run of taps (burst 30), then one every 5 s. */
export const LOVE_DEVICE_BUDGET = { capacity: 30, refillPerSecond: 0.2 }
/** Per device per 24 h: far beyond a real visitor (the catalogue has ~50 pieces). */
export const LOVES_PER_DEVICE_PER_DAY = 300

type Db = Pick<PrismaClient, 'product' | '$transaction'>

export type LovesHandlerOptions = {
  db?: Db
  ipBudget?: EventBudget
  deviceBudget?: EventBudget
  deviceDaily?: DailyCounter
  /** The HMAC key; default loveHashKey() (resolved per request, so builds need no secret). */
  hashKey?: () => Buffer
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...NO_STORE, ...extra } })
}
function tooMany(limit: BudgetResult & { ok: false }): Response {
  return empty(429, { 'Retry-After': String(limit.retryAfterSeconds) })
}

function contentTypeOk(value: string | null): boolean {
  const type = (value ?? '').split(';')[0].trim().toLowerCase()
  return type === 'application/json' || type === 'text/plain'
}

/** Read at most `max` bytes (whatever Content-Length says); null when the body is larger. */
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
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks))
}

export function createLovesHandler(options: LovesHandlerOptions = {}) {
  const db = options.db ?? prisma
  const ipBudget = options.ipBudget ?? new EventBudget(LOVE_IP_BUDGET)
  const deviceBudget = options.deviceBudget ?? new EventBudget(LOVE_DEVICE_BUDGET)
  const deviceDaily = options.deviceDaily ?? new DailyCounter({ limit: LOVES_PER_DEVICE_PER_DAY })
  const hashKey = options.hashKey ?? (() => loveHashKey())

  return async function handleLove(request: Request): Promise<Response> {
    const headers = request.headers
    if (!isSameOrigin(headers)) return empty(403)
    if (isBotRequest(headers)) return empty(204)

    const ip = ipBudget.take(clientKey(headers), 1)
    if (!ip.ok) return tooMany(ip)

    if (!contentTypeOk(headers.get('content-type'))) return empty(415)
    const declared = Number(headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_LOVE_BODY_BYTES) return empty(413)
    let raw: string | null
    try {
      raw = await readLimited(request, MAX_LOVE_BODY_BYTES)
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
    const body = parseLoveRequest(parsed)
    if (!body.ok) {
      return new Response(JSON.stringify({ error: body.error }), {
        status: 400,
        headers: { ...NO_STORE, 'Content-Type': 'application/json' },
      })
    }
    const { slug, on, device } = body.value

    const perDevice = deviceBudget.take(device, 1)
    if (!perDevice.ok) return tooMany(perDevice)
    if (!deviceDaily.add(device, 1)) return empty(429, { 'Retry-After': '3600' })

    try {
      const piece = await db.product.findFirst({ where: { ...PUBLIC_PRODUCT_WHERE, slug }, select: { id: true } })
      if (!piece) return empty(404)
      await setLove(db, piece.id, loveHash(hashKey(), device, piece.id), on)
      return empty(204)
    } catch (error) {
      // Never log the request, the device id or the key: only that it failed.
      console.error('Love not stored', error instanceof Error ? error.name : 'error')
      return empty(503)
    }
  }
}
