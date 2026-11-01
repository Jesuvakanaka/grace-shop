// ZP-486: the public (storefront) view of the site settings. Pure.
//
// Allow-listed: the storefront only ever sees what is built here. Audit
// columns (updatedBy, timestamps) and raw storage keys are never included.
import { isValidImageKey, PRODUCT_IMAGE_PREFIX } from '@/lib/storage/keys'
import type { OpeningHours, SiteSettingsData } from './schema'

/**
 * Public URL for a settings picture: /api/images/public/<hash>.webp.
 *
 * KNOWN GAP (see docs/storefront/site-settings.md): the public image route
 * (ZP-484) only serves keys that belong to published products or categories,
 * so it will not serve these yet. It must also allow the keys referenced by
 * SiteSettings (or settings pictures must move to their own prefix).
 */
export const PUBLIC_IMAGE_URL_PREFIX = '/api/images/public/'

export function publicSettingsImageUrl(key: string | null | undefined): string | null {
  if (!key || !isValidImageKey(key)) return null
  return `${PUBLIC_IMAGE_URL_PREFIX}${key.slice(PRODUCT_IMAGE_PREFIX.length)}`
}

/** Every storage key the settings reference (for the public image allow-list). */
export function settingsImageKeys(s: SiteSettingsData): string[] {
  return [s.aboutImageKey, s.heroImageKeyDesktop, s.heroImageKeyMobile, s.seoShareImageKey].filter(
    (k): k is string => !!k && isValidImageKey(k),
  )
}

export type PublicSiteSettings = {
  contacts: {
    whatsappNumber: string | null
    enquiryTemplate: string
    generalEnquiryMessage: string
    phone: string | null
    email: string | null
  }
  visit: {
    address: string | null
    hours: OpeningHours | null
    holidayNote: string | null
    mapUrl: string | null
    latitude: number | null
    longitude: number | null
  }
  social: { instagram: string | null; facebook: string | null; tiktok: string | null }
  about: { headline: string | null; story: string | null; imageUrl: string | null }
  home: {
    heroHeadline: string
    heroSubline: string
    heroImageUrls: { desktop: string | null; mobile: string | null }
    statement: string
    trustLabels: [string, string, string]
  }
  seo: { title: string; description: string; shareImageUrl: string | null }
  /** Availability "few left" threshold (pass to getAvailability). */
  fewLeftThreshold: number
  /** Show the internal item number publicly ("Ref AUG-45"). */
  showItemNumber: boolean
  /** ZP-508: the optional "Review us on Google" link (validated https Google link). */
  reviews: { googleReviewUrl: string | null }
}

export function toPublicSiteSettings(s: SiteSettingsData): PublicSiteSettings {
  return {
    contacts: {
      whatsappNumber: s.whatsappNumber,
      enquiryTemplate: s.enquiryTemplate,
      generalEnquiryMessage: s.generalEnquiryMessage,
      phone: s.phone,
      email: s.email,
    },
    visit: {
      address: s.address,
      hours: s.openingHours,
      holidayNote: s.holidayNote,
      mapUrl: s.mapUrl,
      latitude: s.latitude,
      longitude: s.longitude,
    },
    social: { instagram: s.instagramUrl, facebook: s.facebookUrl, tiktok: s.tiktokUrl },
    about: { headline: s.aboutHeadline, story: s.aboutStory, imageUrl: publicSettingsImageUrl(s.aboutImageKey) },
    home: {
      heroHeadline: s.heroHeadline,
      heroSubline: s.heroSubline,
      heroImageUrls: {
        desktop: publicSettingsImageUrl(s.heroImageKeyDesktop),
        mobile: publicSettingsImageUrl(s.heroImageKeyMobile),
      },
      statement: s.statement,
      trustLabels: [s.trustLabel1, s.trustLabel2, s.trustLabel3],
    },
    seo: { title: s.seoTitle, description: s.seoDescription, shareImageUrl: publicSettingsImageUrl(s.seoShareImageKey) },
    fewLeftThreshold: s.fewLeftThreshold,
    showItemNumber: s.showItemNumber,
    reviews: { googleReviewUrl: s.googleReviewUrl },
  }
}
