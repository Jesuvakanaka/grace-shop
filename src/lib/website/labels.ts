// Admin wording for the website tools (ZP-483). Pure; safe in client components.
import type { PublishMissing } from '@/lib/storefront-model'

export type WebsiteStatus = 'PUBLISHED' | 'DRAFT' | 'NOT_READY'

export const WEBSITE_STATUS_LABEL: Record<WebsiteStatus, string> = {
  PUBLISHED: 'Published',
  DRAFT: 'Draft',
  NOT_READY: 'Not ready',
}

/**
 * Published, Draft (ready but not published) or Not ready. Readiness here
 * ignores 'slug': publishing generates one.
 */
export function websiteStatus(published: boolean, missing: readonly PublishMissing[]): WebsiteStatus {
  if (published) return 'PUBLISHED'
  return missing.some((m) => m !== 'slug') ? 'NOT_READY' : 'DRAFT'
}

const MISSING_LABEL: Record<PublishMissing, string> = {
  'display name': 'Add a name',
  image: 'Add a photo',
  category: 'Choose a category',
  slug: 'Set a web address',
}

/** "Add a photo · Choose a category". 'slug' is left out: publishing adds one. */
export function describeMissing(missing: readonly PublishMissing[]): string {
  return missing
    .filter((m) => m !== 'slug')
    .map((m) => MISSING_LABEL[m] ?? m)
    .join(' · ')
}

export const PUBLIC_NAME_MAX = 120
export const PUBLIC_DESCRIPTION_MAX = 2000
export const SHORT_TEXT_MAX = 200
export const ALT_TEXT_MAX = 200
export const CATEGORY_NAME_MAX = 80
export const CATEGORY_DESCRIPTION_MAX = 1000
/** Most rows one bulk action may touch. */
export const BULK_MAX_IDS = 500
/** Most photos per product. */
export const GALLERY_MAX_IMAGES = 20

export const CONFLICT_MESSAGE = 'Someone else just changed this – try again'

export const DESCRIPTION_HINT =
  'One-line hook, then fabric, fit and colours. Available in-store and on WhatsApp.'
export const PHOTO_GUIDANCE = '4:5 portrait, at least 1600px, plain background'
