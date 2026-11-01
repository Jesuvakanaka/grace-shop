/**
 * ZP-485: host-based routing, the "two front doors".
 *
 * One Next.js app serves two audiences:
 * - the private back office (admin host, today's UAT URL, local dev), and
 * - the public VYRA storefront (storefront host), whose pages live under
 *   `src/app/site/**` and are served at clean paths (`/shop` -> `/site/shop`).
 *
 * This module is the pure decision; `src/proxy.ts` applies it. Hosts come from
 * GRACE_STOREFRONT_HOSTS / GRACE_ADMIN_HOSTS (comma-separated). With neither set,
 * every host is admin, which is exactly the behaviour before ZP-485.
 */

export interface HostRoutingConfig {
  storefrontHosts: string[];
  adminHosts: string[];
}

export type HostKind = 'storefront' | 'admin';

export type HostRoutingDecision =
  /** Serve as-is. `noindex` adds `X-Robots-Tag: noindex, nofollow`. */
  | { action: 'next'; noindex: boolean }
  /** Serve the storefront page at this internal path (URL stays clean). */
  | { action: 'rewrite'; pathname: string }
  /** Permanent (308) redirect to this clean path. */
  | { action: 'redirect'; pathname: string }
  /** Plain 404, no redirect, no hint that anything lives there. */
  | { action: 'not-found' };

/** The internal path prefix of the storefront pages. */
export const STOREFRONT_PREFIX = '/site';

/**
 * Top-level admin page sections (directories under `src/app/(admin)/`).
 * On the storefront host these are a hard 404. tests/host-routing.test.ts
 * fails if a new admin section is added without listing it here.
 */
export const ADMIN_PAGE_SECTIONS: readonly string[] = [
  'cash',
  'closing',
  'creditors',
  'daily-log',
  'debtors',
  'expenses',
  'import',
  'products',
  'reports',
  'sales',
  'settings',
  'stock-ledger',
  'website',
];

/** API prefixes the storefront may call. Everything else under /api is 404 there. */
const PUBLIC_API_PREFIXES = ['/api/public/', '/api/images/public/', '/api/videos/public/'];

/** Top-level public files: `public/*.ext` and app metadata files (icon, manifest, robots, sitemap). */
const TOP_LEVEL_FILE = /^\/[^/]+\.(?:svg|png|ico|jpe?g|webp|gif|avif|txt|xml|webmanifest|json|woff2?)$/i;

/** `Host` header -> lowercase hostname without port or trailing dot; null if missing. */
export function normalizeHost(host: string | null | undefined): string | null {
  if (host == null) return null;
  let h = host.trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith('[')) {
    // Bracketed IPv6: "[::1]:3485" -> "[::1]"
    const end = h.indexOf(']');
    h = end === -1 ? h : h.slice(0, end + 1);
  } else {
    const colon = h.indexOf(':');
    if (colon !== -1) h = h.slice(0, colon);
  }
  h = h.replace(/\.+$/, '');
  return h || null;
}

/** Parse a comma-separated env value into normalised hostnames. */
export function parseHostList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => normalizeHost(part))
    .filter((h): h is string => h !== null);
}

/** Read the routing config from the environment (defaults: empty = admin everywhere). */
export function hostRoutingConfigFromEnv(env: Record<string, string | undefined> = process.env): HostRoutingConfig {
  return {
    storefrontHosts: parseHostList(env.GRACE_STOREFRONT_HOSTS),
    adminHosts: parseHostList(env.GRACE_ADMIN_HOSTS),
  };
}

function listMatches(list: string[], host: string): boolean {
  return list.includes(host) || (host.startsWith('www.') && list.includes(host.slice(4)));
}

/**
 * Which front door a request came through.
 * - A listed storefront host (or `www.` + one) is the storefront. This wins over
 *   the admin list if a host is (mis)listed in both: least exposure.
 * - Everything else is admin: listed admin hosts, the Cloud Run *.run.app and
 *   tag URLs, startup probes, and a missing Host header. The admin side has its
 *   own sign-in, so falling back to it never exposes data; falling back to the
 *   storefront would break /api/health probes and the UAT URL.
 */
export function classifyHost(host: string | null | undefined, config: HostRoutingConfig): HostKind {
  const h = normalizeHost(host);
  if (h !== null && listMatches(config.storefrontHosts, h)) return 'storefront';
  return 'admin';
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function decideStorefront(pathname: string): HostRoutingDecision {
  const lower = pathname.toLowerCase();

  // Build output and image optimiser.
  if (isUnder(lower, '/_next')) return { action: 'next', noindex: false };

  // APIs: only the explicitly public prefixes.
  if (isUnder(lower, '/api')) {
    return PUBLIC_API_PREFIXES.some((p) => lower.startsWith(p))
      ? { action: 'next', noindex: false }
      : { action: 'not-found' };
  }

  // Admin pages: never on the storefront host, whatever follows the section.
  const firstSegment = lower.split('/')[1] ?? '';
  if (ADMIN_PAGE_SECTIONS.includes(firstSegment)) return { action: 'not-found' };

  // Public assets.
  if (isUnder(lower, '/brand') || TOP_LEVEL_FILE.test(pathname)) return { action: 'next', noindex: false };

  // The internal prefix is not a public URL: send /site/x to /x.
  if (isUnder(lower, STOREFRONT_PREFIX)) {
    const rest = pathname.slice(STOREFRONT_PREFIX.length);
    return { action: 'redirect', pathname: rest === '' || rest === '/' ? '/' : rest };
  }

  return { action: 'rewrite', pathname: pathname === '/' ? STOREFRONT_PREFIX : `${STOREFRONT_PREFIX}${pathname}` };
}

/** The routing decision for one request. Admin requests are untouched apart from noindex. */
export function decideHostRouting(
  request: { host: string | null | undefined; pathname: string },
  config: HostRoutingConfig
): HostRoutingDecision {
  if (classifyHost(request.host, config) === 'storefront') return decideStorefront(request.pathname);
  return { action: 'next', noindex: true };
}
