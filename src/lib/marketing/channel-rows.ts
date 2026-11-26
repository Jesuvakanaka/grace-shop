// VYRA Marketing hub (ZP-1200): the channel list for the API (registry merged with saved rows). Server only.
// credentialsEnc is never part of the output.
import type { MarketingChannel } from '@prisma/client'
import type { Db } from './audit'
import { CHANNELS, type ChannelDef } from './channels'

export interface ChannelRowDto {
  id: number
  status: string
  name: string
  externalId: string | null
  tokenHint: string | null
  connectedAt: Date | null
  lastError: string | null
}

export type ChannelListItem = ChannelDef & { channel: ChannelRowDto | null; effectiveStatus: string }

export const toChannelRowDto = (r: MarketingChannel): ChannelRowDto => ({
  id: r.id,
  status: r.status,
  name: r.name,
  externalId: r.externalId,
  tokenHint: r.tokenHint,
  connectedAt: r.connectedAt,
  lastError: r.lastError,
})

export async function listChannels(db: Db): Promise<ChannelListItem[]> {
  const rows = await db.marketingChannel.findMany({ orderBy: { id: 'asc' } })
  return CHANNELS.map((def) => {
    const row = rows.find((r) => r.kind === def.kind)
    return {
      ...def,
      channel: row ? toChannelRowDto(row) : null,
      effectiveStatus: row?.status ?? (def.mode === 'manual' ? 'MANUAL' : 'NOT_CONNECTED'),
    }
  })
}
