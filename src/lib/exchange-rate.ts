import prisma from '@/lib/db'

export async function getActiveExchangeRate() {
  return prisma.exchangeRate.findFirst({
    orderBy: { effectiveDate: 'desc' }
  })
}

export async function getAllExchangeRates() {
  return prisma.exchangeRate.findMany({
    orderBy: { effectiveDate: 'desc' }
  })
}

export async function createExchangeRate(data: {
  rmbToUsd: number
  effectiveDate: Date
  notes?: string
  createdBy?: string
}) {
  return prisma.exchangeRate.create({ data })
}

export async function convertRmbToUsd(amountRmb: number, rate?: number) {
  if (rate) return amountRmb * rate
  const activeRate = await getActiveExchangeRate()
  if (!activeRate) throw new Error('No exchange rate available')
  return amountRmb * activeRate.rmbToUsd
}
