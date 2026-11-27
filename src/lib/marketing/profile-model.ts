// VYRA Marketing hub: the shape of a product's selling profile, and how it is cleaned. Pure (safe in the browser).
// Type aliases (not interfaces) so they are accepted as Prisma JSON values.
export type Buyer = { who: string; moment: string }
export type Reason = { reason: string; fact: string }
/** answer null means the AI had nothing true to answer with: the owner is asked. */
export type Doubt = { doubt: string; answer: string | null }
export interface SellingProfile {
  buyers: Buyer[]
  reasons: Reason[]
  doubts: Doubt[]
  occasions: string[]
}

export const PROFILE_LIMITS = { buyers: 5, reasons: 5, doubts: 8, occasions: 8, text: 300 } as const

/** A profile never carries a money amount: prices are filled by code, from the product row. */
const MONEY = /(?:[$£€]\s?\d|\b\d+(?:[.,]\d+)?\s?(?:usd|dollars?|zwl|rand|zar)\b)/i
export const ASK = /^\s*ask the owner\.?\s*$/i

function line(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t || MONEY.test(t)) return null
  return t.slice(0, PROFILE_LIMITS.text)
}
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)) : []

/** Keep only well-formed, money-free entries, within the limits. Never throws: junk is dropped. */
export function cleanProfile(raw: unknown): SellingProfile {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const buyers: Buyer[] = []
  for (const r of rows(o.buyers)) {
    const who = line(r.who)
    const moment = line(r.moment)
    if (who && moment) buyers.push({ who, moment })
  }
  const reasons: Reason[] = []
  for (const r of rows(o.reasons)) {
    const reason = line(r.reason)
    const fact = line(r.fact)
    if (reason && fact) reasons.push({ reason, fact })
  }
  const doubts: Doubt[] = []
  for (const r of rows(o.doubts)) {
    const doubt = line(r.doubt)
    if (!doubt) continue
    const a = typeof r.answer === 'string' && !ASK.test(r.answer) ? line(r.answer) : null
    doubts.push({ doubt, answer: a })
  }
  const occasions = (Array.isArray(o.occasions) ? o.occasions : []).map(line).filter((x): x is string => x !== null)
  return {
    buyers: buyers.slice(0, PROFILE_LIMITS.buyers),
    reasons: reasons.slice(0, PROFILE_LIMITS.reasons),
    doubts: doubts.slice(0, PROFILE_LIMITS.doubts),
    occasions: [...new Set(occasions)].slice(0, PROFILE_LIMITS.occasions),
  }
}

/** "who, moment" as the brief's reader line. */
export const buyerLine = (b: Buyer): string => `${b.who}, ${b.moment}`
/** A doubt with its answer, as a brief message. */
export const doubtLine = (d: Doubt): string | null => (d.answer ? `Answer the doubt "${d.doubt}": ${d.answer}` : null)
