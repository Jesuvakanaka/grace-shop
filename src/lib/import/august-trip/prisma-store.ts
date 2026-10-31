// Prisma-backed AugustImportStore (ZP-468).
import type { PrismaClient } from '@prisma/client'
import { syncGalleryFromImageUrl } from '@/lib/storefront-model/db'
import { IMPORT_REFERENCE_TYPE, importMovementNotes, type AugustImportStore, type ExistingAugustProduct } from './run'

export function createPrismaAugustStore(prisma: PrismaClient): AugustImportStore {
  return {
    async findExisting(itemNumbers) {
      const rows = await prisma.product.findMany({
        where: { itemNumber: { in: itemNumbers } },
        select: {
          id: true,
          itemNumber: true,
          imageUrl: true,
          sourceFilename: true,
          sourceRowNumber: true,
          openingQuantity: true,
          currentQuantity: true,
          _count: { select: { stockMovements: true } },
        },
      })
      const out = new Map<string, ExistingAugustProduct>()
      for (const { _count, ...p } of rows) out.set(p.itemNumber, { ...p, movementCount: _count.stockMovements })
      return out
    },

    async createProduct(record, imageUrl, actor) {
      return prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            itemNumber: record.itemNumber,
            productName: record.productName,
            imageUrl,
            unitCostRmb: record.unitCostRmb,
            unitCostUsd: record.unitCostUsd,
            sellingPriceRmb: record.sellingPriceRmb,
            sellingPriceUsd: record.sellingPriceUsd,
            wholesalePriceUsd: record.wholesalePriceUsd,
            wholesaleMinQuantity: record.wholesaleMinQuantity,
            openingQuantity: record.quantity,
            currentQuantity: record.quantity,
            notes: record.notes,
            sourceFilename: record.sourceFilename,
            sourceSheetName: record.sourceSheetName,
            sourceRowNumber: record.sourceRowNumber,
            createdBy: actor,
          },
        })
        // ZP-482: the picture is also the product's primary gallery image.
        if (imageUrl) await syncGalleryFromImageUrl(tx, product.id, imageUrl)
        if (record.quantity > 0) {
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              movementDate: new Date(),
              movementType: 'OPENING_BALANCE',
              quantity: record.quantity,
              openingBalance: 0,
              closingBalance: record.quantity,
              referenceType: IMPORT_REFERENCE_TYPE,
              notes: importMovementNotes(record),
              createdBy: actor,
            },
          })
        }
        return { id: product.id, movementCreated: record.quantity > 0 }
      })
    },

    async attachImageIfEmpty(productId, imageUrl, actor) {
      return prisma.$transaction(async (tx) => {
        const { count } = await tx.product.updateMany({
          where: { id: productId, OR: [{ imageUrl: null }, { imageUrl: '' }] },
          data: { imageUrl, updatedBy: actor },
        })
        // ZP-482: keep the primary gallery image in step with imageUrl.
        if (count > 0) await syncGalleryFromImageUrl(tx, productId, imageUrl)
        return count > 0
      })
    },

    async addImportStockIfNone(productId, quantity, notes, actor) {
      return prisma.$transaction(async (tx) => {
        const movements = await tx.stockMovement.count({ where: { productId } })
        if (movements > 0) return false
        // Conditional update: only a product that still has no stock is changed.
        const { count } = await tx.product.updateMany({
          where: { id: productId, openingQuantity: 0, currentQuantity: 0 },
          data: { openingQuantity: quantity, currentQuantity: quantity, updatedBy: actor },
        })
        if (count === 0) return false
        await tx.stockMovement.create({
          data: {
            productId,
            movementDate: new Date(),
            movementType: 'OPENING_BALANCE',
            quantity,
            openingBalance: 0,
            closingBalance: quantity,
            referenceType: IMPORT_REFERENCE_TYPE,
            notes,
            createdBy: actor,
          },
        })
        return true
      })
    },
  }
}
