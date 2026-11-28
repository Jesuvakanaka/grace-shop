// VYRA Marketing hub (ZP-1200): a tiny Meta Graph API client (Facebook Login path).
// Injectable fetch, form-encoded POSTs, plain-English error mapping. It never logs tokens:
// the token travels in the Authorization header and never appears in a URL, a message or an error.
import type { FetchLike } from './types'

/** One place for the API version (Meta supports v25.0 until 2028). Override with env META_GRAPH_VERSION. */
export const META_GRAPH_VERSION = 'v25.0'

export function graphBase(env: Record<string, string | undefined> = process.env): string {
  const v = (env.META_GRAPH_VERSION ?? '').trim()
  return `https://graph.facebook.com/${/^v\d+\.\d+$/.test(v) ? v : META_GRAPH_VERSION}`
}

/** Meta's error codes that mean "try again later". */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613])

export class MetaGraphError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly subcode: number | null,
    public readonly type: string | null,
    public readonly httpStatus: number,
    public readonly fbtraceId: string | null,
  ) {
    super(message)
  }
  get retryable(): boolean {
    return this.httpStatus >= 500 || (this.code !== null && RETRYABLE_CODES.has(this.code))
  }
}

/** A plain message for the owner; the original Meta text is kept at the end for support. */
export function plainGraphMessage(code: number | null, subcode: number | null, metaMessage: string): string {
  const meta = metaMessage ? ` (Meta says: ${metaMessage.slice(0, 200)})` : ''
  if (code === 190) return `Meta no longer accepts the saved access token. It has expired or been revoked: connect the channel again with a new token.${meta}`
  if (code === 10 || code === 200 || code === 299 || code === 283) {
    return `The access token is missing a permission it needs (pages_manage_posts, pages_read_engagement, instagram_basic, instagram_content_publish). Generate a new token with all of them.${meta}`
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) return `Meta is limiting how often VYRA can call it right now. It will work again later.${meta}`
  if (code === 368) return `Meta has temporarily blocked posting from this account.${meta}`
  if (code === 100) return `Meta did not accept the request (for example a photo it could not download, or an ID that does not exist).${meta}`
  if (code === 1 || code === 2) return `Meta had a temporary problem. Try again in a few minutes.${meta}`
  if (code === 9007 || subcode === 2207027) return `Instagram was not ready to publish the photo yet.${meta}`
  return `Meta refused the request.${meta}`
}

type Params = Record<string, string | number | boolean | undefined>

function clean(params: Params): [string, string][] {
  return Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
}

export interface GraphClient {
  get<T = Record<string, unknown>>(path: string, token: string, params?: Params): Promise<T>
  post<T = Record<string, unknown>>(path: string, token: string, params?: Params): Promise<T>
}

export function graphClient(fetchFn: FetchLike, env: Record<string, string | undefined> = process.env): GraphClient {
  const base = graphBase(env)
  async function call<T>(method: 'GET' | 'POST', path: string, token: string, params: Params): Promise<T> {
    const pairs = clean(params)
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    let url = `${base}/${path.replace(/^\/+/, '')}`
    const init: RequestInit = { method, headers }
    if (method === 'GET') {
      if (pairs.length) url += `?${new URLSearchParams(pairs).toString()}`
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      init.body = new URLSearchParams(pairs).toString()
    }
    let res: Response
    try {
      res = await fetchFn(url, init)
    } catch {
      // The underlying error text can echo the URL; keep it out. The token is never in the URL anyway.
      throw new MetaGraphError('Could not reach Meta. Check the server has internet access and try again.', null, null, null, 0, null)
    }
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    const err = (body as { error?: Record<string, unknown> } | null)?.error
    if (!res.ok || err) {
      const code = typeof err?.code === 'number' ? err.code : null
      const subcode = typeof err?.error_subcode === 'number' ? err.error_subcode : null
      const msg = typeof err?.message === 'string' ? err.message : ''
      throw new MetaGraphError(
        plainGraphMessage(code, subcode, msg), code, subcode,
        typeof err?.type === 'string' ? err.type : null, res.status,
        typeof err?.fbtrace_id === 'string' ? err.fbtrace_id : null,
      )
    }
    return (body ?? {}) as T
  }
  return {
    get: (path, token, params = {}) => call('GET', path, token, params),
    post: (path, token, params = {}) => call('POST', path, token, params),
  }
}

export interface PageLookup {
  pageId: string
  pageName: string | null
  instagramId: string | null
}

/** Check a token (GET /me) and read the Page and its linked Instagram account. */
export async function lookupPage(fetchFn: FetchLike, token: string, pageId: string): Promise<PageLookup> {
  const g = graphClient(fetchFn)
  await g.get('me', token, { fields: 'id,name' })
  const page = await g.get<{ id?: string; name?: string; instagram_business_account?: { id?: string } }>(pageId, token, {
    fields: 'id,name,instagram_business_account',
  })
  return { pageId: page.id ?? pageId, pageName: page.name ?? null, instagramId: page.instagram_business_account?.id ?? null }
}

/** Failure of a connector call as a PublishResult-shaped object. */
export function failureOf(e: unknown): { ok: false; error: string; retryable: boolean; code?: number; uncertain?: boolean } {
  // httpStatus 0 = Meta could not be reached or the connection broke: the request may have arrived.
  if (e instanceof MetaGraphError) return { ok: false, error: e.message, retryable: e.retryable, ...(e.code !== null ? { code: e.code } : {}), ...(e.httpStatus === 0 ? { uncertain: true } : {}) }
  return { ok: false, error: e instanceof Error ? e.message : 'Publishing failed.', retryable: false }
}
