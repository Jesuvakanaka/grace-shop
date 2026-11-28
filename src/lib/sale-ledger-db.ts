// ZP-1118 (MM-13): read the existing sales ledger (Sale, SaleRefund, Debtor, DebtorTransaction) as money events.
// Server only. The rules are in sales-ledger.ts (pure); this file only loads rows.
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  allocatePayments, creditRefundCents, saleAndRefundEvents, toCents,
  type LedgerDebt, type LedgerRefund, type LedgerSale, type MoneyEvent,
} from './sales-ledger'

export type Db = PrismaClient | Prisma.TransactionClient

/** DebtorTransaction types that change how much is owed for a linked sale (written by sale-refunds.ts). */
export const DEBT_TX = { SALE: 'CREDIT_SALE', CANCELLED: 'CREDIT_CANCELLED', REFUND: 'CREDIT_REFUND', REFUND_VOIDED: 'CREDIT_REFUND_VOIDED' } as const

const SALE_SELECT = { id: true, saleDate: true, status: true, totalAmount: true, cashAmount: true, creditAmount: true } as const
const REFUND_SELECT = { id: true, saleId: true, refundDate: true, amount: true, method: true, voidedAt: true } as const

export interface Ledger {
  sales: LedgerSale[]
  refunds: LedgerRefund[]
  events: MoneyEvent[]
  /** debtorId of each credit sale. */
  debtorOfSale: Map<number, number>
}

/**
 * The money events of the ledger. With saleIds, only those sales and (for credit sales) everything their customers
 * owe and paid, because payments are allocated across a customer's debts. Without, the whole ledger.
 */
export async function loadLedger(db: Db, opts: { saleIds?: number[] } = {}): Promise<Ledger> {
  let debtorIds: number[] | null = null
  if (opts.saleIds) {
    const links = await db.debtorTransaction.findMany({ where: { transactionType: DEBT_TX.SALE, referenceType: 'SALE', referenceId: { in: opts.saleIds } }, select: { debtorId: true } })
    debtorIds = [...new Set(links.map((l) => l.debtorId))]
  }
  const debtors = await db.debtor.findMany({
    where: debtorIds ? { id: { in: debtorIds } } : {},
    select: { id: true, totalCreditAmount: true, createdAt: true, transactions: { select: { id: true, transactionType: true, referenceType: true, referenceId: true, amount: true, transactionDate: true } } },
  })
  const debtorOfSale = new Map<number, number>()
  for (const d of debtors) for (const t of d.transactions) if (t.transactionType === DEBT_TX.SALE && t.referenceType === 'SALE' && t.referenceId) debtorOfSale.set(t.referenceId, d.id)

  const saleIds = opts.saleIds ? [...new Set([...opts.saleIds, ...debtorOfSale.keys()])] : null
  const sales = await db.sale.findMany({ where: saleIds ? { id: { in: saleIds } } : {}, select: SALE_SELECT, orderBy: { id: 'asc' } })
  const refunds = await db.saleRefund.findMany({ where: saleIds ? { saleId: { in: saleIds } } : {}, select: REFUND_SELECT, orderBy: { id: 'asc' } })
  const byId = new Map(sales.map((s) => [s.id, s]))
  const creditRefunds = creditRefundCents(refunds)

  const events = saleAndRefundEvents(sales, refunds)
  for (const d of debtors) {
    const debts: LedgerDebt[] = []
    let linkedCents = 0
    for (const t of d.transactions) {
      const c = toCents(t.amount)
      if (t.transactionType === DEBT_TX.SALE) linkedCents += c
      else if (t.transactionType === DEBT_TX.CANCELLED || t.transactionType === DEBT_TX.REFUND) linkedCents -= c
      else if (t.transactionType === DEBT_TX.REFUND_VOIDED) linkedCents += c
      if (t.transactionType !== DEBT_TX.SALE || t.referenceType !== 'SALE' || !t.referenceId) continue
      const s = byId.get(t.referenceId)
      if (!s || s.status === 'CANCELLED') continue
      debts.push({ saleId: s.id, date: s.saleDate, cents: c - (creditRefunds.get(s.id) ?? 0) })
    }
    // Owed from before the system (imported balances): the oldest debt.
    const opening = toCents(d.totalCreditAmount) - linkedCents
    if (opening > 0) debts.push({ saleId: null, date: new Date(0), cents: opening })
    const payments = d.transactions.filter((t) => t.transactionType === 'PAYMENT').map((t) => ({ id: t.id, date: t.transactionDate, cents: toCents(t.amount) }))
    events.push(...allocatePayments(debts, payments))
  }
  return { sales, refunds, events, debtorOfSale }
}
