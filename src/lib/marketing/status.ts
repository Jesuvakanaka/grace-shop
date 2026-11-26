// VYRA Marketing hub (ZP-1200): what the screens need to know about the go-live switches. Server only.
import type { Db } from './audit'
import { liveAllowedByEnv } from './flags'
import { getSettings } from './settings'

export interface HubStatus {
  enabled: true
  live: { env: boolean; settings: boolean; connectedChannels: number }
}

export async function getHubStatus(db: Db, env: Record<string, string | undefined> = process.env): Promise<HubStatus> {
  const settings = await getSettings(db)
  const connectedChannels = await db.marketingChannel.count({ where: { status: 'CONNECTED', credentialsEnc: { not: null } } })
  return { enabled: true, live: { env: liveAllowedByEnv(env), settings: settings.liveEnabled, connectedChannels } }
}
