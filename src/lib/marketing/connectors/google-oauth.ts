// VYRA Marketing hub (ZP-1200): Google OAuth 2.0 refresh-token exchange, shared by the Google connectors.
// Docs: https://developers.google.com/identity/protocols/oauth2/web-server#offline (token endpoint, grant_type=refresh_token).
// Checked 2026-11-26. POST https://oauth2.googleapis.com/token, form-encoded client_id, client_secret, refresh_token,
// grant_type=refresh_token -> { access_token, expires_in, token_type }. Nothing here logs or returns a secret.
import type { FetchLike } from './types'

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export class GoogleApiError extends Error {
  constructor(message: string, public readonly httpStatus: number, public readonly retryable: boolean, /** true when the saved credentials no longer work. */ public readonly credentialsRejected = false) {
    super(message)
  }
}

const trim = (v: string | undefined) => (v ?? '').trim()

/** Swap the refresh token for a short-lived access token. Throws GoogleApiError with a plain message. */
export async function exchangeRefreshToken(credentials: Record<string, string>, fetchFn: FetchLike): Promise<string> {
  const clientId = trim(credentials.clientId)
  const clientSecret = trim(credentials.clientSecret)
  const refreshToken = trim(credentials.refreshToken)
  if (!clientId || !clientSecret || !refreshToken) throw new GoogleApiError('The Google client ID, client secret or refresh token is missing.', 0, false, true)
  let res: Response
  try {
    res = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
    })
  } catch {
    throw new GoogleApiError('Could not reach Google. Check the server has internet access and try again.', 0, true)
  }
  let body: { access_token?: string; error?: string; error_description?: string } | null = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok || !body?.access_token) {
    const code = body?.error ?? ''
    if (code === 'invalid_grant') throw new GoogleApiError('Google no longer accepts the saved refresh token (it was revoked or expired). Connect the channel again with a new one.', res.status, false, true)
    if (code === 'invalid_client' || code === 'unauthorized_client') throw new GoogleApiError('Google does not accept the OAuth client ID or secret. Check both and connect again.', res.status, false, true)
    return fail(res.status, `Google did not give an access token${code ? ` (${code})` : ''}.`)
  }
  return body.access_token
}

function fail(status: number, message: string): never {
  throw new GoogleApiError(message, status, status >= 500 || status === 429)
}

/** A JSON call to a Google API with a Bearer token. Throws GoogleApiError with Google's own message kept short. */
export async function googleJson<T = Record<string, unknown>>(
  fetchFn: FetchLike, method: 'GET' | 'POST', url: string, accessToken: string, body?: unknown, hints: { approval?: boolean } = {},
): Promise<T> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) } }
  if (body !== undefined) init.body = JSON.stringify(body)
  let res: Response
  try {
    res = await fetchFn(url, init)
  } catch {
    throw new GoogleApiError('Could not reach Google. Check the server has internet access and try again.', 0, true)
  }
  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    parsed = null
  }
  if (res.ok) return (parsed ?? {}) as T
  const g = (parsed as { error?: { message?: string; status?: string } } | null)?.error
  const detail = g?.message ? ` (Google says: ${g.message.slice(0, 200)})` : ''
  if (res.status === 401) throw new GoogleApiError(`Google rejected the saved credentials. Connect the channel again.${detail}`, 401, false, true)
  if (res.status === 403 && hints.approval) {
    throw new GoogleApiError(`Google refused access. The Business Profile API needs Google to approve your Cloud project first (see the setup steps), and the signed-in account must manage the listing.${detail}`, 403, false)
  }
  if (res.status === 403) throw new GoogleApiError(`Google refused access: the account or project is not allowed to do this.${detail}`, 403, false)
  if (res.status === 429) throw new GoogleApiError(`Google is limiting how often VYRA can call it right now. It will work again later.${detail}`, 429, true)
  if (res.status >= 500) throw new GoogleApiError(`Google had a temporary problem. Try again in a few minutes.${detail}`, res.status, true)
  throw new GoogleApiError(`Google did not accept the request.${detail}`, res.status, false)
}

export const failureOfGoogle = (e: unknown): { ok: false; error: string; retryable: boolean; code?: number } =>
  e instanceof GoogleApiError
    // code 190 = "the saved credentials no longer work": publishPost then moves the channel to ERROR (same meaning as Meta's 190).
    ? { ok: false, error: e.message, retryable: e.retryable, ...(e.credentialsRejected ? { code: 190 } : {}) }
    : { ok: false, error: e instanceof Error ? e.message : 'The request to Google failed.', retryable: false }
