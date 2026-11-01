// ZP-493: the visit context sent once with visit_start. Pure; runs in the browser.
//
// Only coarse values leave the browser: a referrer bucket and the referring
// domain (never the full referrer URL), a campaign tag, the device class,
// the viewport size, the language and the landing path (no query string).
import type { DeviceClass, ReferrerBucket } from './events'

type KnownBucket = Exclude<ReferrerBucket, 'direct' | 'other'>

/** Domain -> bucket. Matches the domain itself and any subdomain of it. */
const DOMAIN_BUCKETS: ReadonlyArray<[RegExp, KnownBucket]> = [
  [/(^|\.)(instagram\.com|ig\.me)$/, 'instagram'],
  [/(^|\.)(tiktok\.com|tiktokv\.com)$/, 'tiktok'],
  [/(^|\.)(whatsapp\.com|whatsapp\.net|wa\.me)$/, 'whatsapp'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, 'facebook'],
  [/(^|\.)google\.[a-z.]{2,8}$/, 'google'],
]

/** `?src=` / `utm_source` values that name a known source (for in-app browsers that send no referrer). */
const SOURCE_TAGS: ReadonlyArray<[RegExp, KnownBucket]> = [
  [/^(ig|insta|instagram)([_-].*)?$/, 'instagram'],
  [/^(tt|tiktok)([_-].*)?$/, 'tiktok'],
  [/^(wa|whatsapp)([_-].*)?$/, 'whatsapp'],
  [/^(fb|facebook|meta|messenger)([_-].*)?$/, 'facebook'],
  [/^(google|gmb|gbp)([_-].*)?$/, 'google'],
]

const stripWww = (host: string) => host.replace(/^www\./, '')

function bucketForDomain(host: string): KnownBucket | null {
  for (const [pattern, bucket] of DOMAIN_BUCKETS) if (pattern.test(host)) return bucket
  return null
}

function bucketForTag(tag: string | undefined): KnownBucket | null {
  if (!tag) return null
  for (const [pattern, bucket] of SOURCE_TAGS) if (pattern.test(tag)) return bucket
  return null
}

export const CAMPAIGN_MAX_LENGTH = 40

/** Lowercase, words joined by "-", only [a-z0-9_-], at most 40 characters; zero-width characters removed. */
function normalizeTag(raw: string | null): string | undefined {
  if (!raw) return undefined
  const tag = raw
    .replace(/[​-‍⁠﻿]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, CAMPAIGN_MAX_LENGTH)
    .replace(/[_-]+$/, '')
  return tag || undefined
}

function searchParams(search: string): URLSearchParams {
  try {
    return new URLSearchParams(search)
  } catch {
    return new URLSearchParams()
  }
}

/** The campaign tag: `?src=`, else `utm_campaign`, else `utm_source`. */
export function campaignFromSearch(search: string): string | undefined {
  const params = searchParams(search)
  return (
    normalizeTag(params.get('src')) ?? normalizeTag(params.get('utm_campaign')) ?? normalizeTag(params.get('utm_source'))
  )
}

/**
 * Referrer bucket (+ referring domain when there is one). The own site
 * (internal navigation, reloads) counts as direct. With no referrer, which
 * is what Instagram / TikTok / WhatsApp in-app browsers usually send, a
 * known `?src=` or `utm_source` tag decides the bucket.
 */
export function visitSource(referrer: string, search: string, ownHost: string): { ref: ReferrerBucket; refDomain?: string } {
  const own = stripWww(ownHost.toLowerCase().replace(/:\d+$/, ''))
  if (referrer) {
    let url: URL | null = null
    try {
      url = new URL(referrer)
    } catch {
      return { ref: 'other' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ref: 'other' }
    const host = stripWww(url.hostname.toLowerCase())
    if (!host) return { ref: 'other' }
    if (host !== own) {
      const refDomain = host.length <= 100 ? host : undefined
      const bucket = bucketForDomain(host)
      return refDomain ? { ref: bucket ?? 'other', refDomain } : { ref: bucket ?? 'other' }
    }
  }
  const params = searchParams(search)
  const tagged = bucketForTag(normalizeTag(params.get('src'))) ?? bucketForTag(normalizeTag(params.get('utm_source')))
  return { ref: tagged ?? 'direct' }
}

/** Phone / tablet / desktop from the user agent, touch support and width. */
export function deviceClass(input: { userAgent: string; maxTouchPoints?: number; width: number }): DeviceClass {
  const ua = input.userAgent
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return 'tablet'
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'phone' : 'tablet'
  if (/iPhone|iPod|Mobi|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) return 'phone'
  // iPadOS 13+ says "Macintosh"; only touch tells it apart from a Mac.
  if (/Macintosh/i.test(ua) && (input.maxTouchPoints ?? 0) > 1) return 'tablet'
  if ((input.maxTouchPoints ?? 0) > 1 && input.width > 0 && input.width < 600) return 'phone'
  return 'desktop'
}

/**
 * The page an event happened on: the path only (never the query string,
 * which may hold a preview token or campaign), without the internal /site
 * prefix so UAT and the storefront host read the same, no trailing slash,
 * at most 200 characters.
 */
export function normalizePage(pathname: string): string {
  let p = pathname || '/'
  if (p === '/site' || p.startsWith('/site/')) p = p.slice('/site'.length) || '/'
  if (!p.startsWith('/')) p = `/${p}`
  if (p.length > 1) p = p.replace(/\/+$/, '') || '/'
  p = p.replace(/[^A-Za-z0-9\-._~%!$&'()*+,;=:@/]/g, (c) => encodeURIComponent(c))
  return p.slice(0, 200)
}
