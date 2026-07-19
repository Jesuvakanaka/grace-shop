import prisma from '@/lib/db'
import { startOfDay } from 'date-fns'

export async function getAllDebtors() {
  return prisma.debtor.findMany({
    orderBy: [
      { outstandingBalance: 'desc' },
      { customerName: 'asc' }
    ]
  })
}

export async function getDebtorById(id: number) {
  return prisma.debtor.findUnique({
    where: { id },
    include: { transactions: { orderBy: { transactionDate: 'desc' } } }
  })
}

export async function findOrCreateDebtor(customerName: string, phoneNumber?: string) {
  let debtor = await prisma.debtor.findFirst({ where: { customerName } })
  if (!debtor) {
    debtor = await prisma.debtor.create({
      data: { customerName, phoneNumber }
    })
  }
  return debtor
}

export async function recordDebtorPayment(debtorId: number, amount: number, notes?: string, createdBy?: string) {
  return prisma.$transaction(async (tx) => {
    const debtor = await tx.debtor.findUnique({ where: { id: debtorId } })
    if (!debtor) throw new Error('Debtor not found')

    const newPaid = debtor.totalPaid + amount
    const newOutstanding = debtor.outstandingBalance - amount
    let status = 'OPEN'
    if (newOutstanding <= 0) status = 'PAID'
    else if (newPaid > 0) status = 'PART_PAID'

    await tx.debtor.update({
      where: { id: debtorId },
      data: { totalPaid: newPaid, outstandingBalance: newOutstanding, status }
    })

    await tx.debtorTransaction.create({
      data: {
        debtorId,
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
        debtorPaymentsReceived: cashPos.debtorPaymentsReceived + amount,
        expectedClosingCash: cashPos.expectedClosingCash + amount
      }
    })

    return debtor
  })
}

export async function getOutstandingDebtors() {
  return prisma.debtor.findMany({
    where: { outstandingBalance: { gt: 0 } },
    orderBy: { outstandingBalance: 'desc' }
  })
}
