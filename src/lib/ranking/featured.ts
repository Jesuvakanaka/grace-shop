// ZP-506: admin rules around the automatic Featured set and the cover photo.
// Pure; safe on the client and the server. Tested in tests/ranking.test.ts.

export const FEATURED_AUTO_MESSAGE =
  'Featured is set automatically by popularity. To choose by hand, switch the feed to "Newest first" in Website settings.'

type Result<T> = { ok: true; data: T } | { ok: false; error: string; field: string }

/**
 * While ranking is automatic, Featured cannot be set by hand. A patch that
 * sends the value it already has (an older form) is accepted, without
 * `featured`; a patch that would change it is refused. With "Newest first"
 * the owner chooses Featured by hand again.
 */
export function featuredPatchCheck<T extends object>(patch: T, state: { auto: boolean; current: boolean }): Result<T> {
  const featured = (patch as { featured?: unknown }).featured
  if (featured === undefined || !state.auto) return { ok: true, data: patch }
  if (featured !== state.current) return { ok: false, error: FEATURED_AUTO_MESSAGE, field: 'featured' }
  const rest = { ...patch } as T & { featured?: unknown }
  delete rest.featured
  return { ok: true, data: rest }
}

/**
 * Gallery order for "Use as first photo" (Insights): `imageId` first, the
 * others in their current order. null when the photo is no longer in the
 * gallery. Sent to PUT /api/website/products/:id/images ({ order }).
 */
export function coverFirstOrder(currentIds: readonly number[], imageId: number): number[] | null {
  if (!currentIds.includes(imageId)) return null
  return [imageId, ...currentIds.filter((id) => id !== imageId)]
}
