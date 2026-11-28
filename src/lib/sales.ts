import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { ensureCashPosition } from '@/lib/cash-position'
import { startOfDay, endOfDay } from 'date-fns'

export async function createSale(data: {
  saleDate: Date
  paymentType: string
  customerName?: string
  customerPhone?: string
  items: { productId: number, quantity: number, unitPrice: number }[]
  cashAmount?: number
  creditAmount?: number
  notes?: string
  createdBy?: string
  /** ZP-1118 (MM-13-AC1): the receipt number. The same receipt is never recorded twice. */
  receiptRef?: string | null
}) {
  const externalRef = receiptKey(data.receiptRef)
  if (externalRef) {
    const seen = await prisma.sale.findUnique({ where: { externalRef }, select: { id: true } })
    if (seen) throw new DuplicateSaleError(seen.id)
  }
  try {
    return await recordSale(data, externalRef)
  } catch (e) {
    // Two identical requests at once: the second loses on the unique receipt key.
    if (externalRef && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const seen = await prisma.sale.findUnique({ where: { externalRef }, select: { id: true } })
      if (seen) throw new DuplicateSaleError(seen.id)
    }
    throw e
  }
}

/** The stored key of a receipt number (trimmed, case kept), or null when none was given. */
export function receiptKey(ref: unknown): string | null {
  if (typeof ref !== 'string') return null
  const r = ref.replace(/\s+/g, ' ').trim()
  return r ? `receipt:${r.slice(0, 64)}` : null
}

export class DuplicateSaleError extends Error {
  constructor(public readonly saleId: number) {
    super(`This receipt is already recorded as sale ${saleId}.`)
  }
}

async function recordSale(data: Parameters<typeof createSale>[0], externalRef: string | null) {
  return prisma.$transaction(async (tx) => {
    let totalAmount = 0

    for (const item of data.items) {
      if (item.quantity <= 0) throw new Error('Quantity must be positive')
      const product = await tx.product.findUnique({ where: { id: item.productId } })
      if (!product) throw new Error(`Product ${item.productId} not found`)
      if (product.currentQuantity < item.quantity) {
        throw new Error(`Insufficient stock for product ${product.itemNumber}`)
      }
      totalAmount += item.quantity * item.unitPrice
    }

    if (data.paymentType === 'CREDIT' || data.paymentType === 'MIXED') {
      if (!data.customerName) throw new Error('Customer name required for credit sales')
    }

    const sale = await tx.sale.create({
      data: {
        saleDate: data.saleDate,
        paymentType: data.paymentType,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        totalAmount,
        cashAmount: data.cashAmount || 0,
        creditAmount: data.creditAmount || 0,
        notes: data.notes,
        createdBy: data.createdBy,
        externalRef,
        items: {
          create: data.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalAmount: item.quantity * item.unitPrice
          }))
        }
      },
      include: { items: true }
    })

    for (const item of data.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } })
      const opening = product!.currentQuantity
      const closing = opening - item.quantity

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          movementDate: data.saleDate,
          movementType: 'SALE',
          quantity: -item.quantity,
          openingBalance: opening,
          closingBalance: closing,
          referenceType: 'SALE',
          referenceId: sale.id,
          createdBy: data.createdBy
        }
      })

      await tx.product.update({
        where: { id: item.productId },
        data: { currentQuantity: closing }
      })
    }

    if ((data.paymentType === 'CASH' || data.paymentType === 'MIXED') && (data.cashAmount || 0) > 0) {
      const cashPosition = await ensureCashPosition(tx, data.saleDate, data.createdBy)
      await tx.cashPosition.update({
        where: { id: cashPosition.id },
        data: {
          cashSales: { increment: data.cashAmount || 0 },
          expectedClosingCash: { increment: data.cashAmount || 0 }
        }
      })
    }

    if ((data.paymentType === 'CREDIT' || data.paymentType === 'MIXED') && (data.creditAmount || 0) > 0) {
      let debtor = await tx.debtor.findFirst({
        where: { customerName: data.customerName }
      })
      if (!debtor) {
        debtor = await tx.debtor.create({
          data: {
            customerName: data.customerName!,
            phoneNumber: data.customerPhone,
            totalCreditAmount: 0,
            totalPaid: 0,
            outstandingBalance: 0,
            status: 'OPEN',
            createdBy: data.createdBy
          }
        })
      }

      const newCreditAmount = debtor.totalCreditAmount + (data.creditAmount || 0)
      const newOutstanding = debtor.outstandingBalance + (data.creditAmount || 0)

      await tx.debtor.update({
        where: { id: debtor.id },
        data: {
          totalCreditAmount: newCreditAmount,
          outstandingBalance: newOutstanding,
          status: newOutstanding > 0 ? 'OPEN' : 'PAID'
        }
      })

      await tx.debtorTransaction.create({
        data: {
          debtorId: debtor.id,
          transactionDate: data.saleDate,
          transactionType: 'CREDIT_SALE',
          amount: data.creditAmount || 0,
          referenceType: 'SALE',
          referenceId: sale.id,
          createdBy: data.createdBy
        }
      })
    }

    return sale
  })
}

export async function getSales(date?: Date) {
  let where = {}
  if (date) {
    where = {
      saleDate: {
        gte: startOfDay(date),
        lte: endOfDay(date)
      }
    }
  }
  return prisma.sale.findMany({
    where,
    // ZP-1118: refunds show with their sale (voided ones too: history).
    include: { items: { include: { product: true } }, refunds: { orderBy: { id: 'asc' } } },
    orderBy: { saleDate: 'desc' }
  })
}

export async function getSaleById(id: number) {
  return prisma.sale.findUnique({
    where: { id },
    include: { items: { include: { product: true } } }
  })
}

export async function getTodaySales() {
  return getSales(new Date())
}
