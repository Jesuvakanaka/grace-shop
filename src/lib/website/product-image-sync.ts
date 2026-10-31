// Gallery sync for the admin product routes (ZP-483). Server only.
//
// src/app/api/products/** still edit the admin's single picture
// (Product.imageUrl). These helpers make that edit reach the storefront
// gallery (ProductImage) through syncGalleryFromImageUrl, in the same
// transaction, so the primary image always mirrors Product.imageUrl.
import prisma from '@/lib/db'
import { imageKeyFromImageUrl } from '@/lib/storefront-model'
import { syncGalleryFromImageUrl } from '@/lib/storefront-model/db'
import { pickProductUpdateFields, type ProductUpdateData } from '@/lib/products'

export const IMAGE_URL_ERROR = 'Only pictures uploaded here can be used.'

/**
 * Check `imageUrl` from a request body. undefined (not sent) means "no
 * change"; null or "" clears; otherwise it must be a stored picture URL
 * ("/api/images/<32 hex>.webp"), which is all the upload route produces.
 */
export function checkImageUrl(imageUrl: unknown): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (imageUrl === undefined || imageUrl === null || imageUrl === '') return { ok: true, value: imageUrl as string | null | undefined }
  if (typeof imageUrl === 'string' && imageKeyFromImageUrl(imageUrl)) return { ok: true, value: imageUrl }
  return { ok: false, error: IMAGE_URL_ERROR }
}

export const LAST_PHOTO_ERROR = 'Unpublish the product before removing its last photo'

/** A refused picture change; the route answers 400 with its message. */
export class ProductImageError extends Error {}

/**
 * updateProduct plus the gallery sync, atomically. imageUrl must have passed
 * checkImageUrl. Clearing the picture (null / "") of a published product
 * whose gallery would become empty is refused (same rule as the Website API).
 */
export async function updateProductAndGallery(id: number, data: ProductUpdateData & Record<string, unknown>) {
  return prisma.$transaction(async (tx) => {
    if (data.imageUrl === null || data.imageUrl === '') {
      // Lock the row so a concurrent publish cannot slip in between the check and the delete.
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${id} FOR UPDATE`
      const product = await tx.product.findUnique({ where: { id }, select: { published: true } })
      if (product?.published) {
        const images = await tx.productImage.findMany({ where: { productId: id }, select: { isPrimary: true } })
        const remaining = images.length - (images.some((i) => i.isPrimary) ? 1 : 0)
        if (images.length > 0 && remaining === 0) throw new ProductImageError(LAST_PHOTO_ERROR)
      }
    }
    await tx.product.update({ where: { id }, data: pickProductUpdateFields(data) })
    const sync = await syncGalleryFromImageUrl(tx, id, data.imageUrl as string | null | undefined)
    if (!sync.ok) throw new Error(sync.error)
    return tx.product.findUniqueOrThrow({ where: { id } })
  })
}

/** After createProduct (which does not store a picture): store it and create the primary gallery image. */
export async function attachPictureToNewProduct(id: number, imageUrl: string) {
  return prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: { imageUrl } })
    const sync = await syncGalleryFromImageUrl(tx, id, imageUrl)
    if (!sync.ok) throw new Error(sync.error)
    return tx.product.findUniqueOrThrow({ where: { id } })
  })
}
