// VYRA Marketing hub (ZP-1200): kind -> connector. A channel without an entry cannot be published automatically.
import type { Connector } from './types'
import { facebookPageConnector } from './facebook-page'
import { instagramConnector } from './instagram'
import { pinterestConnector } from './pinterest'
import { telegramConnector } from './telegram'
import { xConnector } from './x'
import { youtubeConnector } from './youtube'
import { tiktokConnector } from './tiktok'

export const CONNECTORS: Readonly<Record<string, Connector>> = {
  FACEBOOK_PAGE: facebookPageConnector,
  INSTAGRAM: instagramConnector,
  PINTEREST: pinterestConnector,
  TELEGRAM: telegramConnector,
  X: xConnector,
  YOUTUBE: youtubeConnector,
  TIKTOK: tiktokConnector,
}

export const getConnector = (kind: string): Connector | undefined => CONNECTORS[kind]
