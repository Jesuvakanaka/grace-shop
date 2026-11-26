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
  | { ok: true; externalId: string; externalUrl: string | null }
  | { ok: false; error: string; retryable: boolean; /** Platform error code (Meta: 190 = token no longer valid). */ code?: number }

export interface InsightsResult {
  ok: boolean
  error?: string
  metrics: { impressions?: number; reach?: number; clicks?: number; likes?: number; comments?: number; shares?: number; spendCents?: number }
}

export type VerifyResult = { ok: true; externalId: string | null; name: string | null } | { ok: false; error: string }

export interface Connector {
  kind: string
  /** Check the credentials against the platform (a read-only call). */
  verify(credentials: Record<string, string>, fetch: FetchLike): Promise<VerifyResult>
  /** Publish one approved post. Callers must pass assertCanGoLive first. */
  publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult>
  fetchInsights?(externalId: string, ctx: ConnectorContext): Promise<InsightsResult>
}
