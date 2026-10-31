import prisma from '@/lib/db'
import { ensureCashPosition } from '@/lib/cash-position'
import { startOfDay } from 'date-fns'

export async function getOrCreateCashPosition(date: Date) {
  return ensureCashPosition(prisma, date)
}

export async function updateCashPosition(date: Date, field: string, amount: number) {
  const pos = await getOrCreateCashPosition(date)
  const data: any = { [field]: amount }
  
  await prisma.cashPosition.update({
    where: { id: pos.id },
    data
  })
  
  return recalculateCashPosition(date)
}

export async function recalculateCashPosition(date: Date) {
  const cashDate = startOfDay(date)
  const pos = await prisma.cashPosition.findUnique({ where: { cashDate } })
  if (!pos) throw new Error('Cash position not found')

  const expectedClosingCash = pos.openingCash + pos.cashSales + pos.debtorPaymentsReceived + pos.otherCashIn - pos.expensesPaid - pos.creditorPaymentsMade
  const variance = pos.actualCountedCash !== null ? pos.actualCountedCash - expectedClosingCash : null

  return prisma.cashPosition.update({
    where: { id: pos.id },
    data: { expectedClosingCash, variance }
  })
}

export async function setActualCash(date: Date, amount: number) {
  const pos = await getOrCreateCashPosition(date)
  await prisma.cashPosition.update({
    where: { id: pos.id },
    data: { actualCountedCash: amount }
  })
  return recalculateCashPosition(date)
}

export async function getTodayCashPosition() {
  return getOrCreateCashPosition(new Date())
}
