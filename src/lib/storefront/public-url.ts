// Absolute storefront URLs (ZP-490 product links, ZP-489 canonical URLs). Pure.
//
// One rule for every absolute storefront URL:
// - On the storefront (base ""), the origin is the FIRST configured storefront
//   host (GRACE_STOREFRONT_HOSTS), always https. The request's Host header is
//   never used there, so neither a spoofed Host nor www-vs-apex changes it.
// - On the admin/UAT host (base "/site"), the request's Host header, validated
//   as a plain host[:port] (port 1-65535), plus "/site"; http only for
//   localhost / 127.0.0.1 / [::1] / *.localhost.
// - X-Forwarded-Host and X-Forwarded-Proto are never read.
// - Anything malformed gives null (callers then leave the URL out).
import { STOREFRONT_PREFIX } from '@/lib/host-routing'
import { sitePath, type SiteBase } from './paths'

/** host[:port]: DNS name or IPv4, or a bracketed IPv6 address; port 1-65535. */
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/
const LOCAL = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$|\.localhost(?::\d+)?$/

/** A lower-cased, validated host[:port], or null. */
export function cleanHost(host: string | null | undefined): string | null {
  const h = (host ?? '').trim().toLowerCase()
  if (h.length > 260) return null
  const m = HOST.exec(h)
  if (!m) return null
  if (m[1] !== undefined) {
    const port = Number(m[1])
    if (port < 1 || port > 65535) return null
  }
  return h
}

/** The first valid configured storefront host, or null. */
export function primaryStorefrontHost(storefrontHosts: readonly string[]): string | null {
  return storefrontHosts.map(cleanHost).find((h): h is string => h !== null) ?? null
}

/**
 * The absolute URL of a clean storefront path ("/shop", "/p/x") for `base`,
 * or null. Any query or hash on `path` is kept; strip it first if unwanted.
 */
export function absoluteSiteUrl(input: {
  base: SiteBase
  path: string
  storefrontHosts: readonly string[]
  host: string | null | undefined
}): string | null {
  if (input.base === '') {
    const configured = primaryStorefrontHost(input.storefrontHosts)
    return configured ? `https://${configured}${sitePath('', input.path)}` : null
  }
  const host = cleanHost(input.host)
  if (!host) return null
  return `${LOCAL.test(host) ? 'http' : 'https'}://${host}${sitePath(STOREFRONT_PREFIX, input.path)}`
}
