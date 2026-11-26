// VYRA Marketing hub (ZP-1200): what the storefront would need to load the browser Pixel.
// NOT wired into the storefront yet: the storefront integration and the visitor privacy notice text
// are a later step (the browser script must not load before the notice and consent wording exist).
import type { Db } from './audit'
import { checkPixelGate, type PixelGateInput } from './connectors/meta-pixel'
import { getSettings } from './settings'

/** `{ pixelId }` only when every gate passes (live env, live setting, a Pixel ID, a connected ad account); otherwise null. */
export function pixelConfigForStorefront(input: PixelGateInput): { pixelId: string } | null {
  const c = checkPixelGate(input)
  return c.ok ? { pixelId: c.pixelId } : null
}

/** The same, read from the database. */
export async function loadPixelConfigForStorefront(db: Db, env?: Record<string, string | undefined>): Promise<{ pixelId: string } | null> {
  const settings = await getSettings(db)
  const channel = await db.marketingChannel.findFirst({ where: { kind: 'META_ADS', status: 'CONNECTED' }, orderBy: { id: 'asc' } })
  return pixelConfigForStorefront({ settings, channel, env })
}
