// VYRA Marketing Manager (ZP-1106, MM-01): the shop's truth, as the owner confirms it. Pure (safe in the browser).
// The facts live where they already are: MarketingSettings (voice, policies, market, sales mode...) and
// SiteSettings (WhatsApp number, phone, email, address, hours, payment methods). Nothing is copied.
// Rules:
// - Nothing is inferred: no market from photos or the phone number, no currency or time zone by default.
// - An empty policy stays unknown, and the AI never states it (product-truth.ts checks the words).
// - Every owner change, or an explicit "this is right", records who confirmed it and when.

/** v1 supports one value each (decision C11); anything else is refused plainly. */
export const SUPPORTED_CURRENCIES = ['USD'] as const
export const SUPPORTED_TIME_ZONES = ['Africa/Harare'] as const

export const SALES_MODES = ['RETAIL', 'WHOLESALE', 'BOTH'] as const
export type SalesMode = (typeof SALES_MODES)[number]
export const SALES_MODE_LABEL: Record<SalesMode, string> = {
  RETAIL: 'Retail only (single pieces to the public)',
  WHOLESALE: 'Wholesale only (bulk to other sellers)',
  BOTH: 'Both retail and wholesale',
}

export const CONTACT_ROUTES = ['WHATSAPP', 'PHONE', 'EMAIL', 'IN_SHOP'] as const
export type ContactRoute = (typeof CONTACT_ROUTES)[number]
export const CONTACT_ROUTE_LABEL: Record<ContactRoute, string> = {
  WHATSAPP: 'WhatsApp message',
  PHONE: 'Phone call',
  EMAIL: 'Email',
  IN_SHOP: 'Visit the shop',
}

/** The shop facts the owner confirms, in the order the setup asks for them. */
export const TRUTH_FIELDS = [
  'shopDescription', 'brandVoice', 'audienceNotes', 'salesMode', 'market', 'currency', 'timeZone',
  'contactRoute', 'policyDelivery', 'policyReturns', 'policyOrdering', 'monthlySpendCapCents',
] as const
export type TruthField = (typeof TRUTH_FIELDS)[number]

export const TRUTH_LABEL: Record<TruthField, string> = {
  shopDescription: 'The shop in one line',
  brandVoice: 'Brand voice',
  audienceNotes: 'Who you think buys (guesses)',
  salesMode: 'Retail or wholesale',
  market: 'Where you sell',
  currency: 'Currency',
  timeZone: 'Time zone',
  contactRoute: 'How customers reach you first',
  policyDelivery: 'Delivery and collection',
  policyReturns: 'Returns and exchanges',
  policyOrdering: 'How to order',
  monthlySpendCapCents: 'Monthly ad budget',
}

/** The one question asked when a fact is missing. */
export const TRUTH_QUESTION: Record<TruthField, string> = {
  shopDescription: 'What is the shop, in one line?',
  brandVoice: 'How should the shop sound when it writes?',
  audienceNotes: 'Who do you think buys from you? (These stay guesses until results show otherwise.)',
  salesMode: 'Do you sell retail, wholesale, or both?',
  market: 'Where do you sell (town or country)?',
  currency: 'Which currency do you sell in?',
  timeZone: 'Which time zone does the shop work in?',
  contactRoute: 'How do customers reach you first?',
  policyDelivery: 'Do you deliver, or do customers collect? Leave it empty if you do not want this mentioned.',
  policyReturns: 'Can customers return or exchange a piece? Leave it empty if you do not want this mentioned.',
  policyOrdering: 'How does a customer place an order?',
  monthlySpendCapCents: 'How much may ads spend in a month? (0 means no ads.)',
}

/** Policies: empty is a valid answer ("not known, never mention it"), so the owner can confirm empty. */
export const MAY_STAY_UNKNOWN: readonly TruthField[] = ['policyDelivery', 'policyReturns', 'policyOrdering', 'audienceNotes']

export interface Confirmation {
  by: string
  at: string
}
export type Confirmations = Partial<Record<TruthField, Confirmation>>

