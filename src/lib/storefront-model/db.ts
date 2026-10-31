// Prisma helpers for the storefront data model (ZP-482). Server only.
// Rules are in ./slug and ./rules; this file only applies them atomically.
// See docs/storefront/data-model.md.
import type { Prisma, PrismaClient } from '@prisma/client'
import { imageUrlForKey } from '@/lib/storage/keys'
import { planSlugChange, slugify, uniqueSlug } from './slug'
import {
  compareGalleryImages,
  displayName,
  getPublishReadiness,
  imageKeyFromImageUrl,
  nextPublishState,
  planPrimaryImage,
  type PublishMissing,
} from './rules'

/** A client or an open interactive transaction. */
export type Db = PrismaClient | Prisma.TransactionClient

function inTransaction<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return '$transaction' in db ? db.$transaction(fn) : fn(db)
}

/** Total attempts for a transaction that lost a unique-slug race. */
export const UNIQUE_CONFLICT_ATTEMPTS = 3

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}

/**
 * Like inTransaction, but when `db` is a client, a unique violation (P2002,
 * e.g. two writers picking the same generated slug) re-runs the whole
 * transaction, up to UNIQUE_CONFLICT_ATTEMPTS times. Inside a caller's
 * transaction there is no retry: Postgres has aborted that transaction, so
 * the caller must retry it.
 */
async function inRetriedTransaction<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!('$transaction' in db)) return fn(db)
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(fn)
    } catch (error) {
      if (!isUniqueConflict(error) || attempt >= UNIQUE_CONFLICT_ATTEMPTS) throw error
    }
  }
}

/**
 * Lock one product row until the transaction ends (SELECT ... FOR UPDATE), so
 * concurrent publishes and slug changes of the same product run one after the
 * other and each sees the previous one's committed slug and publishedAt.
 * Without it, two publishers could both read "no slug, never published": the
 * second then picked "<slug>-2" (overwriting the first slug without a
 * redirect) and overwrote publishedAt. Other products are not blocked.
 */
