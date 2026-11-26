// VYRA Marketing hub (ZP-1200): Google Merchant Center connector (Merchant API, NOT the Content API, which ended 18 Aug 2026).
// Docs checked 2026-11-26:
//   add and manage products  https://developers.google.com/merchant/api/guides/products/add-manage
//     POST https://merchantapi.googleapis.com/products/v1/accounts/{id}/productInputs:insert?dataSource=accounts/{id}/dataSources/{ds}
//     body { offerId, contentLanguage, feedLabel, productAttributes { title, description, link, imageLink, availability, price {amountMicros, currencyCode}, condition, ... } }
//   data sources             https://developers.google.com/merchant/api/guides/data-sources/manage-various-data-sources
//     POST https://merchantapi.googleapis.com/datasources/v1/accounts/{id}/dataSources
//     body { displayName, primaryProductDataSource { feedLabel, contentLanguage }, fileInput { fetchSettings { enabled, frequency, fetchUri, ... } } }
//     (omit fileInput for an API data source). The exact primaryProductDataSource + fetchSettings body was taken from Google's
//     Python sample for "create a file fetch primary product data source", not from a REST example: verify against a real account.
//   accounts                 GET https://merchantapi.googleapis.com/accounts/v1/accounts/{id}  (read only, used by verify)
// Scope https://www.googleapis.com/auth/content. Auth is OAuth (client id, secret, refresh token) like the other Google connectors.
// This channel carries the catalogue, not posts: publish() always says so. Sending anything goes through assertCanSync first.
import { assertCanSync, type SyncInput } from '../flags'
import type { FeedItem } from '../feed'
import { exchangeRefreshToken, failureOfGoogle, GoogleApiError, googleJson } from './google-oauth'
import type { Connector, FetchLike, PublishResult, VerifyResult } from './types'

export const MERCHANT_BASE = 'https://merchantapi.googleapis.com'
export const MAX_PRODUCTS_PER_SYNC = 500

const idOf = (c: Record<string, string>) => (c.merchantId ?? '').trim()

export interface MerchantSyncContext {
  credentials: Record<string, string>
  config: Record<string, unknown> | null
  fetch: FetchLike
  /** What assertCanSync needs. Checked again before every request group (fail closed when missing). */
  gate?: SyncInput
}

const cfgText = (ctx: MerchantSyncContext, key: string, fallback: string) => {
  const v = ctx.config?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : fallback
}

/** "12.00 USD" (the feed's price text) -> Merchant API Price. Null when there is no usable price. */
export function priceFromFeed(price: string): { amountMicros: string; currencyCode: string } | null {
  const m = /^(\d+(?:\.\d{1,2})?)\s+([A-Z]{3})$/.exec(price.trim())
  if (!m) return null
  const [whole, frac = ''] = m[1].split('.')
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2)) // whole cents: exact below 2^53
  return cents > 0 ? { amountMicros: `${cents}0000`, currencyCode: m[2] } : null
}

const AVAILABILITY: Record<string, string> = { 'in stock': 'IN_STOCK', 'out of stock': 'OUT_OF_STOCK', preorder: 'PREORDER' }

/** One product input from a public feed row (feed.ts builds the rows from the public product DTO). Null when Google would refuse it. */
export function productInputFromFeedItem(item: FeedItem, opts: { contentLanguage: string; feedLabel: string }): Record<string, unknown> | null {
  const price = priceFromFeed(item.price)
  if (!price || !item.link || !item.image_link) return null
  const attributes: Record<string, unknown> = {
    title: item.title,
    description: item.description,
    link: item.link,
    imageLink: item.image_link,
    availability: AVAILABILITY[item.availability] ?? 'IN_STOCK',
    condition: 'NEW',
    price,
    brand: item.brand,
    identifierExists: false,
  }
  if (item.additional_image_link) attributes.additionalImageLinks = item.additional_image_link.split(',').filter(Boolean)
  if (item.google_product_category) attributes.googleProductCategory = item.google_product_category
  if (item.product_type) attributes.productTypes = [item.product_type]
  return { offerId: item.id, contentLanguage: opts.contentLanguage, feedLabel: opts.feedLabel, productAttributes: attributes }
}

