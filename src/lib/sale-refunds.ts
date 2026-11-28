// ZP-1118 (MM-13-AC5): refunds and cancellations on the existing sales ledger. Server only.
// - A refund is its own row on its own date, never an edit of the sale. CASH pays money back from the till that day;
//   CREDIT takes it off what the customer owes. Pieces given back return to stock.
// - A refund is never edited or deleted. A mistake is corrected by voiding it: its effects are reversed on the void
//   date and the row stays, with who voided it, when and why.
// - A sale can be cancelled only while nothing has been collected for it (an order that was never paid). It keeps its
//   row, its stock comes back and the customer no longer owes it. A paid sale is refunded instead.
// - Every refund, void and cancellation is checked against the sale under a row lock, so two at once cannot overspend.
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { ensureCashPosition } from '@/lib/cash-position'
import { WebsiteError } from '@/lib/website/http'
import { DEBT_TX, loadLedger, type Db } from './sale-ledger-db'
import { fromCents, saleMoney, toCents, type SaleMoney } from './sales-ledger'

export const REFUND_METHODS = ['CASH', 'CREDIT'] as const
export type RefundMethod = (typeof REFUND_METHODS)[number]

type Tx = Prisma.TransactionClient

async function inTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return '$transaction' in db ? (db as typeof prisma).$transaction(fn) : fn(db as Tx)
}

