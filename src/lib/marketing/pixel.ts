// VYRA Marketing hub (ZP-1200): the browser Meta Pixel on the public storefront, strictly behind the pixel gate.
// The gate (checkPixelGate): GRACE_MARKETING_LIVE=true AND settings.liveEnabled AND a Pixel ID in the settings AND a
// CONNECTED META_ADS channel with credentials. When it does not pass (the default) the storefront renders exactly as
// before: no script, no extra markup (the layout and the product page only add anything when this returns a Pixel ID).
// Docs (base code and standard events): https://developers.facebook.com/docs/meta-pixel/get-started  (checked 2026-11-26).
import type { Db } from './audit'
import { liveAllowedByEnv } from './flags'
import { checkPixelGate, type PixelGateInput } from './connectors/meta-pixel'
import { getSettings } from './settings'

/** `{ pixelId }` only when every gate passes (live env, live setting, a Pixel ID, a connected ad account); otherwise null. */
export function pixelConfigForStorefront(input: PixelGateInput): { pixelId: string } | null {
  const c = checkPixelGate(input)
  if (!c.ok) return null
  // The ID goes into inline script: digits only, or nothing loads.
  return /^\d{5,20}$/.test(c.pixelId) ? { pixelId: c.pixelId } : null
}

/** The same, read from the database. Fails closed: any error means no Pixel. No database read at all unless the live env is on. */
export async function loadPixelConfigForStorefront(db: Db, env?: Record<string, string | undefined>): Promise<{ pixelId: string } | null> {
  if (!liveAllowedByEnv(env ?? process.env)) return null
  try {
    const settings = await getSettings(db)
    const channel = await db.marketingChannel.findFirst({ where: { kind: 'META_ADS', status: 'CONNECTED' }, orderBy: { id: 'asc' } })
    return pixelConfigForStorefront({ settings, channel, env })
  } catch {
    return null
  }
}

/** Meta's base code: loads fbevents.js, sets the Pixel up and sends PageView. `pixelId` must already be digits only. */
export function pixelBaseSnippet(pixelId: string): string {
  if (!/^\d{5,20}$/.test(pixelId)) throw new Error('The Pixel ID must be digits only.')
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`
}
