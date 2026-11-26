// VYRA Marketing hub (ZP-1200): the kill switch and the ONE go-live gate. Pure.
import { WebsiteError } from '@/lib/website/http'

type Env = Record<string, string | undefined>

/** Kill switch: GRACE_MARKETING_HUB === 'false' hides the hub and makes its APIs answer 404. Default on. */
export function hubEnabled(env: Env = process.env): boolean {
  return env.GRACE_MARKETING_HUB !== 'false'
}

/** The environment allows real posting: GRACE_MARKETING_LIVE === 'true' (absent on UAT). */
export function liveAllowedByEnv(env: Env = process.env): boolean {
  return env.GRACE_MARKETING_LIVE === 'true'
}

export interface GoLiveInput {
  settings: { liveEnabled: boolean } | null | undefined
  channel: { status: string; credentialsEnc?: string | null } | null | undefined
  post: { approvedBy?: string | null; approvedAt?: Date | string | null } | null | undefined
  env?: Env
}

export type GoLiveCheck = { ok: true } | { ok: false; reason: string }

/** Why an item may not go out, or ok. Every condition must hold. */
export function checkCanGoLive(input: GoLiveInput): GoLiveCheck {
  if (!liveAllowedByEnv(input.env ?? process.env)) {
    return { ok: false, reason: 'Live posting is switched off on this server (GRACE_MARKETING_LIVE is not "true").' }
  }
  if (!input.settings || input.settings.liveEnabled !== true) {
    return { ok: false, reason: 'Live posting is switched off in the marketing settings.' }
  }
  if (!input.channel || input.channel.status !== 'CONNECTED') {
    return { ok: false, reason: 'This channel is not connected yet.' }
  }
  if (!input.channel.credentialsEnc) {
    return { ok: false, reason: 'This channel has no saved credentials.' }
  }
  if (!input.post || !input.post.approvedBy || !input.post.approvedAt) {
    return { ok: false, reason: 'The owner has not approved this yet.' }
  }
  return { ok: true }
}

/** Throws a 409 WebsiteError with a plain reason unless everything allows going live. */
export function assertCanGoLive(input: GoLiveInput): void {
  const check = checkCanGoLive(input)
  if (!check.ok) throw new WebsiteError(409, check.reason, { blocked: 'live' })
}