/** Read the stored JSON, dropping anything malformed. Never throws. */
export function readConfirmations(raw: unknown): Confirmations {
  const out: Confirmations = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const f of TRUTH_FIELDS) {
    const c = (raw as Record<string, unknown>)[f]
    if (typeof c !== 'object' || c === null) continue
    const { by, at } = c as Record<string, unknown>
    if (typeof by === 'string' && by && typeof at === 'string' && !Number.isNaN(Date.parse(at))) out[f] = { by, at }
  }
  return out
}

/** Audience guesses as a clean list. Never throws. */
export function readAudienceNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 8)
}

export interface TruthSettings {
  shopDescription: string | null
  brandVoice: string | null
  audienceNotes: unknown
  salesMode: string | null
  market: string | null
  currency: string | null
  timeZone: string | null
  contactRoute: string | null
  policyDelivery: string | null
  policyReturns: string | null
  policyOrdering: string | null
  monthlySpendCapCents: number
  confirmations: unknown
}

/** Contact facts the website settings already hold (shown, never copied). */
export interface SiteFacts {
  whatsappNumber: string | null
  phone: string | null
  email: string | null
  address: string | null
  openingHoursSet: boolean
  paymentMethods: string | null
  holdHours: number | null
}

/**
 * - confirmed: there is a value and the owner confirmed it.
 * - unconfirmed: there is a value (for example from before this setup) nobody has confirmed yet.
 * - unknown: empty on purpose, and the owner confirmed that. The AI will not mention it.
 * - missing: empty and never answered. The setup asks.
 */
export type TruthStatus = 'confirmed' | 'unconfirmed' | 'unknown' | 'missing'

export interface TruthItem {
  field: TruthField
  label: string
  value: string | number | string[] | null
  status: TruthStatus
  confirmedBy: string | null
  confirmedAt: string | null
  /** The question to ask, when the owner still has to answer. */
  question: string | null
}

export interface SetupState {
  items: TruthItem[]
  /** Only what is still missing or unconfirmed: the setup asks nothing else. */
  toAsk: TruthField[]
  /** True when every fact is confirmed (an empty policy confirmed as unknown counts). */
  complete: boolean
  site: SiteFacts
  /** Problems between the answers and the website settings (for example WhatsApp chosen but no number on file). */
  warnings: string[]
}

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

export function valueOf(s: TruthSettings, f: TruthField): TruthItem['value'] {
  if (f === 'audienceNotes') return readAudienceNotes(s.audienceNotes)
  return (s[f] as string | number | null) ?? null
}

/** The setup state: what is known, who confirmed it, and what still has to be asked. Pure. */
export function setupState(s: TruthSettings, site: SiteFacts): SetupState {
  const conf = readConfirmations(s.confirmations)
  const items: TruthItem[] = TRUTH_FIELDS.map((field) => {
    const value = valueOf(s, field)
    const c = conf[field] ?? null
    const empty = isEmpty(value)
    // The monthly cap always has a number (0 by default); it counts as answered only once confirmed.
    let status: TruthStatus
    if (empty) status = c && MAY_STAY_UNKNOWN.includes(field) ? 'unknown' : 'missing'
    else status = c ? 'confirmed' : 'unconfirmed'
    return {
      field, label: TRUTH_LABEL[field], value, status,
      confirmedBy: c?.by ?? null, confirmedAt: c?.at ?? null,
      question: status === 'missing' || status === 'unconfirmed' ? TRUTH_QUESTION[field] : null,
    }
  })
  const warnings: string[] = []
  const route = s.contactRoute
  if (route === 'WHATSAPP' && !site.whatsappNumber) warnings.push('You chose WhatsApp, but the website settings have no WhatsApp number. Add it under Website > Settings.')
  if (route === 'PHONE' && !site.phone) warnings.push('You chose phone calls, but the website settings have no phone number. Add it under Website > Settings.')
  if (route === 'EMAIL' && !site.email) warnings.push('You chose email, but the website settings have no email address. Add it under Website > Settings.')
  if (route === 'IN_SHOP' && !site.address) warnings.push('You chose visits, but the website settings have no shop address. Add it under Website > Settings.')
  const toAsk = items.filter((i) => i.question).map((i) => i.field)
  return { items, toAsk, complete: toAsk.length === 0, site, warnings }
}
