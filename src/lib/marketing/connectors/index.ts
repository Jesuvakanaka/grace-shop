// VYRA Marketing hub (ZP-1200): kind -> connector. A channel without an entry cannot be published automatically.
import type { Connector } from './types'
import { facebookPageConnector } from './facebook-page'
import { googleBusinessConnector } from './google-business'
import { googleMerchantConnector } from './google-merchant'
import { instagramConnector } from './instagram'
import { pinterestConnector } from './pinterest'
import { telegramConnector } from './telegram'
import { xConnector } from './x'
import { youtubeConnector } from './youtube'
import { tiktokConnector } from './tiktok'
import { threadsConnector } from './threads'
import { whatsappCloudConnector } from './whatsapp-cloud'
import { smsTwilioConnector } from './sms-twilio'
import { emailBrevoConnector } from './email-brevo'

export const CONNECTORS: Readonly<Record<string, Connector>> = {
  FACEBOOK_PAGE: facebookPageConnector,
  INSTAGRAM: instagramConnector,
  PINTEREST: pinterestConnector,
  TELEGRAM: telegramConnector,
  X: xConnector,
  YOUTUBE: youtubeConnector,
  TIKTOK: tiktokConnector,
  THREADS: threadsConnector,
  GOOGLE_BUSINESS: googleBusinessConnector,
  GOOGLE_MERCHANT: googleMerchantConnector,
  WHATSAPP_CLOUD: whatsappCloudConnector,
  SMS: smsTwilioConnector,
  EMAIL: emailBrevoConnector,
}

export const getConnector = (kind: string): Connector | undefined => CONNECTORS[kind]
