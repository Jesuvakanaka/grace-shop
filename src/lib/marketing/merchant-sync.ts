// VYRA Marketing hub (ZP-1200): send the product catalogue to Google Merchant Center. Server only. OWNER action.
// Two modes: 'register-feed' (tell Google to fetch our public feed URL on a schedule) or 'products' (push product inputs
// built from the public product DTO with feed.ts). Both run assertCanSync first: env live + live setting + connected
// channel with credentials + an owner pressed the button. Nothing is sent otherwise.
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import type { PublicProduct } from '@/lib/storefront/dto'
import { primaryStorefrontHost } from '@/lib/storefront/public-url'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { getConnector } from './connectors'
import { pushProducts, registerFeedSource, type PushResult } from './connectors/google-merchant'
import { failureOfGoogle } from './connectors/google-oauth'
import type { FetchLike } from './connectors/types'
import { buildFeedItems } from './feed'
import { assertCanSync } from './flags'
import { decryptJson } from './secrets'
import { getSettings } from './settings'
import type { Actor } from './state'

export const SYNC_MODES = ['products', 'register-feed'] as const
export type SyncMode = (typeof SYNC_MODES)[number]

export interface SyncDeps {
  fetch: FetchLike
  /** Default: every published product (the same list the public feed uses). Tests inject one. */
  loadProducts?: () => Promise<PublicProduct[]>
  /** Override the public site address (default: first GRACE_STOREFRONT_HOSTS entry). */
  baseUrl?: string | null
}

export type SyncOutcome =
  | { mode: 'products'; sent: number; skipped: number; failed: number; capped: boolean; firstError: string | null }
  | { mode: 'register-feed'; dataSource: string; feedUrl: string }

export async function syncProducts(db: Db, channelId: number, mode: SyncMode, actor: Actor, deps: SyncDeps): Promise<SyncOutcome> {
  const channel = await db.marketingChannel.findUnique({ where: { id: channelId } })
  if (!channel) throw new WebsiteError(404, 'Channel not found')
  if (channel.kind !== 'GOOGLE_MERCHANT' || !getConnector(channel.kind)) throw new WebsiteError(409, 'Only Google Merchant Center can be sent products.')
  const settings = await getSettings(db)
  const gate = { settings, channel, actor }
  assertCanSync(gate) // before anything is decrypted, loaded or sent
  if (!settings.productFeedEnabled) throw new WebsiteError(409, 'Turn on "Product feed" in the marketing settings first.')

  const credentials = decryptJson<Record<string, string>>(channel.credentialsEnc as string)
  const config = (channel.config && typeof channel.config === 'object' && !Array.isArray(channel.config) ? channel.config : null) as Record<string, string> | null
  const ctx = { credentials, config, fetch: deps.fetch, gate }
  const { storefrontHosts } = hostRoutingConfigFromEnv()
  const host = primaryStorefrontHost(storefrontHosts)
  const origin = deps.baseUrl ? deps.baseUrl.replace(/\/+$/, '') : host ? `https://${host}` : null

  const fail = async (e: unknown): Promise<never> => {
    const f = failureOfGoogle(e)
    await db.marketingChannel.update({ where: { id: channel.id }, data: { lastError: f.error.slice(0, 500), ...(f.code === 190 ? { status: 'ERROR' } : {}) } })
    await writeAudit(db, { actor: actor.username, action: 'channel.sync_failed', entity: 'channel', entityId: channel.id, detail: { mode, error: f.error.slice(0, 200) } })
    throw new WebsiteError(f.retryable ? 502 : 400, f.error)
  }

  const saveConfig = (patch: Record<string, string>) =>
    db.marketingChannel.update({ where: { id: channel.id }, data: { config: { ...(config ?? {}), ...patch }, lastError: null } })

  if (mode === 'register-feed') {
    if (!origin) throw new WebsiteError(409, 'The public site address is not set (GRACE_STOREFRONT_HOSTS), so Google cannot fetch the feed.')
    const feedUrl = `${origin}/api/public/marketing/feed.xml`
    try {
      const r = await registerFeedSource(ctx, feedUrl)
      await saveConfig({ feedDataSource: r.name })
      await writeAudit(db, { actor: actor.username, action: 'channel.sync', entity: 'channel', entityId: channel.id, detail: { mode, dataSource: r.name, feedUrl } })
      return { mode, dataSource: r.name, feedUrl }
    } catch (e) {
      return fail(e)
    }
  }

  let res: PushResult
  try {
    const load = deps.loadProducts ?? (await import('./feed-route')).loadPublishedProducts
    const items = buildFeedItems(await load(), { storefrontHosts, host: null })
    res = await pushProducts(ctx, items)
  } catch (e) {
    if (e instanceof WebsiteError) throw e
    return fail(e)
  }
  await saveConfig({ apiDataSource: res.dataSource })
  await writeAudit(db, {
    actor: actor.username, action: 'channel.sync', entity: 'channel', entityId: channel.id,
    detail: { mode, sent: res.sent, skipped: res.skipped, failed: res.failed.length, capped: res.capped },
  })
  return { mode, sent: res.sent, skipped: res.skipped, failed: res.failed.length, capped: res.capped, firstError: res.failed[0]?.error ?? null }
}
