// ZP-487: the storefront link base for the current request. Server only
// (reads the request headers, so the calling route renders dynamically).
import { headers } from 'next/headers'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import { siteBaseForHost, type SiteBase } from './paths'

/**
 * "/site" on the admin/UAT host, "" on a storefront host. Uses the same Host
 * header and GRACE_STOREFRONT_HOSTS config as src/proxy.ts, so links always
 * match how the request was routed.
 */
export async function getSiteBase(): Promise<SiteBase> {
  const h = await headers()
  return siteBaseForHost(h.get('host'), hostRoutingConfigFromEnv())
}
