import prisma from '@/lib/db'
import { startOfDay } from 'date-fns'

export async function getOrCreateCashPosition(date: Date) {
  const cashDate = startOfDay(date)
  let pos = await prisma.cashPosition.findUnique({ where: { cashDate } })
  if (!pos) {
    const prev = await prisma.cashPosition.findFirst({
      where: { cashDate: { lt: cashDate } },
      orderBy: { cashDate: 'desc' }
    })
    const openingCash = prev?.actualCountedCash ?? prev?.expectedClosingCash ?? 0
    pos = await prisma.cashPosition.create({
      data: {
        cashDate,
        openingCash,
        expectedClosingCash: openingCash
      }
    })
  }
  return pos
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
