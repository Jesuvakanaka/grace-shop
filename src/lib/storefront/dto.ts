// Public DTOs for the VYRA storefront (ZP-484). Pure.
//
// Security boundary: every public object is built here from an explicit
// allow-list of fields. Raw Prisma rows never leave src/lib/storefront.
// Cost, wholesale, quantity, source, notes, item number (unless opted in),
// createdBy/updatedBy and database ids are never copied.
// See docs/storefront/public-data-layer.md.
import { isValidImageKey, PRODUCT_IMAGE_PREFIX } from '@/lib/storage/keys'
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

/** URL prefix of the public image route (GET /api/images/public/<32 hex>.webp). */
export const PUBLIC_IMAGE_URL_PREFIX = '/api/images/public/'

/** Public URL for a storage key ("products/<32 hex>.webp"). Throws for an invalid key. */
export function publicImageUrl(key: string): string {
  if (!isValidImageKey(key)) throw new Error('Invalid image key')
  return `${PUBLIC_IMAGE_URL_PREFIX}${key.slice(PRODUCT_IMAGE_PREFIX.length)}`
}

export type PublicImage = {
  url: string
  alt: string
  /** Not stored yet (pictures are at most 1200px on the longest side); null until known. */
  width: number | null
  height: number | null
}

export type PublicCategoryRef = { slug: string; name: string }

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
  isNew: boolean
  featured: boolean
  /** Only with SHOW_PRICE and a price > 0; otherwise null ("ask for price"). */
  priceUsd: number | null
  /** Only present when the caller passed includeItemNumber: true. */
  itemNumber?: string
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
  category: { slug: string; name: string; published: boolean } | null
  images: { id: number; imageKey: string; alt: string | null; sortOrder: number; isPrimary: boolean }[]
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
  return { url: publicImageUrl(key), alt, width: null, height: null }
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
    isNew: isNewArrival(row, options.now),
    featured: row.featured,
    priceUsd: publicPriceUsd(row),
  }
  if (options.includeItemNumber) dto.itemNumber = row.itemNumber
  return dto
}

export function toPublicCategory(row: PublicCategoryRow): PublicCategory {
  return {
    slug: row.slug,
    name: row.name,
    description: text(row.description),
    heroImage: row.heroImageKey && isValidImageKey(row.heroImageKey) ? image(row.heroImageKey, row.name) : null,
  }
}
