import prisma from '@/lib/db'
import { ensureCashPosition } from '@/lib/cash-position'

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

    const cashPos = await ensureCashPosition(tx, new Date())
    await tx.cashPosition.update({
      where: { id: cashPos.id },
      data: {
        creditorPaymentsMade: { increment: amount },
        expectedClosingCash: { decrement: amount }
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
