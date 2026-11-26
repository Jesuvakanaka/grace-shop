// VYRA Marketing hub (ZP-1200): the connector contract. Every connector takes an
// injectable fetch so tests use a fake; nothing here calls a real API by itself.

import type { GoLiveInput } from '../flags'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ConnectorPost {
  id: number
  text: string
  /** Absolute public URLs of the photos (the platform downloads them). */
  imageUrls: string[]
  link: string | null
  format: string
  trackingTag: string
}

export interface ConnectorContext {
  /** Decrypted credentials of the channel. Never log. */
  credentials: Record<string, string>
  externalId: string | null
  config: Record<string, unknown> | null
  fetch: FetchLike
  /** What assertCanGoLive needs. Connectors check it again before any request (fail closed when missing). */
  gate?: GoLiveInput
}

export type PublishResult =
  | { ok: true; externalId: string; externalUrl: string | null; /** Plain words for the owner, shown with the result (cost, "open the app to finish"). */ message?: string }
  | { ok: false; error: string; retryable: boolean; /** Platform error code (190 or 401 = the saved token/credentials no longer work, for Meta and Google alike; the channel moves to ERROR). */ code?: number }

export interface InsightsResult {
  ok: boolean
  error?: string
  metrics: { impressions?: number; reach?: number; clicks?: number; likes?: number; comments?: number; shares?: number; spendCents?: number }
}

export type RefreshResult =
  | { ok: true; refreshed: boolean; credentials: Record<string, string> }
  | { ok: false; error: string; retryable: boolean; code?: number }

export type VerifyResult = { ok: true; externalId: string | null; name: string | null; /** Non-secret facts found while verifying (for example the account currency); saved in the channel's config. */ extraConfig?: Record<string, string> } | { ok: false; error: string }

/** One customer message. The caller has already checked consent and the go-live gate; the connector checks the gate again. */
export interface ConnectorMessage {
  /** E.164 phone number (WhatsApp, SMS) or email address. */
  to: string
  /** First name or full name, for greetings. */
  toName: string | null
  text: string
  subject: string | null
  /** WhatsApp: the approved template (marketing outside the 24-hour window must use one). */
  templateName: string | null
  templateLanguage: string
  templateVars: string[]
  /** Email: the one-click unsubscribe link (also sent as List-Unsubscribe headers). */
  unsubscribeUrl: string | null
}

export type SendResult =
  | { ok: true; externalId: string }
  | { ok: false; error: string; retryable: boolean; code?: number; /** The provider says this person has stopped messages (for example Twilio 21610). */ optedOut?: boolean }

export interface Connector {
  kind: string
  /** Check the credentials against the platform (a read-only call). */
  verify(credentials: Record<string, string>, fetch: FetchLike): Promise<VerifyResult>
  /** Publish one approved post. Callers must pass assertCanGoLive first. */
  publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult>
  /** Message connectors (WhatsApp Cloud, SMS, email): send ONE message. Callers must pass assertCanGoLive and a consent check first. */
  send?(message: ConnectorMessage, ctx: ConnectorContext): Promise<SendResult>
  /** True when the channel only sends customer messages (the Messages screen), never posts. */
  messagesOnly?: boolean
  /**
   * Channels whose access token is short-lived (X: about 2 hours): swap the saved refresh token for fresh tokens BEFORE a publish.
   * The caller (publishPost) runs it after the go-live gate and saves the returned credentials encrypted straight away
   * (refresh tokens can be single-use). `refreshed: false` = nothing to do (no refresh token saved).
   */
  refreshCredentials?(credentials: Record<string, string>, fetch: FetchLike): Promise<RefreshResult>
  fetchInsights?(externalId: string, ctx: ConnectorContext): Promise<InsightsResult>
}
