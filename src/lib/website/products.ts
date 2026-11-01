// Admin website tools for products (ZP-483). Server only.
// Publishing goes only through publishProduct; the gallery only through the
// storefront-model helpers, so Product.imageUrl always mirrors the primary
// image. See docs/storefront/admin-website-tools.md.
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  compareGalleryImages,
  getPublishReadiness,
  isNewArrival,
  NEW_ARRIVAL_DAYS,
  publicPriceUsd,
} from '@/lib/storefront-model'
import {
  ensurePrimaryImage,
  getGallery,
  publishProduct,
  setPrimaryImage,
  setProductSlug,
  syncGalleryFromImageUrl,
  type PublishResult,
} from '@/lib/storefront-model/db'
import { getImageStorage, imageUrlForKey } from '@/lib/storage/images'
import { CONFLICT_MESSAGE, describeMissing, GALLERY_MAX_IMAGES, websiteStatus } from './labels'
import { WebsiteError } from './http'
import { isAutoRanking } from '@/lib/ranking/job'
import type { ImagePatch, ProductWebsitePatch } from './validation'

type Tx = Prisma.TransactionClient
const DAY_MS = 86_400_000

export type GalleryImageDto = { id: number; url: string; alt: string | null; isPrimary: boolean; sortOrder: number }

function toGalleryDto(image: { id: number; imageKey: string; alt: string | null; isPrimary: boolean; sortOrder: number }): GalleryImageDto {
  return { id: image.id, url: imageUrlForKey(image.imageKey), alt: image.alt, isPrimary: image.isPrimary, sortOrder: image.sortOrder }
}

export async function galleryDto(db: PrismaClient | Tx, productId: number): Promise<GalleryImageDto[]> {
  return (await getGallery(db, productId)).map(toGalleryDto)
}

// ─── Read ──────────────────────────────────────────────────────────────────────

/** Website fields of one product for the admin editor. No cost or stock fields. */
export async function getWebsiteProduct(db: PrismaClient, productId: number, now = new Date()) {
  const p = await db.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      itemNumber: true,
      productName: true,
      publicName: true,
      slug: true,
      publicDescription: true,
      categoryId: true,
      priceDisplay: true,
      featured: true,
      colours: true,
      sizes: true,
      published: true,
      publishedAt: true,
      sellingPriceUsd: true,
      imageUrl: true,
      loveCount: true, // ZP-507: hearts, with a reset in the editor
      category: { select: { id: true, name: true, slug: true, published: true } },
      images: true,
      // ZP-506: score and today's feed position (nightly).
      popularity: { select: { score: true, rank: true, computedAt: true } },
    },
  })
  if (!p) return null
  const readiness = getPublishReadiness(p)
  const newArrival = isNewArrival(p, now)
  return {
    ...p,
    /** ZP-506: Featured is set by popularity (read-only) while the feed ranks automatically. */
    featuredAuto: await isAutoRanking(db),
    images: [...p.images].sort(compareGalleryImages).map(toGalleryDto),
    readiness,
    status: websiteStatus(p.published, readiness.missing),
    publicPriceUsd: publicPriceUsd(p),
    newArrival,
    newUntil: newArrival && p.publishedAt ? new Date(p.publishedAt.getTime() + NEW_ARRIVAL_DAYS * DAY_MS) : null,
  }
}

/** Website status of every product, for the products list column and filters. */
export async function listWebsiteStatus(db: PrismaClient) {
  const rows = await db.product.findMany({
    select: {
      id: true,
      productName: true,
      publicName: true,
      slug: true,
      published: true,
      publishedAt: true,
      featured: true,
      categoryId: true,
      loveCount: true,
      category: { select: { id: true, name: true } },
      images: { select: { imageKey: true }, take: 1 },
    },
    orderBy: { id: 'asc' },
  })
  return rows.map((p) => {
    const { missing } = getPublishReadiness(p)
    return {
      id: p.id,
      slug: p.slug,
      published: p.published,
      publishedAt: p.publishedAt,
      featured: p.featured,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      missing: missing.filter((m) => m !== 'slug'),
      status: websiteStatus(p.published, missing),
      /** ZP-507: "Love it" hearts. */
      loves: p.loveCount,
    }
  })
}

