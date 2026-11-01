// ZP-489: server glue for the listing pages (/shop, /collections/<slug>, /new).
// Server only. Data comes from the cached public data layer (./index) and the
// shell data (React-cached); the pure rules live in ./listing-query.
import 'server-only'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getPublishedCategory, listPublishedProducts } from './index'
import {
  canonicalUrl,
  listingHref,
  loadListing,
  parseListingQuery,
  requestOrigin,
  sortForScope,
  type ListingQuery,
  type ListingScope,
  type ListingSearchParams,
  type ListingSort,
} from './listing-query'
import { SITE_ROUTES, sitePath } from './paths'
import { getShellData, type ShellData } from './shell'
import { getSiteBase } from './site-base'
import type { PublicCategory } from './dto'
import type { PublicProductPage } from './catalogue'

/** "https://host" for this request, or null. */
export async function getRequestOrigin(): Promise<string | null> {
  const h = await headers()
  // The Host header, like getSiteBase() and src/proxy.ts (not X-Forwarded-Host).
  return requestOrigin(h.get('host'), h.get('x-forwarded-proto'))
}

/** Page metadata with a canonical URL that never carries sort, filter or page. */
export async function listingMetadata(route: string, meta: { title: string; description?: string | null }): Promise<Metadata> {
  const [origin, base] = await Promise.all([getRequestOrigin(), getSiteBase()])
  return {
    title: meta.title,
    ...(meta.description ? { description: meta.description } : {}),
    alternates: { canonical: canonicalUrl(origin, base, route) },
  }
}

export type ListingChip = { label: string; value: string; href: string }

export type ListingView = {
  shell: ShellData
  category: PublicCategory | null
  page: PublicProductPage
  query: ListingQuery
  sortOptions: { label: string; value: ListingSort }[]
  /** This listing's link (through sitePath, no query). */
  path: string
  chips: ListingChip[]
  activeChip: string
}

export const CHIP_ALL = 'all'
export const CHIP_NEW = 'new'
export const chipForCategory = (slug: string) => `c:${slug}`

/**
 * Loads one listing page: notFound() for an unknown or unpublished category,
 * redirect() for a page past the end; invalid query values fall back to
 * their defaults.
 */
export async function getListingView(
  scope: ListingScope,
  route: string,
  searchParams: ListingSearchParams,
): Promise<ListingView> {
  const shell = await getShellData()
  const path = sitePath(shell.base, route)
  const result = await loadListing(
    { listPublishedProducts, getPublishedCategory },
    scope,
    parseListingQuery(searchParams),
    path,
  )
  if (result.kind === 'notFound') notFound()
  if (result.kind === 'redirect') redirect(result.to)

  // Chips keep the current filter, and the current sort unless it is a price
  // sort the target listing does not allow (in memory, from the cached catalogue).
  const source = { listPublishedProducts, getPublishedCategory }
  const targets: { label: string; value: string; route: string; scope: ListingScope }[] = [
    { label: 'All', value: CHIP_ALL, route: SITE_ROUTES.shop, scope: { kind: 'all' } },
    { label: 'New arrivals', value: CHIP_NEW, route: SITE_ROUTES.newArrivals, scope: { kind: 'new' } },
    ...shell.categories.map((c) => ({
      label: c.name,
      value: chipForCategory(c.slug),
      route: SITE_ROUTES.collection(c.slug),
      scope: { kind: 'category', slug: c.slug } as const,
    })),
  ]
  const chips: ListingChip[] = await Promise.all(
    targets.map(async (t) => ({
      label: t.label,
      value: t.value,
      href: listingHref(sitePath(shell.base, t.route), {
        sort: await sortForScope(source, t.scope, result.query),
        hideSoldOut: result.query.hideSoldOut,
      }),
    })),
  )
  const activeChip =
    scope.kind === 'all' ? CHIP_ALL : scope.kind === 'new' ? CHIP_NEW : chipForCategory(result.category?.slug ?? '')

  return {
    shell,
    category: result.category,
    page: result.page,
    query: result.query,
    sortOptions: result.sortOptions,
    path,
    chips,
    activeChip,
  }
}
