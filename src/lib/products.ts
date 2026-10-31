import prisma from '@/lib/db'

export async function getAllProducts() {
  return prisma.product.findMany({
    orderBy: { itemNumber: 'asc' }
  })
}

export async function getProductById(id: number) {
  return prisma.product.findUnique({
    where: { id }
  })
}

export function calculateSellingPrice(cost: number): number {
  return cost * 2
}

export async function createProduct(data: {
  itemNumber: string
  productName: string
  unitCostRmb: number
  unitCostUsd: number
  openingQuantity?: number
  notes?: string
  createdBy?: string
}) {
  const existing = await prisma.product.findUnique({
    where: { itemNumber: data.itemNumber }
  })
  if (existing) {
    throw new Error(`Product with itemNumber ${data.itemNumber} already exists`)
  }

  const sellingPriceRmb = calculateSellingPrice(data.unitCostRmb)
  const sellingPriceUsd = calculateSellingPrice(data.unitCostUsd)
  const openingQuantity = data.openingQuantity || 0

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        itemNumber: data.itemNumber,
        productName: data.productName,
        unitCostRmb: data.unitCostRmb,
        unitCostUsd: data.unitCostUsd,
        sellingPriceRmb,
        sellingPriceUsd,
        openingQuantity,
        currentQuantity: openingQuantity,
        notes: data.notes,
        createdBy: data.createdBy
      }
    })

    if (openingQuantity > 0) {
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          movementDate: new Date(),
          movementType: 'OPENING_BALANCE',
          quantity: openingQuantity,
          openingBalance: 0,
          closingBalance: openingQuantity,
          notes: 'Initial opening stock',
          referenceType: 'MANUAL',
          createdBy: data.createdBy
        }
      })
    }

    return product
  })
}

export async function updateProduct(id: number, data: {
  productName?: string
  imageUrl?: string | null
  unitCostRmb?: number
  unitCostUsd?: number
  sellingPriceRmb?: number
  sellingPriceUsd?: number
  notes?: string
  updatedBy?: string
}) {
  return prisma.product.update({
    where: { id },
    data
  })
}

export async function searchProducts(query: string) {
  return prisma.product.findMany({
    where: {
      OR: [
        { productName: { contains: query } },
        { itemNumber: { contains: query } }
      ]
    },
    orderBy: { itemNumber: 'asc' }
  })
}
