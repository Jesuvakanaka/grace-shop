import prisma from '@/lib/db'
import { getTodayCashPosition } from './cash'
import { startOfDay, endOfDay } from 'date-fns'

export async function getDashboardData() {
  const products = await prisma.product.findMany()
  
  let totalStockQuantity = 0
  let totalStockCostUsd = 0
  let totalPotentialSalesUsd = 0
  const lowStockItems = []

  for (const p of products) {
    totalStockQuantity += p.currentQuantity
    totalStockCostUsd += (p.currentQuantity * p.unitCostUsd)
    totalPotentialSalesUsd += (p.currentQuantity * p.sellingPriceUsd)
    if (p.currentQuantity <= 5) {
      lowStockItems.push(p)
    }
  }

  const today = new Date()
  const start = startOfDay(today)
  const end = endOfDay(today)

  const todaySalesRecords = await prisma.sale.findMany({
    where: { saleDate: { gte: start, lte: end } }
  })
  const todaySales = todaySalesRecords.reduce((sum, s) => sum + s.totalAmount, 0)
  const todayCreditSales = todaySalesRecords.reduce((sum, s) => sum + s.creditAmount, 0)

  const todayExpenseRecords = await prisma.expense.findMany({
    where: { expenseDate: { gte: start, lte: end } }
  })
  const todayExpenses = todayExpenseRecords.reduce((sum, e) => sum + e.amount, 0)

  const todayCashPosition = await getTodayCashPosition()

  const debtors = await prisma.debtor.findMany()
  const totalDebtorsOutstanding = debtors.reduce((sum, d) => sum + d.outstandingBalance, 0)

  const creditors = await prisma.creditor.findMany()
  const totalCreditorsOutstanding = creditors.reduce((sum, c) => sum + c.outstandingBalance, 0)

  const estimatedGrossProfit = totalPotentialSalesUsd - totalStockCostUsd

  return {
    totalStockQty: totalStockQuantity,
    totalStockValue: totalStockCostUsd,
    totalPotentialSales: totalPotentialSalesUsd,
    todaySales,
    todayExpenses,
    expectedCash: todayCashPosition.expectedClosingCash,
    cashVariance: todayCashPosition.variance || 0,
    creditOutstanding: totalDebtorsOutstanding,
    creditorsOutstanding: totalCreditorsOutstanding,
    estimatedGrossProfit,
    lowStockItems,
    todayCreditSales
  }
}
