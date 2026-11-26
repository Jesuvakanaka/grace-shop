// VYRA Marketing hub (ZP-1200): connect / disconnect Meta channels. Server only.
// The token is checked against the Graph API (read-only), stored encrypted, and never returned.
import type { MarketingChannel } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { toChannelRowDto, type ChannelRowDto } from './channel-rows'
import { getChannel, connectFieldsError } from './channels'
import { getConnector } from './connectors'
import { verifyAdAccount, cleanAccountId } from './connectors/meta-ads'
import { lookupPage, MetaGraphError } from './connectors/meta-graph'
import type { FetchLike } from './connectors/types'
import { encryptJson, tokenHint } from './secrets'
import { asObject, onlyKeys, oneOf, requiredText } from './validate'

export const CONNECTABLE_KINDS = ['FACEBOOK_PAGE', 'INSTAGRAM', 'META_ADS', 'THREADS', 'GOOGLE_BUSINESS', 'GOOGLE_MERCHANT', 'PINTEREST', 'TELEGRAM', 'X', 'YOUTUBE', 'TIKTOK'] as const
/** Kinds connected through the registry's `connectFields` and the connector's own verify(). */
const FIELD_KINDS: readonly string[] = ['THREADS', 'GOOGLE_BUSINESS', 'GOOGLE_MERCHANT', 'PINTEREST', 'TELEGRAM', 'X', 'YOUTUBE', 'TIKTOK']

async function saveRow(
  db: Db, kind: string, name: string, externalId: string, accessToken: string, config: Record<string, string>, actor: string,
  credentials?: Record<string, string>,
): Promise<MarketingChannel> {
  const data = {
    name,
    status: 'CONNECTED',
    externalId,
    credentialsEnc: encryptJson(credentials ?? (config.pageId ? { accessToken, pageId: config.pageId } : { accessToken })),
    tokenHint: tokenHint(accessToken),
    config,
    lastError: null,
    connectedAt: new Date(),
    connectedBy: actor,
  }
  const existing = await db.marketingChannel.findFirst({ where: { kind }, orderBy: { id: 'asc' } })
  const row = existing
    ? await db.marketingChannel.update({ where: { id: existing.id }, data })
    : await db.marketingChannel.create({ data: { kind, ...data } })
  await writeAudit(db, {
    actor, action: 'channel.connect', entity: 'channel', entityId: row.id,
    detail: { kind, externalId, tokenHint: data.tokenHint, name },
  })
  return row
}

/** Verify the token and save the Page (and its linked Instagram account, if any). Never returns the token. */
export async function connectMeta(
  db: Db,
  body: unknown,
  actor: string,
  deps: { fetch: FetchLike },
): Promise<{ channels: ChannelRowDto[]; instagramLinked: boolean }> {
  const o = asObject(body)
  const kind = oneOf(o.kind, 'kind', CONNECTABLE_KINDS)
  if (FIELD_KINDS.includes(kind)) return connectWithFields(db, kind, o, actor, deps)
  onlyKeys(o, ['kind', 'pageId', 'accessToken', 'adAccountId'])
  if (kind === 'META_ADS') return connectMetaAds(db, o, actor, deps)
  if ('adAccountId' in o) throw new WebsiteError(400, 'Unknown field "adAccountId"', { field: 'adAccountId' })
  const pageId = requiredText(o.pageId, 'pageId', 40)
  if (!/^\d{5,30}$/.test(pageId)) throw new WebsiteError(400, 'The Page ID is a number (digits only).', { field: 'pageId' })
  const accessToken = requiredText(o.accessToken, 'accessToken', 1000)
  if (/\s/.test(accessToken)) throw new WebsiteError(400, 'The access token must not contain spaces.', { field: 'accessToken' })

  let page
  try {
    page = await lookupPage(deps.fetch, accessToken, pageId)
  } catch (e) {
    if (e instanceof MetaGraphError) throw new WebsiteError(e.httpStatus === 0 ? 502 : 400, e.message, { field: 'accessToken' })
    throw e
  }
  if (kind === 'INSTAGRAM' && !page.instagramId) {
    throw new WebsiteError(400, 'That Facebook Page has no Instagram account linked. Link a Business or Creator Instagram account to the Page, then try again.', { field: 'pageId' })
  }
  const channels: MarketingChannel[] = []
  channels.push(await saveRow(db, 'FACEBOOK_PAGE', page.pageName ?? 'Facebook Page', page.pageId, accessToken, { pageId: page.pageId }, actor))
  if (page.instagramId) {
    channels.push(await saveRow(db, 'INSTAGRAM', 'Instagram', page.instagramId, accessToken, { pageId: page.pageId }, actor))
  }
  return { channels: channels.map(toChannelRowDto), instagramLinked: Boolean(page.instagramId) }
}

