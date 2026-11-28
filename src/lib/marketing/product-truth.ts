// VYRA Marketing Manager (ZP-1106, MM-01-AC2/AC4/AC5): what may truthfully be said about a product. Pure.
// Built from the Product row (by its id, never a copy) and the shop's confirmed policies.
// - A withdrawn (unpublished) or sold-out piece is not marketed.
// - A pre-order keeps its real ship window; it is never "in stock" or "ready to ship".
// - Unknown delivery or returns policy never becomes a claim.
// - Retail and wholesale stay separate: a wholesale price is only said when the shop sells wholesale and
//   both the wholesale price and the minimum quantity are on file. Code fills it ({wholesale}), never the AI.
import type { SalesMode } from './shop-truth'

export interface TruthProduct {
  id: number
  productName: string
  publicName?: string | null
  published: boolean
  listingType: string
  currentQuantity: number
  preorderShipFrom: Date | null
  preorderShipTo: Date | null
  wholesalePriceUsd?: number | null
  wholesaleMinQuantity?: number | null
}

export type Availability =
  | { kind: 'WITHDRAWN' }
  | { kind: 'SOLD_OUT' }
  | { kind: 'IN_STOCK'; quantity: number }
  | { kind: 'PRE_ORDER'; shipFrom: Date | null; shipTo: Date | null }

export function availabilityOf(p: TruthProduct): Availability {
  if (!p.published) return { kind: 'WITHDRAWN' }
  if (p.listingType === 'PRE_ORDER') return { kind: 'PRE_ORDER', shipFrom: p.preorderShipFrom, shipTo: p.preorderShipTo }
  if (p.currentQuantity <= 0) return { kind: 'SOLD_OUT' }
  return { kind: 'IN_STOCK', quantity: p.currentQuantity }
}

const nameOf = (p: TruthProduct) => `"${p.publicName?.trim() || p.productName}"`

/** Why this product may not be marketed right now, or null when it may. */
export function productBlockReason(p: TruthProduct): string | null {
  const a = availabilityOf(p)
  if (a.kind === 'WITHDRAWN') return `${nameOf(p)} is not on the website any more, so it is not marketed. Publish it again or choose another piece.`
  if (a.kind === 'SOLD_OUT') return `${nameOf(p)} is sold out, so it is not marketed. Add stock or choose another piece.`
  return null
}

/** preorderShip* are calendar dates stored at UTC midnight: print them without shifting the day. */
const calendar = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)

export function availabilityLine(a: Availability): string {
  if (a.kind === 'WITHDRAWN') return 'Not on the website (withdrawn).'
  if (a.kind === 'SOLD_OUT') return 'Sold out.'
  if (a.kind === 'IN_STOCK') return 'In stock.'
  if (a.shipFrom && a.shipTo) return `On pre-order: ships between ${calendar(a.shipFrom)} and ${calendar(a.shipTo)}. Not in stock yet.`
  if (a.shipFrom) return `On pre-order: ships from ${calendar(a.shipFrom)}. Not in stock yet.`
  return 'On pre-order. The ship date is not known yet: never give one. Not in stock yet.'
}

export type WholesaleOffer = { ok: true; priceUsd: number; minQuantity: number } | { ok: false; reason: string }

/** The wholesale offer the shop may state, or why it may not (MM-01-AC5). */
export function wholesaleOffer(p: Pick<TruthProduct, 'wholesalePriceUsd' | 'wholesaleMinQuantity'>, salesMode: SalesMode | string | null | undefined): WholesaleOffer {
  if (salesMode !== 'WHOLESALE' && salesMode !== 'BOTH') return { ok: false, reason: 'The shop has not said it sells wholesale.' }
  const price = p.wholesalePriceUsd
  const min = p.wholesaleMinQuantity
  if (price === null || price === undefined || !(price > 0)) return { ok: false, reason: 'This product has no wholesale price on file.' }
  if (min === null || min === undefined || !Number.isInteger(min) || min < 1) return { ok: false, reason: 'This product has no minimum wholesale quantity on file.' }
  return { ok: true, priceUsd: price, minQuantity: min }
}

export const wholesaleText = (o: { priceUsd: number; minQuantity: number }): string =>
  `${Number.isInteger(o.priceUsd) ? `$${o.priceUsd}` : `$${o.priceUsd.toFixed(2)}`} each when you buy ${o.minQuantity} or more`

export interface ShopPolicyFacts {
  delivery?: string | null
  returns?: string | null
  ordering?: string | null
  salesMode?: SalesMode | string | null
}

export interface TruthFacts {
  /** null: the content is about no particular product. */
  availability: Availability | null
  wholesale: WholesaleOffer
  deliveryKnown: boolean
  returnsKnown: boolean
}

export function truthFacts(p: TruthProduct, shop: ShopPolicyFacts): TruthFacts {
  return {
    availability: availabilityOf(p),
    wholesale: wholesaleOffer(p, shop.salesMode),
    deliveryKnown: Boolean(shop.delivery?.trim()),
    returnsKnown: Boolean(shop.returns?.trim()),
  }
}

