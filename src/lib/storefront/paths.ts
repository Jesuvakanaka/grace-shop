// ZP-487: storefront links on both front doors. Pure; safe on the client and server.
//
// The storefront pages live under src/app/site/**. On the admin/UAT host they
// are served at /site/... ; on a storefront host (GRACE_STOREFRONT_HOSTS) the
// proxy rewrites clean paths onto them (src/lib/host-routing.ts). Every
// internal storefront link is therefore written as a clean path from
// SITE_ROUTES and passed through sitePath(base, path), with `base` from
// getSiteBase() (server, ./site-base.ts) or useSiteBase() (client components).
import { classifyHost, STOREFRONT_PREFIX, type HostRoutingConfig } from '@/lib/host-routing'

/** "/site" on the admin/UAT host, "" on a storefront host. */
export type SiteBase = '' | typeof STOREFRONT_PREFIX

/** The clean storefront paths. Page builders link to these (through sitePath). */
export const SITE_ROUTES = {
  home: '/',
  shop: '/shop',
  collections: '/collections',
  collection: (slug: string) => `/collections/${encodeURIComponent(slug)}`,
  newArrivals: '/new',
  about: '/about',
  visit: '/visit',
  privacy: '/privacy',
  product: (slug: string) => `/p/${encodeURIComponent(slug)}`,
  /** ZP-508: the one-time customer review form. */
  review: (token: string) => `/review/${encodeURIComponent(token)}`,
} as const

/** The site base for a request's Host header. */
export function siteBaseForHost(host: string | null | undefined, config: HostRoutingConfig): SiteBase {
  return classifyHost(host, config) === 'storefront' ? '' : STOREFRONT_PREFIX
}

/** Absolute URLs, protocol-relative URLs, mailto:/tel: and in-page "#" links. */
const NOT_A_SITE_PATH = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

/**
 * A clean storefront path ("/shop", "/", "/p/x?y#z") as a link for this host.
 * Links that are not site paths (https://wa.me/..., mailto:, "#main") are
 * returned unchanged. An already internal "/site/..." path is never
 * prefixed twice (and loses the prefix on the storefront host).
 */
export function sitePath(base: SiteBase, path: string): string {
  if (NOT_A_SITE_PATH.test(path)) return path
  let p = path.startsWith('/') ? path : `/${path}`
  const end = p.search(/[?#]/)
  let pathname = end === -1 ? p : p.slice(0, end)
  const suffix = end === -1 ? '' : p.slice(end)
  if (pathname === STOREFRONT_PREFIX || pathname.startsWith(`${STOREFRONT_PREFIX}/`)) {
    pathname = pathname.slice(STOREFRONT_PREFIX.length) || '/'
  }
  p = pathname
  if (base === '') return `${p}${suffix}`
  return `${base}${p === '/' ? '' : p}${suffix}`
}
