import prisma from '@/lib/db'
import { startOfDay } from 'date-fns'

export async function getAllCreditors() {
  return prisma.creditor.findMany({
    orderBy: [
      { outstandingBalance: 'desc' },
      { creditorName: 'asc' }
    ]
  })
}

export async function getCreditorById(id: number) {
  return prisma.creditor.findUnique({
    where: { id },
    include: { transactions: { orderBy: { transactionDate: 'desc' } } }
  })
}

export async function createCreditor(data: {
  creditorName: string
  phoneNumber?: string
  description?: string
  totalAmountOwed: number
  dueDate?: Date
  notes?: string
  createdBy?: string
}) {
  return prisma.creditor.create({
    data: {
      ...data,
      outstandingBalance: data.totalAmountOwed,
      status: data.totalAmountOwed > 0 ? 'OPEN' : 'PAID'
    }
  })
}

export async function recordCreditorPayment(creditorId: number, amount: number, notes?: string, createdBy?: string) {
  return prisma.$transaction(async (tx) => {
    const creditor = await tx.creditor.findUnique({ where: { id: creditorId } })
    if (!creditor) throw new Error('Creditor not found')

    const newPaid = creditor.totalPaid + amount
    const newOutstanding = creditor.outstandingBalance - amount
    let status = 'OPEN'
    if (newOutstanding <= 0) status = 'PAID'
    else if (newPaid > 0) status = 'PART_PAID'

    await tx.creditor.update({
      where: { id: creditorId },
      data: { totalPaid: newPaid, outstandingBalance: newOutstanding, status }
    })

    await tx.creditorTransaction.create({
      data: {
        creditorId,
        transactionDate: new Date(),
        transactionType: 'PAYMENT',
        amount,
        notes,
        createdBy
      }
    })

    const now = new Date()
    const cashDate = startOfDay(now)
    let cashPos = await tx.cashPosition.findUnique({ where: { cashDate } })
    if (!cashPos) {
      const prev = await tx.cashPosition.findFirst({
        where: { cashDate: { lt: cashDate } },
        orderBy: { cashDate: 'desc' }
      })
      const openingCash = prev?.actualCountedCash ?? prev?.expectedClosingCash ?? 0
      cashPos = await tx.cashPosition.create({
        data: {
          cashDate,
          openingCash,
          expectedClosingCash: openingCash
        }
      })
    }
    
    await tx.cashPosition.update({
      where: { id: cashPos.id },
      data: {
        creditorPaymentsMade: cashPos.creditorPaymentsMade + amount,
        expectedClosingCash: cashPos.expectedClosingCash - amount
      }
    })

    return creditor
  })
}

export async function getOutstandingCreditors() {
  return prisma.creditor.findMany({
    where: { outstandingBalance: { gt: 0 } },
    orderBy: { outstandingBalance: 'desc' }
  })
}
