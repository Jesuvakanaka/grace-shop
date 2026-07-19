import prisma from '@/lib/db'
import { startOfDay, endOfDay } from 'date-fns'

export async function createStockMovement(data: {
  productId: number
  movementDate: Date
  movementType: string
  quantity: number
  notes?: string
  referenceType?: string
  referenceId?: number
  createdBy?: string
}) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: data.productId }
    })
    if (!product) throw new Error('Product not found')

    const openingBalance = product.currentQuantity
    const closingBalance = openingBalance + data.quantity

    const movement = await tx.stockMovement.create({
      data: {
        productId: data.productId,
        movementDate: data.movementDate,
        movementType: data.movementType,
        quantity: data.quantity,
        openingBalance,
        closingBalance,
        notes: data.notes,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        createdBy: data.createdBy
      }
    })

    await tx.product.update({
      where: { id: data.productId },
      data: { currentQuantity: closingBalance }
    })

    return movement
  })
}

export async function getStockMovements(productId: number, startDate?: Date, endDate?: Date) {
  const where: any = { productId }
  if (startDate || endDate) {
    where.movementDate = {}
    if (startDate) where.movementDate.gte = startOfDay(startDate)
    if (endDate) where.movementDate.lte = endOfDay(endDate)
  }
  return prisma.stockMovement.findMany({
    where,
    orderBy: { movementDate: 'desc' }
  })
}

export async function getStockLedger(productId: number, startDate?: Date, endDate?: Date) {
  return getStockMovements(productId, startDate, endDate)
}

export async function adjustStock(productId: number, newQuantity: number, notes: string, createdBy?: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw new Error('Product not found')
  
  const diff = newQuantity - product.currentQuantity
  if (diff === 0) return null

  return createStockMovement({
    productId,
    movementDate: new Date(),
    movementType: 'ADJUSTMENT',
    quantity: diff,
    notes,
    createdBy
  })
}
