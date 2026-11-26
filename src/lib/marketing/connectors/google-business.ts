// VYRA Marketing hub (ZP-1200): Google Business Profile connector ("What's new" local posts).
// Docs checked 2026-11-26:
//   create post  https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create
//                POST https://mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/localPosts (still the current endpoint for
//                posts: no deprecation notice; the other Business Profile APIs moved to v1 hosts but local posts stayed on v4).
//                Body LocalPost: languageCode, summary, topicType (STANDARD), callToAction {actionType, url}, media [{mediaFormat, sourceUrl}].
//                CALL has no url ("should be left unset for Call CTA"). Scope https://www.googleapis.com/auth/business.manage
//   list         https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list
//                GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{a}/locations?readMask=...
// API access needs Google's approval of the Cloud project (GBP API access request) before any call works.
import { assertCanGoLive } from '../flags'
import { exchangeRefreshToken, failureOfGoogle, googleJson } from './google-oauth'
import type { Connector, ConnectorContext, ConnectorPost, FetchLike, PublishResult, VerifyResult } from './types'

export const GBP_POSTS_BASE = 'https://mybusiness.googleapis.com/v4'
export const GBP_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const LOCATION_NAME = /^accounts\/\d+\/locations\/\d+$/
export const CTA_TYPES = ['LEARN_MORE', 'CALL', 'SHOP', 'ORDER', 'BOOK', 'SIGN_UP'] as const
type Cta = (typeof CTA_TYPES)[number]

/** Names of the location in the API: accounts/{a}/locations/{l}. */
export const locationName = (accountId: string, locationId: string) => `accounts/${accountId.trim()}/locations/${locationId.trim()}`

/** The LocalPost body for a post. Pure. */
export function buildLocalPost(post: ConnectorPost, cta: Cta = 'LEARN_MORE'): Record<string, unknown> {
  const body: Record<string, unknown> = { languageCode: 'en', summary: post.text.trim(), topicType: 'STANDARD' }
  if (cta === 'CALL') body.callToAction = { actionType: 'CALL' }
  else if (post.link) body.callToAction = { actionType: cta, url: post.link }
  if (post.imageUrls.length > 0) body.media = [{ mediaFormat: 'PHOTO', sourceUrl: post.imageUrls[0] }]
  return body
}

export const googleBusinessConnector: Connector = {
  kind: 'GOOGLE_BUSINESS',

  /** Lists the account's locations (read only) and looks for the saved location ID. */
  async verify(credentials, fetchFn: FetchLike): Promise<VerifyResult> {
    try {
      const accountId = (credentials.accountId ?? '').trim()
      const locationId = (credentials.locationId ?? '').trim()
      if (!/^\d+$/.test(accountId) || !/^\d+$/.test(locationId)) return { ok: false, error: 'The account ID and location ID are numbers.' }
      const access = await exchangeRefreshToken(credentials, fetchFn)
      const wanted = locationName(accountId, locationId)
      let pageToken = ''
      for (let page = 0; page < 10; page++) {
        const qs = new URLSearchParams({ readMask: 'name,title', pageSize: '100', ...(pageToken ? { pageToken } : {}) })
        const r = await googleJson<{ locations?: { name?: string; title?: string }[]; nextPageToken?: string }>(
          fetchFn, 'GET', `${GBP_INFO_BASE}/accounts/${accountId}/locations?${qs.toString()}`, access, undefined, { approval: true },
        )
        // The Business Information API names a location "locations/{l}"; accept either spelling.
        const hit = r.locations?.find((l) => l.name === wanted || l.name === `locations/${locationId}`)
        if (hit) return { ok: true, externalId: wanted, name: hit.title ?? null }
        if (!r.nextPageToken) break
        pageToken = r.nextPageToken
      }
      return { ok: false, error: 'Google did not list that location for this account. Check the account ID and location ID, and that the signed-in account manages the listing.' }
    } catch (e) {
      return { ok: false, error: failureOfGoogle(e).error }
    }
  },

  async publish(post: ConnectorPost, ctx: ConnectorContext): Promise<PublishResult> {
    assertCanGoLive(ctx.gate ?? { settings: null, channel: null, post: null }) // fail closed
    const location = ctx.externalId
    if (!location || !LOCATION_NAME.test(location)) return { ok: false, error: 'This channel has no Google location saved.', retryable: false }
    if (post.format !== 'POST') return { ok: false, error: 'Google Business Profile takes normal posts only.', retryable: false }
    if (!post.text.trim()) return { ok: false, error: 'A Google post needs some words.', retryable: false }
    if (post.text.trim().length > 1500) return { ok: false, error: 'Google Business Profile posts are at most 1500 characters.', retryable: false }
    if (post.imageUrls.length > 1) return { ok: false, error: 'A Google post takes one photo.', retryable: false }
    const configured = ctx.config?.callToAction
    const cta = (CTA_TYPES as readonly string[]).includes(configured as string) ? (configured as Cta) : 'LEARN_MORE'
    try {
      const access = await exchangeRefreshToken(ctx.credentials, ctx.fetch)
      const r = await googleJson<{ name?: string; searchUrl?: string }>(ctx.fetch, 'POST', `${GBP_POSTS_BASE}/${location}/localPosts`, access, buildLocalPost(post, cta), { approval: true })
      if (!r.name) return { ok: false, error: 'Google did not say whether the post went out. Check the profile before trying again.', retryable: false }
      return { ok: true, externalId: r.name, externalUrl: r.searchUrl ?? null }
    } catch (e) {
      return failureOfGoogle(e)
    }
  },
}