// ─── Website fields ────────────────────────────────────────────────────────────

/**
 * Apply allow-listed website fields and, when given, the slug (with its
 * reserved/duplicate checks and redirects). One transaction: a refused slug
 * saves nothing. Returns the old and new slug for revalidation.
 */
export async function updateWebsiteFields(
  db: PrismaClient,
  productId: number,
  patch: ProductWebsitePatch,
): Promise<{ oldSlug: string | null; slug: string | null }> {
  return db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { slug: true, published: true },
    })
    if (!product) throw new WebsiteError(404, 'Product not found')

    if (patch.categoryId === null && product.published) {
      throw new WebsiteError(400, 'A published product needs a category. Unpublish it first.', { field: 'categoryId' })
    }
    if (typeof patch.categoryId === 'number') {
      const category = await tx.category.findUnique({ where: { id: patch.categoryId }, select: { id: true } })
      if (!category) throw new WebsiteError(400, 'That category no longer exists.', { field: 'categoryId' })
    }

    const { slug: newSlug, ...fields } = patch
    if (Object.keys(fields).length > 0) await tx.product.update({ where: { id: productId }, data: fields })

    let slug = product.slug
    if (newSlug !== undefined) {
      const result = await setProductSlug(tx, productId, newSlug)
      if (!result.ok) throw new WebsiteError(400, result.error, { field: 'slug' })
      slug = result.slug
    }
    return { oldSlug: product.slug, slug }
  })
}

// ─── Publishing ────────────────────────────────────────────────────────────────

export type BulkPublishResult =
  | { id: number; ok: true; published: boolean; slug: string | null }
  | { id: number; ok: false; missing: string[] }
  | { id: number; ok: false; error: string }

/** Publish or unpublish each product through publishProduct; one failure never stops the rest. */
export async function bulkPublish(db: PrismaClient, ids: readonly number[], publish: boolean) {
  const results: BulkPublishResult[] = []
  for (const id of ids) {
    try {
      const r: PublishResult = await publishProduct(db, id, { publish })
      results.push(r.ok ? { id, ok: true, published: r.published, slug: r.slug } : { id, ok: false, missing: r.missing })
    } catch (error) {
      const message = error instanceof Error && error.message === 'Product not found' ? 'Product not found' : CONFLICT_MESSAGE
      if (message !== 'Product not found') console.error('[website] bulk publish failed for', id, error instanceof Error ? error.message : error)
      results.push({ id, ok: false, error: message })
    }
  }
  const succeeded = results.filter((r) => r.ok).length
  return { results, succeeded, failed: results.length - succeeded }
}

export function notReadyMessage(missing: readonly string[]): string {
  const text = describeMissing(missing as Parameters<typeof describeMissing>[0])
  return `Not ready for the website yet: ${text}.`
}

export async function bulkSetCategory(db: PrismaClient, ids: readonly number[], categoryId: number) {
  return db.$transaction(async (tx) => {
    const category = await tx.category.findUnique({ where: { id: categoryId }, select: { id: true, slug: true } })
    if (!category) throw new WebsiteError(404, 'Category not found')
    const slugs = await tx.product.findMany({ where: { id: { in: [...ids] } }, select: { slug: true } })
    const { count } = await tx.product.updateMany({ where: { id: { in: [...ids] } }, data: { categoryId } })
    return { updated: count, slugs: slugs.map((s) => s.slug), category }
  })
}

// ─── Gallery ───────────────────────────────────────────────────────────────────
//
// Display order is the storefront's: primary first, then sortOrder, then id.
// The admin's rule: the first photo IS the primary photo. Reordering a photo
// to the top makes it primary; "Make primary" moves it to the top.

async function requireProduct(tx: Tx, productId: number) {
  // Lock the row: gallery edits and publishing of one product run one at a time,
  // so "a published product keeps a photo" cannot be raced.
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, published: true, slug: true } })
  if (!product) throw new WebsiteError(404, 'Product not found')
  return product
}

async function renumber(tx: Tx, orderedIds: readonly number[]) {
  for (const [index, id] of orderedIds.entries()) {
    await tx.productImage.update({ where: { id }, data: { sortOrder: index } })
  }
}