async function lockSale(tx: Tx, saleId: number) {
  await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${saleId} FOR UPDATE`
  const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true } })
  if (!sale) throw new WebsiteError(404, 'Sale not found')
  return sale
}

/** The money of one sale now: collected, refunded, still owed. */
export async function moneyOfSale(db: Db, saleId: number): Promise<SaleMoney & { saleId: number }> {
  const ledger = await loadLedger(db, { saleIds: [saleId] })
  const sale = ledger.sales.find((s) => s.id === saleId)
  if (!sale) throw new WebsiteError(404, 'Sale not found')
  return { saleId, ...saleMoney(sale, ledger.events, ledger.refunds) }
}

async function debtorOf(tx: Tx, saleId: number) {
  const link = await tx.debtorTransaction.findFirst({ where: { transactionType: DEBT_TX.SALE, referenceType: 'SALE', referenceId: saleId }, select: { debtorId: true } })
  return link ? tx.debtor.findUnique({ where: { id: link.debtorId } }) : null
}

/** Change what a customer owes by `delta` (negative: owes less), keeping the debtor's status right. */
async function changeDebt(tx: Tx, debtorId: number, delta: number) {
  // Lock the customer's row: a payment recorded at the same moment must not overwrite this change.
  await tx.$queryRaw`SELECT id FROM "Debtor" WHERE id = ${debtorId} FOR UPDATE`
  const d = await tx.debtor.findUniqueOrThrow({ where: { id: debtorId } })
  const totalCreditAmount = fromCents(toCents(d.totalCreditAmount) + toCents(delta))
  const outstandingBalance = fromCents(toCents(d.outstandingBalance) + toCents(delta))
  const status = outstandingBalance <= 0 ? 'PAID' : d.totalPaid > 0 ? 'PART_PAID' : 'OPEN'
  await tx.debtor.update({ where: { id: debtorId }, data: { totalCreditAmount, outstandingBalance, status } })
}

async function moveStock(tx: Tx, productId: number, qty: number, date: Date, saleId: number, notes: string, createdBy: string) {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId } })
  const closing = p.currentQuantity + qty
  if (closing < 0) throw new WebsiteError(409, `There are not enough pieces of ${p.itemNumber} in stock to take back.`)
  await tx.stockMovement.create({
    data: { productId, movementDate: date, movementType: qty >= 0 ? 'RETURN' : 'ADJUSTMENT', quantity: qty, openingBalance: p.currentQuantity, closingBalance: closing, referenceType: 'SALE', referenceId: saleId, notes, createdBy },
  })
  await tx.product.update({ where: { id: productId }, data: { currentQuantity: closing } })
}

async function cashOut(tx: Tx, date: Date, amount: number, createdBy: string) {
  const pos = await ensureCashPosition(tx, date, createdBy)
  await tx.cashPosition.update({ where: { id: pos.id }, data: { refundsPaid: { increment: amount }, expectedClosingCash: { decrement: amount } } })
}

async function assertDayOpen(tx: Tx, date: Date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const closing = await tx.dayClosing.findUnique({ where: { closingDate: start } })
  if (closing?.status === 'CLOSED') throw new WebsiteError(409, 'Today is already closed, so no money can be paid out or taken back today.')
}

export interface RefundInput {
  amount: number
  method: RefundMethod
  reason: string
  saleItemId?: number | null
  quantity?: number
  requestKey?: string | null
}

export function parseRefund(body: unknown): RefundInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new WebsiteError(400, 'Send the refund as an object.')
  const o = body as Record<string, unknown>
  const allowed = ['amount', 'method', 'reason', 'saleItemId', 'quantity', 'requestKey']
  const extra = Object.keys(o).filter((k) => !allowed.includes(k))
  if (extra.length) throw new WebsiteError(400, `Unknown field: ${extra[0]}`, { field: extra[0] })
  const amount = typeof o.amount === 'number' ? o.amount : Number.NaN
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new WebsiteError(400, 'The refund amount must be more than 0.', { field: 'amount' })
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new WebsiteError(400, 'The refund amount can have at most 2 decimals.', { field: 'amount' })
  if (!REFUND_METHODS.includes(o.method as RefundMethod)) throw new WebsiteError(400, 'Choose how the refund is given: CASH (money paid back) or CREDIT (taken off what they owe).', { field: 'method' })
  const reason = typeof o.reason === 'string' ? o.reason.trim() : ''
  if (!reason || reason.length > 300) throw new WebsiteError(400, 'Say why the refund is given (up to 300 characters).', { field: 'reason' })
  const saleItemId = o.saleItemId === undefined || o.saleItemId === null ? null : Number(o.saleItemId)
  if (saleItemId !== null && !Number.isInteger(saleItemId)) throw new WebsiteError(400, 'Choose a line of this sale.', { field: 'saleItemId' })
  const quantity = o.quantity === undefined ? 0 : Number(o.quantity)
  if (!Number.isInteger(quantity) || quantity < 0) throw new WebsiteError(400, 'Pieces returned must be a whole number.', { field: 'quantity' })
  if (quantity > 0 && saleItemId === null) throw new WebsiteError(400, 'Choose the line the returned pieces come from.', { field: 'saleItemId' })
  const requestKey = typeof o.requestKey === 'string' && o.requestKey.trim() ? o.requestKey.trim().slice(0, 100) : null
  return { amount: fromCents(toCents(amount)), method: o.method as RefundMethod, reason, saleItemId, quantity, requestKey }
}

/**
 * Record a refund dated now. A retried request with the same requestKey returns the first refund and changes nothing.
 * CASH: at most what was collected and not yet refunded. CREDIT: at most what the customer still owes for the sale.
 */
export async function recordRefund(db: Db, saleId: number, body: unknown, actor: string, now = new Date()) {
  const input = parseRefund(body)
  if (input.requestKey) {
    const seen = await db.saleRefund.findUnique({ where: { requestKey: input.requestKey } })
    if (seen) {
      if (seen.saleId !== saleId) throw new WebsiteError(409, 'That request key belongs to another refund.')
      return { refund: seen, duplicate: true }
    }
  }
  try {
    return await refundInTx(db, saleId, input, actor, now)
  } catch (e) {
    // Two identical retries at once: the second loses on the unique key and gets the first refund.
    if (input.requestKey && isUniqueViolation(e)) {
      const seen = await db.saleRefund.findUnique({ where: { requestKey: input.requestKey } })
      if (seen && seen.saleId === saleId) return { refund: seen, duplicate: true }
    }
    throw e
  }
}

async function refundInTx(db: Db, saleId: number, input: RefundInput, actor: string, now: Date) {
  return inTx(db, async (tx) => {
    const sale = await lockSale(tx, saleId)
    if (sale.status === 'CANCELLED') throw new WebsiteError(409, 'This sale was cancelled, so there is nothing to refund.')
    if (input.method === 'CASH') await assertDayOpen(tx, now)
    const money = await moneyOfSale(tx, saleId)
    const cents = toCents(input.amount)
    if (input.method === 'CASH' && cents > money.collectedCents - money.cashRefundedCents) {
      throw new WebsiteError(409, `Only ${fromCents(money.collectedCents - money.cashRefundedCents).toFixed(2)} was collected for this sale and not refunded yet.`, { field: 'amount' })
    }
    if (input.method === 'CREDIT' && cents > money.outstandingCents) {
      throw new WebsiteError(409, `The customer owes only ${fromCents(money.outstandingCents).toFixed(2)} for this sale.`, { field: 'amount' })
    }
    const item = input.saleItemId ? sale.items.find((i) => i.id === input.saleItemId) : null
    if (input.saleItemId && !item) throw new WebsiteError(400, 'That line is not part of this sale.', { field: 'saleItemId' })
    if (item && input.quantity) {
      const back = await tx.saleRefund.aggregate({ where: { saleItemId: item.id, voidedAt: null }, _sum: { quantity: true } })
      if ((back._sum.quantity ?? 0) + input.quantity > item.quantity) throw new WebsiteError(409, `Only ${item.quantity - (back._sum.quantity ?? 0)} pieces of this line can still come back.`, { field: 'quantity' })
    }
    const refund = await tx.saleRefund.create({
      data: { saleId, saleItemId: item?.id ?? null, refundDate: now, amount: input.amount, quantity: input.quantity ?? 0, method: input.method, reason: input.reason, requestKey: input.requestKey, createdBy: actor },
    })
    if (item && input.quantity) await moveStock(tx, item.productId, input.quantity, now, saleId, `Returned (refund ${refund.id})`, actor)
    if (input.method === 'CASH') await cashOut(tx, now, input.amount, actor)
    else {
      const debtor = await debtorOf(tx, saleId)
      if (!debtor) throw new WebsiteError(409, 'This sale has no customer account to take the refund off.')
      await changeDebt(tx, debtor.id, -input.amount)
      await tx.debtorTransaction.create({ data: { debtorId: debtor.id, transactionDate: now, transactionType: DEBT_TX.REFUND, amount: input.amount, referenceType: 'SALE', referenceId: saleId, notes: `Refund ${refund.id}: ${input.reason}`.slice(0, 300), createdBy: actor } })
    }
    return { refund, duplicate: false }
  })
}

/** Correct a mistaken refund: reverse its effects today and keep the row, marked voided. */
export async function voidRefund(db: Db, refundId: number, reasonIn: unknown, actor: string, now = new Date()) {
  const reason = typeof reasonIn === 'string' ? reasonIn.trim() : ''
  if (!reason || reason.length > 300) throw new WebsiteError(400, 'Say why this refund is being corrected (up to 300 characters).', { field: 'reason' })
  const first = await db.saleRefund.findUnique({ where: { id: refundId } })
  if (!first) throw new WebsiteError(404, 'Refund not found')
  return inTx(db, async (tx) => {
    await lockSale(tx, first.saleId)
    const r = await tx.saleRefund.findUniqueOrThrow({ where: { id: refundId } })
    if (r.voidedAt) throw new WebsiteError(409, 'This refund was already corrected.')
    if (r.method === 'CASH') await assertDayOpen(tx, now)
    if (r.method === 'CREDIT') {
      // Owing the amount again must still make sense: the sale is not cancelled.
      const debtor = await debtorOf(tx, r.saleId)
      if (!debtor) throw new WebsiteError(409, 'This sale has no customer account.')
      await changeDebt(tx, debtor.id, r.amount)
      await tx.debtorTransaction.create({ data: { debtorId: debtor.id, transactionDate: now, transactionType: DEBT_TX.REFUND_VOIDED, amount: r.amount, referenceType: 'SALE', referenceId: r.saleId, notes: `Refund ${r.id} corrected: ${reason}`.slice(0, 300), createdBy: actor } })
    } else {
      const pos = await ensureCashPosition(tx, now, actor)
      await tx.cashPosition.update({ where: { id: pos.id }, data: { refundsPaid: { decrement: r.amount }, expectedClosingCash: { increment: r.amount } } })
    }
    if (r.saleItemId && r.quantity > 0) {
      const item = await tx.saleItem.findUniqueOrThrow({ where: { id: r.saleItemId } })
      await moveStock(tx, item.productId, -r.quantity, now, r.saleId, `Refund ${r.id} corrected`, actor)
    }
    return tx.saleRefund.update({ where: { id: refundId }, data: { voidedAt: now, voidedBy: actor, voidReason: reason } })
  })
}

/** Cancel a sale nothing was collected for. Stock comes back and the customer no longer owes it. The row stays. */
export async function cancelSale(db: Db, saleId: number, reasonIn: unknown, actor: string, now = new Date()) {
  const reason = typeof reasonIn === 'string' ? reasonIn.trim() : ''
  if (!reason || reason.length > 300) throw new WebsiteError(400, 'Say why the sale is cancelled (up to 300 characters).', { field: 'reason' })
  return inTx(db, async (tx) => {
    const sale = await lockSale(tx, saleId)
    if (sale.status === 'CANCELLED') throw new WebsiteError(409, 'This sale is already cancelled.')
    const money = await moneyOfSale(tx, saleId)
    if (money.collectedCents > 0) throw new WebsiteError(409, 'Money was already collected for this sale. Record a refund instead of cancelling it.')
    if (await tx.saleRefund.count({ where: { saleId, voidedAt: null } })) throw new WebsiteError(409, 'This sale has refunds. Correct them first, or keep the sale.')
    for (const item of sale.items) await moveStock(tx, item.productId, item.quantity, now, saleId, `Sale ${saleId} cancelled`, actor)
    const owed = fromCents(money.outstandingCents)
    if (owed > 0) {
      const debtor = await debtorOf(tx, saleId)
      if (debtor) {
        await changeDebt(tx, debtor.id, -owed)
        await tx.debtorTransaction.create({ data: { debtorId: debtor.id, transactionDate: now, transactionType: DEBT_TX.CANCELLED, amount: owed, referenceType: 'SALE', referenceId: saleId, notes: `Sale ${saleId} cancelled: ${reason}`.slice(0, 300), createdBy: actor } })
      }
    }
    return tx.sale.update({ where: { id: saleId }, data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: actor, cancelReason: reason } })
  })
}

/** A sale with its refunds and money, for the sales screen. */
export async function saleWithMoney(db: Db, saleId: number) {
  const sale = await db.sale.findUnique({ where: { id: saleId }, include: { items: { include: { product: true } }, refunds: { orderBy: { id: 'asc' } } } })
  if (!sale) return null
  const m = await moneyOfSale(db, saleId)
  return {
    ...sale,
    money: { collected: fromCents(m.collectedCents), cashRefunded: fromCents(m.cashRefundedCents), creditRefunded: fromCents(m.creditRefundedCents), outstanding: fromCents(m.outstandingCents), net: fromCents(m.collectedCents - m.cashRefundedCents) },
  }
}

export const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
