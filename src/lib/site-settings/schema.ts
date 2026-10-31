// ZP-486: types, defaults and limits of the VYRA site settings. Pure; safe to
// import from client components (the admin form) and the server.
//
// The defaults here must equal the column defaults in prisma/schema.prisma
// (the migration seeds the row from those). tests/migration-site-settings.test.ts
// checks that the seeded row equals SITE_SETTINGS_DEFAULTS.

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Day = (typeof DAYS)[number]

export const DAY_LABELS: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

/** One day's hours. Times are 24h "HH:MM", close after open. */
export type DayHours = { closed: true } | { closed: false; open: string; close: string }
export type OpeningHours = Record<Day, DayHours>

/** Every field the owner can edit. Matches the SiteSettings columns minus id/audit. */
export type SiteSettingsData = {
  // Contacts
  whatsappNumber: string | null
  enquiryTemplate: string
  generalEnquiryMessage: string
  phone: string | null
  email: string | null
  // Visit us
  address: string | null
  openingHours: OpeningHours | null
  holidayNote: string | null
  mapUrl: string | null
  latitude: number | null
  longitude: number | null
  // Social
  instagramUrl: string | null
  facebookUrl: string | null
  tiktokUrl: string | null
  // About
  aboutHeadline: string | null
  aboutStory: string | null
  aboutImageKey: string | null
  // Home
  heroHeadline: string
  heroSubline: string
  heroImageKeyDesktop: string | null
  heroImageKeyMobile: string | null
  statement: string
  trustLabel1: string
  trustLabel2: string
  trustLabel3: string
  // SEO defaults
  seoTitle: string
  seoDescription: string
  seoShareImageKey: string | null
  // Availability / product display
  fewLeftThreshold: number
  showItemNumber: boolean
}

export type SiteSettingsField = keyof SiteSettingsData

export const SITE_SETTINGS_DEFAULTS: Readonly<SiteSettingsData> = Object.freeze({
  whatsappNumber: null,
  enquiryTemplate: "Hi VYRA, I'm interested in {product} ({url})",
  generalEnquiryMessage: "Hi VYRA, I'd like to ask about your collection.",
  phone: null,
  email: null,
  address: null,
  openingHours: null,
  holidayNote: null,
  mapUrl: null,
  latitude: null,
  longitude: null,
  instagramUrl: null,
  facebookUrl: null,
  tiktokUrl: null,
  aboutHeadline: null,
  aboutStory: null,
  aboutImageKey: null,
  heroHeadline: 'Style Your Way',
  heroSubline: 'Premium fashion. Modern you.',
  heroImageKeyDesktop: null,
  heroImageKeyMobile: null,
  statement: 'Confidence in every stitch',
  trustLabel1: 'Premium Quality',
  trustLabel2: 'Visit Our Store',
  trustLabel3: 'Enquire on WhatsApp',
  seoTitle: 'VYRA',
  seoDescription: 'Premium fashion. Modern you.',
  seoShareImageKey: null,
  fewLeftThreshold: 3,
  showItemNumber: false,
})

/** The PUT allow-list. Anything else in a request body is rejected. */
export const EDITABLE_FIELDS = Object.freeze(Object.keys(SITE_SETTINGS_DEFAULTS) as SiteSettingsField[])

/** Placeholders the enquiry template may use (see buildWhatsAppLink). */
export const TEMPLATE_PLACEHOLDERS = ['product', 'url', 'colour', 'size'] as const

export const FEW_LEFT_MIN = 1
export const FEW_LEFT_MAX = 50

/** Maximum lengths (characters, after trimming). */
export const MAX_LENGTH = {
  enquiryTemplate: 500,
  generalEnquiryMessage: 500,
  phone: 30,
  email: 254,
  address: 500,
  holidayNote: 300,
  url: 500,
  aboutHeadline: 120,
  aboutStory: 2000,
  heroHeadline: 120,
  heroSubline: 200,
  statement: 120,
  trustLabel: 40,
  seoTitle: 70,
  seoDescription: 300,
} as const

/** Allowed host names (and their subdomains) per social link. */
export const SOCIAL_DOMAINS = {
  instagramUrl: ['instagram.com'],
  facebookUrl: ['facebook.com', 'fb.com'],
  tiktokUrl: ['tiktok.com'],
} as const