/** Wipe the saved token and mark the channel NOT_CONNECTED. */
export async function disconnectChannel(db: Db, id: number, actor: string): Promise<ChannelRowDto> {
  const row = await db.marketingChannel.findUnique({ where: { id } })
  if (!row) throw new WebsiteError(404, 'Channel not found')
  const updated = await db.marketingChannel.update({
    where: { id },
    data: { status: 'NOT_CONNECTED', credentialsEnc: null, tokenHint: null, lastError: null, connectedAt: null, connectedBy: null },
  })
  await writeAudit(db, { actor, action: 'channel.disconnect', entity: 'channel', entityId: id, detail: { kind: row.kind, from: row.status } })
  return toChannelRowDto(updated)
}

/**
 * Connect the Meta ad account: verify GET /act_{id}?fields=id,name,currency,account_status, then save the
 * META_ADS channel as CONNECTED with the token, ad account ID and Page ID encrypted. Never returns the token.
 */
export async function connectMetaAds(
  db: Db,
  body: unknown,
  actor: string,
  deps: { fetch: FetchLike },
): Promise<{ channels: ChannelRowDto[]; instagramLinked: boolean }> {
  const o = asObject(body)
  onlyKeys(o, ['kind', 'adAccountId', 'accessToken', 'pageId'])
  const rawAccount = requiredText(o.adAccountId, 'adAccountId', 40)
  const adAccountId = cleanAccountId(rawAccount)
  if (!/^\d{5,30}$/.test(adAccountId)) throw new WebsiteError(400, 'The ad account ID is a number, usually written act_123456789.', { field: 'adAccountId' })
  const pageId = requiredText(o.pageId, 'pageId', 40)
  if (!/^\d{5,30}$/.test(pageId)) throw new WebsiteError(400, 'The Page ID is a number (digits only).', { field: 'pageId' })
  const accessToken = requiredText(o.accessToken, 'accessToken', 1000)
  if (/\s/.test(accessToken)) throw new WebsiteError(400, 'The access token must not contain spaces.', { field: 'accessToken' })
  const v = await verifyAdAccount({ accessToken, adAccountId }, deps.fetch)
  if (!v.ok) throw new WebsiteError(400, v.error, { field: 'accessToken' })
  const config = { pageId, adAccountId: v.id, currency: v.currency ?? '', accountName: v.name ?? '' }
  const row = await saveRow(db, 'META_ADS', v.name ?? 'Meta ad account', v.id, accessToken, config, actor, { accessToken, adAccountId: v.id, pageId })
  return { channels: [toChannelRowDto(row)], instagramLinked: false }
}

/**
 * Connect a channel from the field list in the registry (Threads, Google Business Profile, Google Merchant Center).
 * Every field is validated, the connector's verify() makes a read-only call, then the values are saved encrypted.
 * Non-secret fields are kept in config; only tokenHint (last 4 of the last secret field) is ever returned.
 */
export async function connectWithFields(
  db: Db, kind: string, o: Record<string, unknown>, actor: string, deps: { fetch: FetchLike },
): Promise<{ channels: ChannelRowDto[]; instagramLinked: boolean }> {
  const def = getChannel(kind)
  const connector = getConnector(kind)
  if (!def || !connector || def.connectFields.length === 0) throw new WebsiteError(400, 'This channel cannot be connected here yet.', { field: 'kind' })
  onlyKeys(o, ['kind', ...def.connectFields.map((f) => f.name)])
  const values: Record<string, string> = {}
  for (const f of def.connectFields) {
    const v = o[f.name]
    if (v !== undefined && typeof v !== 'string') throw new WebsiteError(400, `${f.label} must be text.`, { field: f.name })
    values[f.name] = (v ?? '').trim()
  }
  const bad = connectFieldsError(def.connectFields, values)
  if (bad) {
    const field = def.connectFields.find((f) => connectFieldsError([f], values))?.name
    throw new WebsiteError(400, bad, { field })
  }
  const v = await connector.verify(values, deps.fetch)
  if (!v.ok) throw new WebsiteError(400, v.error, { field: def.connectFields.filter((f) => f.kind === 'secret').at(-1)?.name })
  const secrets = def.connectFields.filter((f) => f.kind === 'secret')
  const hintSource = values[secrets[secrets.length - 1].name]
  const config: Record<string, string> = {}
  for (const f of def.connectFields) if (f.kind !== 'secret') config[f.name] = values[f.name]
  // Keep settings the hub saved later (for example the Merchant data source) when the owner reconnects.
  const existing = await db.marketingChannel.findFirst({ where: { kind }, orderBy: { id: 'asc' } })
  const kept = existing?.config && typeof existing.config === 'object' && !Array.isArray(existing.config) ? (existing.config as Record<string, string>) : {}
  const row = await saveRow(db, kind, v.name ?? def.label, v.externalId ?? '', hintSource, { ...kept, ...config }, actor, values)
  return { channels: [toChannelRowDto(row)], instagramLinked: false }
}
