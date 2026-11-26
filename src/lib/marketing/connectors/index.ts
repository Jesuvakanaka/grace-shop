// VYRA Marketing hub (ZP-1200): kind -> connector. A channel without an entry cannot be published automatically.
import type { Connector } from './types'
import { facebookPageConnector } from './facebook-page'
import { instagramConnector } from './instagram'

export const CONNECTORS: Readonly<Record<string, Connector>> = {
  FACEBOOK_PAGE: facebookPageConnector,
  INSTAGRAM: instagramConnector,
}

export const getConnector = (kind: string): Connector | undefined => CONNECTORS[kind]
