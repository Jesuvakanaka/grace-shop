// ZP-486: which settings the admin form actually changed. Pure; client-safe.
// The form sends only these to PUT /api/website/settings (a partial update),
// so a save never rewrites fields the owner did not touch.

/** Stable JSON (sorted object keys) so key order never counts as a change. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * Fields of `current` whose value differs from `baseline`. A map pin needs
 * both coordinates, so latitude and longitude are always sent together.
 */
export function changedSettings(
  current: Record<string, unknown>,
  baseline: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(current)) {
    if (stable(current[key]) !== stable(baseline[key])) out[key] = current[key]
  }
  if ('latitude' in out || 'longitude' in out) {
    out.latitude = current.latitude ?? null
    out.longitude = current.longitude ?? null
  }
  return out
}