/** Register the product feed URL as a scheduled file-fetch data source. Returns the data source name (accounts/{id}/dataSources/{ds}). */
export async function registerFeedSource(ctx: MerchantSyncContext, feedUrl: string): Promise<{ name: string }> {
  assertCanSync(ctx.gate ?? { settings: null, channel: null, actor: null })
  if (!/^https:\/\//.test(feedUrl)) throw new GoogleApiError('Google can only fetch the feed from a public https address. Set GRACE_STOREFRONT_HOSTS.', 0, false)
  const merchantId = idOf(ctx.credentials)
  const access = await exchangeRefreshToken(ctx.credentials, ctx.fetch)
  const r = await googleJson<{ name?: string }>(ctx.fetch, 'POST', `${MERCHANT_BASE}/datasources/v1/accounts/${merchantId}/dataSources`, access, {
    displayName: 'VYRA product feed',
    primaryProductDataSource: { feedLabel: cfgText(ctx, 'feedLabel', 'VYRA'), contentLanguage: cfgText(ctx, 'contentLanguage', 'en') },
    fileInput: { fetchSettings: { enabled: true, frequency: 'FREQUENCY_DAILY', timeOfDay: { hours: 3 }, timeZone: 'Africa/Harare', fetchUri: feedUrl } },
  })
  if (!r.name) throw new GoogleApiError('Google did not return the data source name.', 0, false)
  return { name: r.name }
}

/** Create an API (no file) primary data source to push product inputs into. */
async function createApiSource(ctx: MerchantSyncContext, access: string): Promise<string> {
  const r = await googleJson<{ name?: string }>(ctx.fetch, 'POST', `${MERCHANT_BASE}/datasources/v1/accounts/${idOf(ctx.credentials)}/dataSources`, access, {
    displayName: 'VYRA products (API)',
    primaryProductDataSource: { feedLabel: cfgText(ctx, 'feedLabel', 'VYRA'), contentLanguage: cfgText(ctx, 'contentLanguage', 'en') },
  })
  if (!r.name) throw new GoogleApiError('Google did not return the data source name.', 0, false)
  return r.name
}

export interface PushResult { sent: number; skipped: number; failed: { offerId: string; error: string }[]; capped: boolean; dataSource: string }

/** Push product inputs (one insert each) into an API data source, creating it first when `config.apiDataSource` is not saved. */
export async function pushProducts(ctx: MerchantSyncContext, items: readonly FeedItem[]): Promise<PushResult> {
  assertCanSync(ctx.gate ?? { settings: null, channel: null, actor: null })
  const merchantId = idOf(ctx.credentials)
  const opts = { contentLanguage: cfgText(ctx, 'contentLanguage', 'en'), feedLabel: cfgText(ctx, 'feedLabel', 'VYRA') }
  const access = await exchangeRefreshToken(ctx.credentials, ctx.fetch)
  const saved = ctx.config?.apiDataSource
  const dataSource = typeof saved === 'string' && saved.startsWith(`accounts/${merchantId}/dataSources/`) ? saved : await createApiSource(ctx, access)
  const out: PushResult = { sent: 0, skipped: 0, failed: [], capped: items.length > MAX_PRODUCTS_PER_SYNC, dataSource }
  let strikes = 0
  for (const item of items.slice(0, MAX_PRODUCTS_PER_SYNC)) {
    const input = productInputFromFeedItem(item, opts)
    if (!input) { out.skipped++; continue }
    assertCanSync(ctx.gate as SyncInput) // still allowed? (cheap, pure)
    try {
      await googleJson(ctx.fetch, 'POST', `${MERCHANT_BASE}/products/v1/accounts/${merchantId}/productInputs:insert?dataSource=${encodeURIComponent(dataSource)}`, access, input)
      out.sent++
      strikes = 0
    } catch (e) {
      const f = failureOfGoogle(e)
      out.failed.push({ offerId: item.id, error: f.error })
      if (f.code === 190 || ++strikes >= 3) break // credentials rejected, or Google keeps refusing: stop instead of hammering it
    }
  }
  return out
}

export const googleMerchantConnector: Connector = {
  kind: 'GOOGLE_MERCHANT',

  async verify(credentials: Record<string, string>, fetchFn: FetchLike): Promise<VerifyResult> {
    try {
      const id = idOf(credentials)
      if (!/^\d+$/.test(id)) return { ok: false, error: 'The Merchant Center ID is a number.' }
      const access = await exchangeRefreshToken(credentials, fetchFn)
      const r = await googleJson<{ accountName?: string; name?: string }>(fetchFn, 'GET', `${MERCHANT_BASE}/accounts/v1/accounts/${id}`, access)
      return { ok: true, externalId: id, name: r.accountName ?? null }
    } catch (e) {
      return { ok: false, error: failureOfGoogle(e).error }
    }
  },

  /** Merchant Center holds products, not posts. Nothing is sent. */
  async publish(): Promise<PublishResult> {
    return { ok: false, error: 'Google Merchant Center carries your product catalogue, not posts. Use "Send products to Google" on the Channels page instead.', retryable: false }
  },
}
