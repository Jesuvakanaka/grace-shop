// ZP-514: metadata of the folded addresses (they render the feed but keep
// their own title, description, canonical and share picture). Server only.
import 'server-only'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import { absoluteSiteUrl } from './public-url'
import { getSiteBase } from './site-base'

/** Title, description, canonical (this address, never a query) and Open Graph / Twitter with an optional picture. */
export async function routeMetadata(
  route: string,
  meta: { title: string; description?: string | null; image?: { url: string; alt: string } | null },
): Promise<Metadata> {
  const [h, base] = await Promise.all([headers(), getSiteBase()])
  const canonical = absoluteSiteUrl({ base, path: route, storefrontHosts: hostRoutingConfigFromEnv().storefrontHosts, host: h.get('host') })
  const origin = canonical ? new URL(canonical).origin : null
  const images = meta.image && origin ? [{ url: `${origin}${meta.image.url}`, alt: meta.image.alt }] : undefined
  const description = meta.description ?? undefined
  return {
    title: meta.title,
    ...(description ? { description } : {}),
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: { title: `${meta.title} – VYRA`, description, url: canonical ?? undefined, images, type: 'website' },
    twitter: { card: images ? 'summary_large_image' : 'summary', title: `${meta.title} – VYRA`, description, images },
  }
}
