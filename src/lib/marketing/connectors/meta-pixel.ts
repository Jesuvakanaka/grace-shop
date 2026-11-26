// VYRA Marketing hub (ZP-1200): Meta Conversions API (server-side Pixel events). Server only.
// Written from the documented fields; verify with a real Pixel (Events Manager, Test events) before trusting it.
// Gate: GRACE_MARKETING_LIVE=true AND settings.liveEnabled AND settings.metaPixelId AND a CONNECTED META_ADS channel
// with credentials. Checked before any request; a failed check sends nothing.
import { createHash } from 'node:crypto'
import { WebsiteError } from '@/lib/website/http'
import { liveAllowedByEnv } from '../flags'
import { failureOf, graphClient } from './meta-graph'
import type { FetchLike } from './types'

export const PIXEL_EVENT_NAMES = ['PageView', 'ViewContent', 'Contact'] as const
export type PixelEventName = (typeof PIXEL_EVENT_NAMES)[number]

export interface PixelGateInput {
  settings: { liveEnabled: boolean; metaPixelId?: string | null } | null | undefined
  channel: { status: string; credentialsEnc?: string | null } | null | undefined
  env?: Record<string, string | undefined>
}

export type PixelGateCheck = { ok: true; pixelId: string } | { ok: false; reason: string }

export function checkPixelGate(input: PixelGateInput): PixelGateCheck {
  if (!liveAllowedByEnv(input.env ?? process.env)) return { ok: false, reason: 'Live marketing is switched off on this server (GRACE_MARKETING_LIVE is not "true").' }
  if (!input.settings || input.settings.liveEnabled !== true) return { ok: false, reason: 'Live marketing is switched off in the marketing settings.' }
  const pixelId = input.settings.metaPixelId?.trim()
  if (!pixelId) return { ok: false, reason: 'No Meta Pixel ID is saved in the marketing settings.' }
  if (!input.channel || input.channel.status !== 'CONNECTED' || !input.channel.credentialsEnc) return { ok: false, reason: 'The Meta ad account is not connected.' }
  return { ok: true, pixelId }
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

export interface PixelUser {
  ip?: string | null
  userAgent?: string | null
  email?: string | null
  phone?: string | null
  fbp?: string | null
  fbc?: string | null
}

/** Meta's user_data. Email and phone are lower-cased / digits-only and SHA-256 hashed; IP and user agent are sent as they are (Meta's rule). */
export function buildUserData(u: PixelUser): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (u.ip) out.client_ip_address = u.ip
  if (u.userAgent) out.client_user_agent = u.userAgent
  const email = u.email?.trim().toLowerCase()
  if (email) out.em = [sha256(email)]
  const phone = u.phone?.replace(/\D/g, '')
  if (phone) out.ph = [sha256(phone)]
  if (u.fbp) out.fbp = u.fbp
  if (u.fbc) out.fbc = u.fbc
  return out
}

export interface PixelEvent {
  name: PixelEventName
  /** Unix seconds. */
  time?: number
  sourceUrl: string
  /** For browser/server de-duplication. */
  eventId?: string
  user?: PixelUser
  contentIds?: string[]
}

export function buildEventData(e: PixelEvent, now: Date = new Date()) {
  return {
    event_name: e.name,
    event_time: e.time ?? Math.floor(now.getTime() / 1000),
    action_source: 'website',
    event_source_url: e.sourceUrl,
    ...(e.eventId ? { event_id: e.eventId } : {}),
    user_data: buildUserData(e.user ?? {}),
    ...(e.contentIds?.length ? { custom_data: { content_ids: e.contentIds, content_type: 'product' } } : {}),
  }
}

/** POST /{pixel_id}/events. Throws 409 (no request made) when the gate fails. */
export async function sendEvent(
  deps: { fetch: FetchLike; gate: PixelGateInput; accessToken: string; testEventCode?: string },
  event: PixelEvent,
  now: Date = new Date(),
): Promise<{ ok: true; eventsReceived: number } | { ok: false; error: string }> {
  if (!(PIXEL_EVENT_NAMES as readonly string[]).includes(event.name)) throw new WebsiteError(400, 'Unknown pixel event.')
  const check = checkPixelGate(deps.gate)
  if (!check.ok) throw new WebsiteError(409, check.reason, { blocked: 'live' })
  try {
    const res = await graphClient(deps.fetch).post<{ events_received?: number }>(`${check.pixelId}/events`, deps.accessToken, {
      data: JSON.stringify([buildEventData(event, now)]),
      ...(deps.testEventCode ? { test_event_code: deps.testEventCode } : {}),
    })
    return { ok: true, eventsReceived: res.events_received ?? 0 }
  } catch (e) {
    return { ok: false, error: failureOf(e).error }
  }
}
