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

  return prisma.product.create({
    data: {
      ...data,
      sellingPriceRmb,
      sellingPriceUsd
    }
  })
}

export async function updateProduct(id: number, data: {
  productName?: string
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
