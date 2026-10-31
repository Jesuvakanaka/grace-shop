// Public-site rules for products (ZP-482). Pure; no database, no UI.
import { imageKeyFromFileName, IMAGE_URL_PREFIX } from '@/lib/storage/keys'

// ─── Availability ──────────────────────────────────────────────────────────────

export type Availability = 'SOLD_OUT' | 'FEW_LEFT' | 'IN_STOCK'
export const FEW_LEFT_THRESHOLD = 3

/** Stock label for the public site. Never expose the quantity itself. */
export function getAvailability(currentQuantity: number, threshold = FEW_LEFT_THRESHOLD): Availability {
  if (typeof currentQuantity !== 'number' || !Number.isFinite(currentQuantity) || currentQuantity <= 0) return 'SOLD_OUT'
  if (currentQuantity <= threshold) return 'FEW_LEFT'
  return 'IN_STOCK'
}

// ─── Names and prices ──────────────────────────────────────────────────────────

export function displayName(product: { productName: string; publicName?: string | null }): string {
  const publicName = product.publicName?.trim()
  return publicName ? publicName : (product.productName ?? '').trim()
}

export type PriceDisplayValue = 'SHOW_PRICE' | 'ASK_FOR_PRICE'

/**
 * Price to show publicly (USD), or null for "ask for price". Only
 * sellingPriceUsd is ever public, and only with SHOW_PRICE. A price of 0
 * (not set yet) is never shown.
 */
export function publicPriceUsd(product: { priceDisplay: PriceDisplayValue; sellingPriceUsd: number }): number | null {
  if (product.priceDisplay !== 'SHOW_PRICE') return null
  const price = product.sellingPriceUsd
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null
}

// ─── Publishing and new arrivals ───────────────────────────────────────────────

/** A product counts as a new arrival for this many days after publishedAt. */
export const NEW_ARRIVAL_DAYS = 30
const DAY_MS = 86_400_000

/** Derived, not stored: published and first published within `days` of now. */
export function isNewArrival(
  product: { published: boolean; publishedAt: Date | null },
  now: Date = new Date(),
  days = NEW_ARRIVAL_DAYS,
): boolean {
  if (!product.published || !product.publishedAt) return false
  const age = now.getTime() - product.publishedAt.getTime()
  return age <= days * DAY_MS
}

/**
 * New published/publishedAt values. publishedAt is set the first time the
 * product is published and then kept, also through unpublish/republish.
 */
export function nextPublishState(
  current: { published: boolean; publishedAt: Date | null },
  publish: boolean,
  now: Date = new Date(),
): { published: boolean; publishedAt: Date | null } {
  return { published: publish, publishedAt: current.publishedAt ?? (publish ? now : null) }
}

// ─── Publish readiness ─────────────────────────────────────────────────────────

export type PublishMissing = 'display name' | 'image' | 'category'

export type PublishReadinessInput = {
  productName: string
  publicName?: string | null
  images?: readonly { imageKey: string }[] | null
  category?: { id: number } | null
}

/**
 * Whether a product may be published: it needs a display name (publicName or
 * productName), at least one gallery image, and an existing category. The
 * caller loads `images` and `category` with the product.
 */
export function getPublishReadiness(product: PublishReadinessInput): { ready: boolean; missing: PublishMissing[] } {
  const missing: PublishMissing[] = []
  if (!displayName(product)) missing.push('display name')
  if (!product.images || product.images.length === 0) missing.push('image')
  if (!product.category) missing.push('category')
  return { ready: missing.length === 0, missing }
}

// ─── Images ────────────────────────────────────────────────────────────────────

/** Storage key for a Product.imageUrl like "/api/images/<32 hex>.webp", else null. */
export function imageKeyFromImageUrl(imageUrl: string | null | undefined): string | null {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith(IMAGE_URL_PREFIX)) return null
  return imageKeyFromFileName(imageUrl.slice(IMAGE_URL_PREFIX.length))
}

export type GalleryImageRef = { id: number; sortOrder: number; isPrimary: boolean }

/** Gallery order: primary first, then sortOrder, then id. */
export function compareGalleryImages(a: GalleryImageRef, b: GalleryImageRef): number {
  return Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder || a.id - b.id
}

/**
 * Which image should be primary: the existing primary (the first by
 * sortOrder/id if there are several, the others are demoted), else the first
 * image by sortOrder/id. No images: no primary.
 */
export function planPrimaryImage(images: readonly GalleryImageRef[]): { primaryId: number | null; demoteIds: number[] } {
  const byOrder = [...images].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  const primaries = byOrder.filter((i) => i.isPrimary)
  if (primaries.length > 0) return { primaryId: primaries[0].id, demoteIds: primaries.slice(1).map((i) => i.id) }
  return { primaryId: byOrder[0]?.id ?? null, demoteIds: [] }
}
