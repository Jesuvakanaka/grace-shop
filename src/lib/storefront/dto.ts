// Public DTOs for the VYRA storefront (ZP-484). Pure.
//
// Security boundary: every public object is built here from an explicit
// allow-list of fields. Raw Prisma rows never leave src/lib/storefront.
// Cost, wholesale, quantity, source, notes, item number (unless opted in),
// createdBy/updatedBy and database ids are never copied. (ZP-504: the public
// enquiry `ref` "V-0099" is derived from the id by owner decision; the raw id
// key is still never copied.)
// See docs/storefront/public-data-layer.md.
import { isValidImageKey } from '@/lib/storage/keys'
import { publicProductRef } from './product-ref'
import { isValidPosterKey, isValidVideoKey, publicVideoUrl } from '@/lib/storage/video-keys'
import { publicImageSrc, publicImageSrcSet } from './image-sizes'
import {
  compareGalleryImages,
  displayName,
  FEW_LEFT_THRESHOLD,
  getAvailability,
  isNewArrival,
  publicPriceUsd,
  type Availability,
  type PriceDisplayValue,
} from '@/lib/storefront-model'

export { PUBLIC_IMAGE_URL_PREFIX } from './image-sizes'

/** Public URL (original size) for a storage key ("products/<32 hex>.webp"). Throws for an invalid key. */
export function publicImageUrl(key: string): string {
  return publicImageSrc(key)
}

export type PublicImage = {
  /** Original size. */
  url: string
  /** For <img srcset>: every allowed width up to 1200. The component supplies `sizes`. */
  srcSet: string
  alt: string
  /** Not stored yet (pictures are at most 1200px on the longest side); null until known. */
  width: number | null
  height: number | null
}

export type PublicCategoryRef = { slug: string; name: string }

/** ZP-501: the product's video (MP4, H.264, no sound) and its poster frame, both public URLs. */
export type PublicVideo = {
  src: string
  poster: string
  width: number
  height: number
}

export type PublicProduct = {
  slug: string
  name: string
  description: string | null
  category: PublicCategoryRef
  colours: string | null
  sizes: string | null
  availability: Availability
  /** Primary first, then gallery order. */
  images: PublicImage[]
  /**
   * ZP-501: a READY video, else null. Always set by toPublicProduct; optional
   * in the type so hand-written DTOs (fixtures, design previews) need not list it.
   */
  video?: PublicVideo | null
  isNew: boolean
  featured: boolean
  /** Only with SHOW_PRICE and a price > 0; otherwise null ("ask for price"). */
  priceUsd: number | null
  /** Only present when the caller passed includeItemNumber: true. */
  itemNumber?: string
  /**
   * ZP-504: public WhatsApp enquiry reference, "V-" + id padded to 4 ("V-0099");
   * never the item number. Always set by toPublicProduct; optional in the type
   * so hand-written DTOs (fixtures, design previews) need not list it.
   */
  ref?: string
  /**
   * ZP-507: "Love it" hearts (Product.loveCount, >= 0), cached with the
   * catalogue (up to 60 s old). Always set by toPublicProduct; optional in
   * the type so hand-written DTOs need not list it.
   */
  loves?: number
}

export type PublicCategory = {
  slug: string
  name: string
  description: string | null
  heroImage: PublicImage | null
}

/**
 * The columns the data layer selects from the database. Some (quantity,
 * selling price, sortOrder, publishedAt, id) are needed to compute public
 * values or to sort, and are never copied to the DTO.
 */
export type PublicProductRow = {
  id: number
  itemNumber: string
  productName: string
  publicName: string | null
  slug: string | null
  publicDescription: string | null
  colours: string | null
  sizes: string | null
  featured: boolean
  sortOrder: number
  published: boolean
  publishedAt: Date | null
  priceDisplay: PriceDisplayValue
  sellingPriceUsd: number
  currentQuantity: number
  /** ZP-507: copied as `loves`. Optional so older fixtures need not list it. */
  loveCount?: number
  category: { slug: string; name: string; published: boolean } | null
  images: { id: number; imageKey: string; alt: string | null; sortOrder: number; isPrimary: boolean }[]
  /** ZP-501: selected to build `video`; status and keys are never copied. */
  video?: {
    status: 'PROCESSING' | 'READY' | 'FAILED'
    videoKey: string | null
    posterKey: string | null
    width: number | null
    height: number | null
  } | null
}

