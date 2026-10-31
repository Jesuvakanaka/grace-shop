import type { Prisma, PrismaClient } from '@prisma/client'
import { startOfDay } from 'date-fns'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Get the cash position row for `date`'s day, creating it if it does not exist yet.
 *
 * Safe under concurrency: the row is inserted with INSERT ... ON CONFLICT DO NOTHING
 * (createMany + skipDuplicates), so when several writers open the same new day at
 * once exactly one row is created and nobody hits the cashDate unique constraint.
 * Works with the plain client or inside an interactive transaction (a P2002 there
 * would abort the whole transaction, which is why we avoid catching it).
 *
 * The opening cash of a new day is the previous day's counted cash, falling back
 * to its expected closing cash, else 0.
 */
export async function ensureCashPosition(db: Db, date: Date, createdBy?: string) {
  const cashDate = startOfDay(date)
  const existing = await db.cashPosition.findUnique({ where: { cashDate } })
  if (existing) return existing

  const prev = await db.cashPosition.findFirst({
    where: { cashDate: { lt: cashDate } },
    orderBy: { cashDate: 'desc' }
  })
  const openingCash = prev?.actualCountedCash ?? prev?.expectedClosingCash ?? 0
  await db.cashPosition.createMany({
    data: [{ cashDate, openingCash, expectedClosingCash: openingCash, createdBy }],
    skipDuplicates: true
  })
  return db.cashPosition.findUniqueOrThrow({ where: { cashDate } })
}
