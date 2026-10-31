// Server-side validation for product fields (ZP-475).
// Pure functions: no database access, safe to unit test and reuse.

export type WholesaleFields = {
  wholesalePriceUsd?: number | null
  wholesaleMinQuantity?: number | null
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Upper bound for both fields: far above any real price or order size. */
export const WHOLESALE_MAX = 1_000_000

// Plain decimal text only: no sign, hex, exponent, thousands separator or
// leading/trailing dot ("0x10", "1e3", "+5", ".5" are all rejected).
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/
const PLAIN_INTEGER = /^\d+$/

export const WHOLESALE_PRICE_ERROR =
  'Wholesale price must be a number from 0 to 1,000,000, or left empty.'
export const WHOLESALE_MIN_QUANTITY_ERROR =
  'Wholesale minimum quantity must be a whole number from 1 to 1,000,000, or left empty.'

/**
 * Turn a raw JSON value into a number, null ("not set") or 'invalid'.
 * - null, '' and whitespace-only strings mean "not set" -> null (never 0).
 * - finite numbers, and strings matching `pattern` (after trimming), are accepted.
 * - anything else (booleans, objects, arrays, '12abc', '0x10', NaN, Infinity) is invalid.
 */
function toOptionalNumber(value: unknown, pattern: RegExp): number | null | 'invalid' {
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : 'invalid'
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    return pattern.test(trimmed) ? Number(trimmed) : 'invalid'
  }
  return 'invalid'
}

/**
 * Validate the wholesale fields of a product create/update body.
 * Fields that are absent (undefined) are left out of `data`, so an update
 * does not touch them. Present fields come back as a number or null.
 */
export function parseWholesaleFields(body: unknown): ParseResult<WholesaleFields> {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const data: WholesaleFields = {}

  if (src.wholesalePriceUsd !== undefined) {
    const price = toOptionalNumber(src.wholesalePriceUsd, PLAIN_DECIMAL)
    if (price === 'invalid' || (price !== null && (price < 0 || price > WHOLESALE_MAX))) {
      return { ok: false, error: WHOLESALE_PRICE_ERROR }
    }
    data.wholesalePriceUsd = price
  }

  if (src.wholesaleMinQuantity !== undefined) {
    const qty = toOptionalNumber(src.wholesaleMinQuantity, PLAIN_INTEGER)
    if (qty === 'invalid' || (qty !== null && (!Number.isInteger(qty) || qty < 1 || qty > WHOLESALE_MAX))) {
      return { ok: false, error: WHOLESALE_MIN_QUANTITY_ERROR }
    }
    data.wholesaleMinQuantity = qty
  }

  return { ok: true, data }
}
