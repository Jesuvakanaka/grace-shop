import prisma from '@/lib/db'
import { startOfDay, endOfDay } from 'date-fns'

export async function getDayClosingSummary(date: Date) {
  const targetDate = startOfDay(date)
  const cashPosition = await prisma.cashPosition.findUnique({ where: { cashDate: targetDate } })
  
  const sales = await prisma.sale.findMany({
    where: { saleDate: { gte: startOfDay(date), lte: endOfDay(date) } },
    include: { items: true }
  })
  
  const expenses = await prisma.expense.findMany({
    where: { expenseDate: { gte: startOfDay(date), lte: endOfDay(date) } }
  })

  let totalCashSales = 0
  let totalCreditSales = 0
  let totalItemsSold = 0
  for (const s of sales) {
    totalCashSales += s.cashAmount
    totalCreditSales += s.creditAmount
    for (const item of s.items) {
      totalItemsSold += item.quantity
    }
  }

  let totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)

  return {
    closingDate: targetDate,
    openingCash: cashPosition?.openingCash || 0,
    totalCashSales,
    totalCreditSales,
    totalExpenses,
    debtorPaymentsReceived: cashPosition?.debtorPaymentsReceived || 0,
    creditorPaymentsMade: cashPosition?.creditorPaymentsMade || 0,
    expectedClosingCash: cashPosition?.expectedClosingCash || 0,
    actualCountedCash: cashPosition?.actualCountedCash || null,
    totalItemsSold
  }
}

export async function createOrUpdateDayClosing(date: Date, data: {
  actualCountedCash?: number
  stockNotes?: string
  signOffName?: string
  closingNotes?: string
  createdBy?: string
}) {
  const summary = await getDayClosingSummary(date)
  const targetDate = startOfDay(date)
  
  let closing = await prisma.dayClosing.findUnique({ where: { closingDate: targetDate } })
  
  const updateData = {
    ...summary,
    actualCountedCash: data.actualCountedCash ?? closing?.actualCountedCash,
    cashVariance: data.actualCountedCash !== undefined ? data.actualCountedCash - summary.expectedClosingCash : null,
    stockNotes: data.stockNotes ?? closing?.stockNotes,
    signOffName: data.signOffName ?? closing?.signOffName,
    closingNotes: data.closingNotes ?? closing?.closingNotes,
    status: 'DRAFT',
  }

  if (closing) {
    if (closing.status === 'CLOSED') throw new Error('Day is already closed')
    return prisma.dayClosing.update({
      where: { id: closing.id },
      data: updateData
    })
  } else {
    return prisma.dayClosing.create({
      data: {
        ...updateData,
        createdBy: data.createdBy
      }
    })
  }
}

export async function closeDayClosing(id: number, signOffName: string, actualCountedCash: number, closedBy?: string) {
  const closing = await prisma.dayClosing.findUnique({ where: { id } })
  if (!closing) throw new Error('Closing not found')
  if (closing.status === 'CLOSED') throw new Error('Already closed')

  const cashVariance = actualCountedCash - closing.expectedClosingCash

  // Update cash position
  const cashPos = await prisma.cashPosition.findUnique({ where: { cashDate: closing.closingDate } })
  if (cashPos) {
    await prisma.cashPosition.update({
      where: { id: cashPos.id },
      data: { actualCountedCash, variance: cashVariance }
    })
  }

  return prisma.dayClosing.update({
    where: { id },
    data: {
      signOffName,
      actualCountedCash,
      cashVariance,
      status: 'CLOSED',
      closedBy
    }
  })
}

export async function getDayClosing(date: Date) {
  return prisma.dayClosing.findUnique({
    where: { closingDate: startOfDay(date) }
  })
}

export async function canEditClosing(id: number) {
  const closing = await prisma.dayClosing.findUnique({ where: { id } })
  return closing?.status === 'DRAFT'
}
