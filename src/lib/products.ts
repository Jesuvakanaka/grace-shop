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
  wholesalePriceUsd?: number | null
  wholesaleMinQuantity?: number | null
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
        wholesalePriceUsd: data.wholesalePriceUsd ?? null,
        wholesaleMinQuantity: data.wholesaleMinQuantity ?? null,
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

export type ProductUpdateData = {
  productName?: string
  imageUrl?: string | null
  unitCostRmb?: number
  unitCostUsd?: number
  sellingPriceRmb?: number
  sellingPriceUsd?: number
  wholesalePriceUsd?: number | null
  wholesaleMinQuantity?: number | null
  notes?: string | null
  updatedBy?: string
}

const PRODUCT_UPDATE_FIELDS = [
  'productName',
  'imageUrl',
  'unitCostRmb',
  'unitCostUsd',
  'sellingPriceRmb',
  'sellingPriceUsd',
  'wholesalePriceUsd',
  'wholesaleMinQuantity',
  'notes',
  'updatedBy',
] as const satisfies readonly (keyof ProductUpdateData)[]

/**
 * Keep only the fields an edit may change. Stops request bodies from writing
 * columns such as itemNumber, currentQuantity or id through updateProduct.
 */
export function pickProductUpdateFields(data: Record<string, unknown>): ProductUpdateData {
  const picked: Record<string, unknown> = {}
  for (const key of PRODUCT_UPDATE_FIELDS) {
    if (data[key] !== undefined) picked[key] = data[key]
  }
  return picked as ProductUpdateData
}

export async function updateProduct(id: number, data: ProductUpdateData) {
  return prisma.product.update({
    where: { id },
    data: pickProductUpdateFields(data)
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
