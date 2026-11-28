import prisma from '@/lib/db'
import { ensureCashPosition } from '@/lib/cash-position'
import { startOfDay } from 'date-fns'

export async function getOrCreateCashPosition(date: Date) {
  return ensureCashPosition(prisma, date)
}

/**
 * ZP-1118: the figures a person types on the cash screen. Everything else (cash sales, debtor and creditor payments,
 * expenses, refunds paid) is written by its own record and must not be overwritten here.
 */
export const EDITABLE_CASH_FIELDS = ['openingCash', 'otherCashIn', 'actualCountedCash'] as const

export async function updateCashPosition(date: Date, field: string, amount: number) {
  if (!(EDITABLE_CASH_FIELDS as readonly string[]).includes(field)) throw new Error(`${field} cannot be edited here: it comes from its own records.`)
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

  // ZP-1118: cash refunds paid out that day leave the till too.
  const expectedClosingCash = pos.openingCash + pos.cashSales + pos.debtorPaymentsReceived + pos.otherCashIn - pos.expensesPaid - pos.creditorPaymentsMade - pos.refundsPaid
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