/** Add uploaded pictures (storage keys) to the end of the gallery. */
export async function addGalleryImages(db: PrismaClient, productId: number, keys: readonly string[]) {
  const storage = getImageStorage()
  for (const key of keys) {
    if (!(await storage.exists(key))) throw new WebsiteError(400, 'A photo was not found. Please upload it again.')
  }
  return db.$transaction(async (tx) => {
    const product = await requireProduct(tx, productId)
    // Backfill first, so a picture set before ZP-483 (imageUrl only) is kept as the primary.
    await ensurePrimaryImage(tx, productId)
    const existing = await getGallery(tx, productId)
    const fresh = keys.filter((k) => !existing.some((i) => i.imageKey === k))
    if (existing.length + fresh.length > GALLERY_MAX_IMAGES) {
      throw new WebsiteError(400, `At most ${GALLERY_MAX_IMAGES} photos per product.`)
    }
    let next = existing.reduce((max, i) => Math.max(max, i.sortOrder), -1) + 1
    for (const imageKey of fresh) {
      await tx.productImage.create({ data: { productId, imageKey, sortOrder: next++ } })
    }
    await ensurePrimaryImage(tx, productId)
    return { slug: product.slug, images: await galleryDto(tx, productId) }
  })
}

/** Reorder the whole gallery. `order` must list every image of the product once; the first becomes primary. */
export async function reorderGallery(db: PrismaClient, productId: number, order: readonly number[]) {
  return db.$transaction(async (tx) => {
    const product = await requireProduct(tx, productId)
    const images = await tx.productImage.findMany({ where: { productId }, select: { id: true, isPrimary: true } })
    const ids = new Set(images.map((i) => i.id))
    if (order.length !== ids.size || !order.every((id) => ids.has(id))) {
      throw new WebsiteError(400, 'The photo list is out of date. Reload and try again.')
    }
    await renumber(tx, order)
    if (!images.find((i) => i.id === order[0])?.isPrimary) await setPrimaryImage(tx, productId, order[0])
    return { slug: product.slug, images: await galleryDto(tx, productId) }
  })
}

/** Alt text and/or "make primary" (which also moves the photo to the front). */
export async function updateGalleryImage(db: PrismaClient, productId: number, imageId: number, patch: ImagePatch) {
  return db.$transaction(async (tx) => {
    const product = await requireProduct(tx, productId)
    const image = await tx.productImage.findFirst({ where: { id: imageId, productId }, select: { id: true } })
    if (!image) throw new WebsiteError(404, 'Photo not found')
    if (patch.alt !== undefined) await tx.productImage.update({ where: { id: imageId }, data: { alt: patch.alt } })
    if (patch.primary) {
      const current = await getGallery(tx, productId)
      await setPrimaryImage(tx, productId, imageId)
      await renumber(tx, [imageId, ...current.map((i) => i.id).filter((id) => id !== imageId)])
    }
    return { slug: product.slug, images: await galleryDto(tx, productId) }
  })
}

/**
 * Remove a photo from the gallery (the stored file stays; files are shared by
 * content hash). Removing the primary promotes the next photo and syncs
 * Product.imageUrl. A published product keeps at least one photo.
 */
export async function deleteGalleryImage(db: PrismaClient, productId: number, imageId: number) {
  return db.$transaction(async (tx) => {
    const product = await requireProduct(tx, productId)
    const image = await tx.productImage.findFirst({ where: { id: imageId, productId } })
    if (!image) throw new WebsiteError(404, 'Photo not found')
    const count = await tx.productImage.count({ where: { productId } })
    if (product.published && count <= 1) {
      throw new WebsiteError(400, 'A published product needs at least one photo. Unpublish it first.')
    }
    if (image.isPrimary) {
      const sync = await syncGalleryFromImageUrl(tx, productId, null)
      if (!sync.ok) throw new WebsiteError(409, CONFLICT_MESSAGE)
    } else {
      await tx.productImage.delete({ where: { id: imageId } })
    }
    return { slug: product.slug, images: await galleryDto(tx, productId) }
  })
}
