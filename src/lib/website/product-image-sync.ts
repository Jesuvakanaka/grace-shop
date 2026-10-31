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

/** updateProduct plus the gallery sync, atomically. imageUrl must have passed checkImageUrl. */
export async function updateProductAndGallery(id: number, data: ProductUpdateData & Record<string, unknown>) {
  return prisma.$transaction(async (tx) => {
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