async function lockProduct(tx: Prisma.TransactionClient, productId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`
}

// ─── Slugs ─────────────────────────────────────────────────────────────────────

export type SetSlugResult = { ok: true; slug: string } | { ok: false; error: string }

/**
 * Set a product's slug (normalised with slugify). The previous slug is kept
 * as a ProductSlugRedirect to this product. Going back to one of the
 * product's own old slugs deletes that redirect, so no slug is ever both live
 * and a redirect. A slug used by another product (live or as an old address)
 * is refused. The unique indexes catch a concurrent writer.
 */
export function setProductSlug(db: Db, productId: number, newSlug: string): Promise<SetSlugResult> {
  return inTransaction(db, async (tx) => {
    await lockProduct(tx, productId)
    const product = await tx.product.findUnique({ where: { id: productId }, select: { slug: true } })
    if (!product) return { ok: false, error: 'Product not found' }
    const slug = slugify(newSlug)
    const [live, redirect] = slug
      ? await Promise.all([
          tx.product.findUnique({ where: { slug }, select: { id: true } }),
          tx.productSlugRedirect.findUnique({ where: { oldSlug: slug }, select: { productId: true } }),
        ])
      : [null, null]
    const plan = planSlugChange({
      productId,
      currentSlug: product.slug,
      newSlug,
      liveOwnerId: live?.id ?? null,
      redirectOwnerId: redirect?.productId ?? null,
    })
    if (!plan.ok) return plan
    if (plan.changed) {
      if (plan.removeRedirect) await tx.productSlugRedirect.delete({ where: { oldSlug: plan.removeRedirect } })
      await tx.product.update({ where: { id: productId }, data: { slug: plan.slug } })
      if (plan.addRedirect) await tx.productSlugRedirect.create({ data: { oldSlug: plan.addRedirect, productId } })
    }
    return { ok: true, slug: plan.slug }
  })
}

async function ensureSlugIn(tx: Prisma.TransactionClient, productId: number): Promise<string> {
  await lockProduct(tx, productId) // no-op when this transaction already holds the lock
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { slug: true, productName: true, publicName: true },
  })
  if (!product) throw new Error('Product not found')
  if (product.slug) return product.slug
  const root = slugify(displayName(product)) || 'product'
  const [live, old] = await Promise.all([
    tx.product.findMany({ where: { slug: { startsWith: root } }, select: { slug: true } }),
    tx.productSlugRedirect.findMany({ where: { oldSlug: { startsWith: root } }, select: { oldSlug: true } }),
  ])
  const taken = new Set<string>([...live.map((p) => p.slug!), ...old.map((r) => r.oldSlug)])
  const slug = uniqueSlug(root, (s) => taken.has(s))
  await tx.product.update({ where: { id: productId }, data: { slug } })
  return slug
}

/**
 * Give a product a slug if it has none, generated from its display name and
 * unique against live slugs, old (redirect) slugs and reserved words.
 * Returns the slug. With a client, a concurrent writer that took the same
 * slug (P2002) causes a retry; inside a caller's transaction, the caller
 * retries.
 */
export function ensureProductSlug(db: Db, productId: number): Promise<string> {
  return inRetriedTransaction(db, (tx) => ensureSlugIn(tx, productId))
}

// ─── Publishing ────────────────────────────────────────────────────────────────

export type PublishResult =
  | { ok: true; published: boolean; publishedAt: Date | null; slug: string | null }
  | { ok: false; missing: PublishMissing[] }

/**
 * Publish or unpublish a product in one transaction (ZP-483 calls this).
 * Publishing checks getPublishReadiness (display name, gallery image,
 * category); when something is missing it returns `{ ok: false, missing }`
 * and writes nothing. Otherwise it ensures a slug (so 'slug' is never
 * missing here) and applies nextPublishState: publishedAt is set on the
 * first publish only. Unpublishing has no preconditions and keeps the slug
 * and publishedAt. Retries on a slug race like ensureProductSlug. Throws
 * "Product not found" for an unknown id.
 */
export function publishProduct(
  db: Db,
  productId: number,
  options: { publish: boolean; now?: Date },
): Promise<PublishResult> {
  const now = options.now ?? new Date()
  return inRetriedTransaction(db, async (tx) => {
    // Serialise publishers of this product: the second one sees the first one's slug and publishedAt.
    await lockProduct(tx, productId)
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: {
        productName: true,
        publicName: true,
        slug: true,
        published: true,
        publishedAt: true,
        category: { select: { id: true } },
        images: { select: { imageKey: true } },
      },
    })
    if (!product) throw new Error('Product not found')

    let slug = product.slug
    if (options.publish) {
      const missing = getPublishReadiness(product).missing.filter((m) => m !== 'slug')
      if (missing.length > 0) return { ok: false, missing }
      slug = await ensureSlugIn(tx, productId)
    }
    const state = nextPublishState(product, options.publish, now)
    await tx.product.update({ where: { id: productId }, data: state })
    return { ok: true, ...state, slug }
  })
}

/**
 * Look up a slug: the product's live slug, or an old slug that redirects to
 * it (`redirected: true`, `slug` is where to redirect). Does NOT check
 * `published`; the public data layer must.
 */
export async function resolveProductSlug(
  db: Db,
  slug: string,
): Promise<{ productId: number; slug: string; redirected: boolean } | null> {
  const live = await db.product.findUnique({ where: { slug }, select: { id: true } })
  if (live) return { productId: live.id, slug, redirected: false }
  const redirect = await db.productSlugRedirect.findUnique({
    where: { oldSlug: slug },
    select: { product: { select: { id: true, slug: true } } },
  })
  if (!redirect?.product.slug) return null
  return { productId: redirect.product.id, slug: redirect.product.slug, redirected: true }
}

// ─── Gallery and Product.imageUrl ──────────────────────────────────────────────
//
// Invariant: a product with gallery images has exactly one primary, and
// Product.imageUrl is that image's URL. ProductImage is the storefront's
// source of truth; Product.imageUrl stays the admin's single picture.

export function getGallery(db: Db, productId: number) {
  return db.productImage
    .findMany({ where: { productId } })
    .then((images) => images.sort(compareGalleryImages))
}

export type SyncGalleryResult =
  | { ok: true; changed: boolean; primaryImageId: number | null }
  | { ok: false; changed: false; error: string }

/**
 * Call after Product.imageUrl was changed (admin form, import), in the same
 * transaction if there is one. Pass the value from the update as it is:
 * - undefined (imageUrl not part of the update): no-op, `changed: false`.
 * - A stored picture URL ("/api/images/<32 hex>.webp") becomes the primary
 *   image. It replaces the previous primary row (the admin replaced "the
 *   picture"); other gallery images stay. Same URL again: `changed: false`.
 * - null or "": removes the primary row; the next gallery image, if any,
 *   becomes primary and is written back to Product.imageUrl (else null).
 * - Any other URL is an explicit error, `{ ok: false }`, and nothing is
 *   changed. Callers should reject such a URL (ZP-483 only offers uploads);
 *   the storefront can only show stored pictures.
 */
export function syncGalleryFromImageUrl(
  db: Db,
  productId: number,
  imageUrl: string | null | undefined,
): Promise<SyncGalleryResult> {
  if (imageUrl === undefined) return Promise.resolve({ ok: true, changed: false, primaryImageId: null })
  const key = imageKeyFromImageUrl(imageUrl)
  if (imageUrl && !key) {
    return Promise.resolve({
      ok: false,
      changed: false,
      error: 'imageUrl is not a stored picture (/api/images/<32 hex>.webp); the gallery was not changed',
    })
  }
  return inTransaction(db, async (tx) => {
    const images = await tx.productImage.findMany({ where: { productId } })
    const primary = images.find((i) => i.isPrimary)

    if (key) {
      if (primary?.imageKey === key) return { ok: true, changed: false, primaryImageId: primary.id }
      if (primary) await tx.productImage.delete({ where: { id: primary.id } })
      const existing = images.find((i) => i.imageKey === key)
      const row = existing
        ? await tx.productImage.update({ where: { id: existing.id }, data: { isPrimary: true } })
        : await tx.productImage.create({ data: { productId, imageKey: key, isPrimary: true, sortOrder: 0 } })
      return { ok: true, changed: true, primaryImageId: row.id }
    }

    // Cleared (null or "").
    if (primary) await tx.productImage.delete({ where: { id: primary.id } })
    const rest = images.filter((i) => i.id !== primary?.id)
    const { primaryId } = planPrimaryImage(rest)
    const next = rest.find((i) => i.id === primaryId)
    if (next) await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } })
    await tx.product.update({ where: { id: productId }, data: { imageUrl: next ? imageUrlForKey(next.imageKey) : null } })
    return { ok: true, changed: Boolean(primary || next), primaryImageId: next?.id ?? null }
  })
}

/**
 * Make a gallery image the primary one (gallery editor, ZP-483) and write it
 * to Product.imageUrl. The previous primary stays in the gallery.
 */
export function setPrimaryImage(db: Db, productId: number, imageId: number): Promise<void> {
  return inTransaction(db, async (tx) => {
    const image = await tx.productImage.findFirst({ where: { id: imageId, productId } })
    if (!image) throw new Error('Image not found for this product')
    await tx.productImage.updateMany({
      where: { productId, isPrimary: true, id: { not: imageId } },
      data: { isPrimary: false },
    })
    if (!image.isPrimary) await tx.productImage.update({ where: { id: imageId }, data: { isPrimary: true } })
    await tx.product.update({ where: { id: productId }, data: { imageUrl: imageUrlForKey(image.imageKey) } })
  })
}

/**
 * Restore the invariant after gallery images were added or removed, and
 * backfill a product whose only picture is Product.imageUrl (same rule as
 * the migration backfill). Idempotent.
 */
export function ensurePrimaryImage(db: Db, productId: number): Promise<{ primaryImageId: number | null }> {
  return inTransaction(db, async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { imageUrl: true } })
    if (!product) throw new Error('Product not found')
    const images = await tx.productImage.findMany({ where: { productId } })
    if (images.length === 0) {
      const key = imageKeyFromImageUrl(product.imageUrl)
      if (!key) return { primaryImageId: null }
      const row = await tx.productImage.create({ data: { productId, imageKey: key, isPrimary: true, sortOrder: 0 } })
      return { primaryImageId: row.id }
    }
    const { primaryId, demoteIds } = planPrimaryImage(images)
    const primary = images.find((i) => i.id === primaryId)!
    if (demoteIds.length) await tx.productImage.updateMany({ where: { id: { in: demoteIds } }, data: { isPrimary: false } })
    if (!primary.isPrimary) await tx.productImage.update({ where: { id: primary.id }, data: { isPrimary: true } })
    const url = imageUrlForKey(primary.imageKey)
    if (product.imageUrl !== url) await tx.product.update({ where: { id: productId }, data: { imageUrl: url } })
    return { primaryImageId: primary.id }
  })
}
