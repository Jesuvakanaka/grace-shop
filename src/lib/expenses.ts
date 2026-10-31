import prisma from '@/lib/db'
import { ensureCashPosition } from '@/lib/cash-position'
import { startOfDay, endOfDay } from 'date-fns'

export async function createExpense(data: {
  expenseDate: Date
  category: string
  description: string
  amount: number
  paymentMethod?: string
  paidTo?: string
  notes?: string
  createdBy?: string
}) {
  if (data.amount <= 0) throw new Error('Amount must be positive')
  if (!data.description) throw new Error('Description is required')

  return prisma.$transaction(async (tx) => {
    // Explicit columns only: never spread caller data into Prisma (mass assignment).
    const expense = await tx.expense.create({
      data: {
        expenseDate: data.expenseDate,
        category: data.category,
        description: data.description,
        amount: data.amount,
        paymentMethod: data.paymentMethod || 'CASH',
        paidTo: data.paidTo,
        notes: data.notes,
        createdBy: data.createdBy,
      },
    })

    if ((data.paymentMethod || 'CASH') === 'CASH') {
      const cashPosition = await ensureCashPosition(tx, data.expenseDate, data.createdBy)
      await tx.cashPosition.update({
        where: { id: cashPosition.id },
        data: {
          expensesPaid: { increment: data.amount },
          expectedClosingCash: { decrement: data.amount }
        }
      })
    }
    return expense
  })
}

export async function getExpenses(date?: Date) {
  let where = {}
  if (date) {
    where = {
      expenseDate: { gte: startOfDay(date), lte: endOfDay(date) }
    }
  }
  return prisma.expense.findMany({ where, orderBy: { expenseDate: 'desc' } })
}

export function getExpenseCategories() {
  return ['Transport', 'Food', 'Utilities', 'Rent', 'Supplies', 'Salary', 'Communication', 'Maintenance', 'Other']
}

export async function getTodayExpenses() {
  return getExpenses(new Date())
}