/** Content about no particular product: only the shop's policies apply, and nothing wholesale may be said. */
export function shopTruth(shop: ShopPolicyFacts): { facts: TruthFacts; lines: string[] } {
  const facts: TruthFacts = {
    availability: null,
    wholesale: { ok: false, reason: 'No product with wholesale terms was chosen.' },
    deliveryKnown: Boolean(shop.delivery?.trim()),
    returnsKnown: Boolean(shop.returns?.trim()),
  }
  const lines = [
    facts.deliveryKnown ? `Delivery (the shop's own words): ${shop.delivery!.trim()}` : 'Delivery: NOT KNOWN. Never mention delivery, shipping or couriers.',
    facts.returnsKnown ? `Returns (the shop's own words): ${shop.returns!.trim()}` : 'Returns: NOT KNOWN. Never mention returns, exchanges or refunds.',
    ...(shop.ordering?.trim() ? [`How to order (the shop's own words): ${shop.ordering.trim()}`] : []),
    'Stock and wholesale: not given. Never mention stock levels or wholesale prices.',
  ]
  return { facts, lines }
}

/**
 * The lines the writer is given (and the checker reads): the real availability, the known policies as facts,
 * and a plain "never mention" line for every unknown one. Policies are the owner's own words.
 */
export function truthLines(p: TruthProduct, shop: ShopPolicyFacts): string[] {
  const t = truthFacts(p, shop)
  const lines = [`Availability: ${availabilityLine(availabilityOf(p))}`]
  lines.push(t.deliveryKnown ? `Delivery (the shop's own words): ${shop.delivery!.trim()}` : 'Delivery: NOT KNOWN. Never mention delivery, shipping or couriers.')
  lines.push(t.returnsKnown ? `Returns (the shop's own words): ${shop.returns!.trim()}` : 'Returns: NOT KNOWN. Never mention returns, exchanges or refunds.')
  if (shop.ordering?.trim()) lines.push(`How to order (the shop's own words): ${shop.ordering.trim()}`)
  lines.push(t.wholesale.ok
    ? 'Wholesale: the shop sells this wholesale. To mention the wholesale price write {wholesale}; never write the figures yourself. Keep it apart from the retail price.'
    : 'Wholesale: NOT OFFERED for this product. Never mention wholesale, bulk or trade prices.')
  return lines
}

const DELIVERY = /\b(deliver(?:y|ies|ed|s)?|courier(?:ed|s)?|same[- ]day|next[- ]day|door[- ]to[- ]door|free shipping)\b/i
const SHIPPING = /\b(ship(?:s|ping|ped)?|dispatch(?:es|ed)?)\b/i
const RETURNS = /\b(returns?|returnable|exchange(?:s|d|able)?|refund(?:s|ed|able)?|money[- ]back)\b/i
const IN_STOCK = /\b(in stock|ready to (?:ship|wear|go|collect)|available (?:now|today|immediately)|ships? (?:today|now|immediately|right away)|on hand|grab yours today)\b/i
const WHOLESALE = /\b(wholesale|bulk|trade price|resellers?|in quantity)\b/i

/**
 * The code's own truth check on generated words (MM-01-AC2/AC4/AC5, before placeholders are filled).
 * `allowed` is what the writer was given (brief, facts, owner's notes): a phrase the owner wrote there is not a fault.
 * Returns one plain sentence per problem; an empty list passes.
 */
export function truthProblems(text: string, facts: TruthFacts, allowed = ''): string[] {
  const out: string[] = []
  const said = (re: RegExp) => {
    const m = text.match(re)
    return m && !allowed.toLowerCase().includes(m[0].toLowerCase()) ? m[0] : null
  }
  const isPreorder = facts.availability?.kind === 'PRE_ORDER'
  if (!facts.deliveryKnown) {
    const m = said(DELIVERY) ?? (isPreorder ? null : said(SHIPPING))
    if (m) out.push(`It talks about delivery ("${m}") but the shop's delivery policy is not known. Remove it.`)
  }
  if (!facts.returnsKnown) {
    const m = said(RETURNS)
    if (m) out.push(`It talks about returns ("${m}") but the shop's returns policy is not known. Remove it.`)
  }
  if (isPreorder) {
    const m = text.match(IN_STOCK)
    if (m) out.push(`It says "${m[0]}" but this piece is on pre-order and not in stock yet. Say it is on pre-order instead.`)
  }
  if (!facts.wholesale.ok) {
    const m = said(WHOLESALE)
    if (m) out.push(`It mentions wholesale ("${m}") but ${facts.wholesale.reason.charAt(0).toLowerCase()}${facts.wholesale.reason.slice(1).replace(/\.$/, '')}. Remove it.`)
  }
  if (/\{wholesale\}/.test(text) && !facts.wholesale.ok) out.push(`It uses the wholesale price but ${facts.wholesale.reason.charAt(0).toLowerCase()}${facts.wholesale.reason.slice(1)}`)
  return out
}