export type PublicCategoryRow = {
  slug: string
  name: string
  description: string | null
  heroImageKey: string | null
}

export type ProductDtoOptions = {
  now: Date
  /** "Few left" threshold; from site settings later (ZP-486). */
  fewLeftThreshold?: number
  /** Opt-in only; default off. */
  includeItemNumber?: boolean
}

function text(value: string | null | undefined): string | null {
  const t = value?.trim()
  return t ? t : null
}

function image(key: string, alt: string): PublicImage {
  return { url: publicImageSrc(key), srcSet: publicImageSrcSet(key), alt, width: null, height: null }
}

const positiveInt = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

function video(row: PublicProductRow['video']): PublicVideo | null {
  if (!row || row.status !== 'READY') return null
  if (!isValidVideoKey(row.videoKey) || !isValidPosterKey(row.posterKey)) return null
  if (!positiveInt(row.width) || !positiveInt(row.height)) return null
  return { src: publicVideoUrl(row.videoKey), poster: publicVideoUrl(row.posterKey), width: row.width, height: row.height }
}

export function toPublicProduct(row: PublicProductRow, options: ProductDtoOptions): PublicProduct {
  const name = displayName(row)
  const images = [...row.images]
    .sort(compareGalleryImages)
    .filter((i) => isValidImageKey(i.imageKey))
    .map((i) => image(i.imageKey, text(i.alt) ?? name))
  const dto: PublicProduct = {
    slug: row.slug ?? '',
    name,
    description: text(row.publicDescription),
    category: { slug: row.category?.slug ?? '', name: row.category?.name ?? '' },
    colours: text(row.colours),
    sizes: text(row.sizes),
    availability: getAvailability(row.currentQuantity, options.fewLeftThreshold ?? FEW_LEFT_THRESHOLD),
    images,
    video: video(row.video),
    isNew: isNewArrival(row, options.now),
    featured: row.featured,
    priceUsd: publicPriceUsd(row),
    ref: publicProductRef(row.id),
    loves: Math.max(0, Math.floor(row.loveCount ?? 0)),
  }
  if (options.includeItemNumber) dto.itemNumber = row.itemNumber
  return dto
}

// ─── Reviews (ZP-508) ──────────────────────────────────────────────────────

/** One APPROVED customer review as the storefront shows it. */
export type PublicReview = {
  /** 1-5. */
  stars: number
  /** Plain text; render as text (escaped), never as HTML or links. */
  comment: string
  /** "Tendai M." */
  name: string
  /** When it was written (ISO); the page shows "2 weeks ago". */
  date: string
  /** "Reply from VYRA", or null. */
  reply: string | null
  /** Only with the customer's consent; null otherwise. */
  photo: { url: string; srcSet: string; alt: string } | null
}

/**
 * The Review columns the data layer may read. Status, consent and the photo
 * key decide what is public; ids, the invite, shop stars, the private note,
 * the flag and moderator are never copied.
 */
export type PublicReviewRow = {
  id: number
  inviteId: number
  shopOnly: boolean
  productId: number | null
  stars: number
  shopStars: number | null
  comment: string
  displayName: string
  photoKey: string | null
  photoConsent: boolean
  status: 'PENDING' | 'APPROVED' | 'HIDDEN'
  flagged: boolean
  ownerReply: string | null
  privateNote: string | null
  moderatedBy: string | null
  createdAt: Date
  approvedAt: Date | null
}

/** The public DTO of an APPROVED review, else null. The photo only with consent. */
export function toPublicReview(row: PublicReviewRow, productName: string): PublicReview | null {
  if (row.status !== 'APPROVED') return null
  const photo =
    row.photoConsent && row.photoKey && isValidImageKey(row.photoKey)
      ? { url: publicImageSrc(row.photoKey), srcSet: publicImageSrcSet(row.photoKey), alt: `Photo from ${row.displayName} wearing the ${productName}` }
      : null
  return {
    stars: row.stars,
    comment: row.comment,
    name: row.displayName,
    date: row.createdAt.toISOString(),
    reply: text(row.ownerReply),
    photo,
  }
}

export function toPublicCategory(row: PublicCategoryRow): PublicCategory {
  return {
    slug: row.slug,
    name: row.name,
    description: text(row.description),
    heroImage: row.heroImageKey && isValidImageKey(row.heroImageKey) ? image(row.heroImageKey, row.name) : null,
  }
}
