// Server-side validation for product fields (ZP-475).
// Pure functions: no database access, safe to unit test and reuse.

export type WholesaleFields = {
  wholesalePriceUsd?: number | null
  wholesaleMinQuantity?: number | null
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string }

const INT32_MAX = 2147483647

export const WHOLESALE_PRICE_ERROR =
  'Wholesale price must be a number of 0 or more, or left empty.'
export const WHOLESALE_MIN_QUANTITY_ERROR =
  'Wholesale minimum quantity must be a whole number of 1 or more, or left empty.'

/**
 * Turn a raw JSON value into a number, null ("not set") or 'invalid'.
 * - null, '' and whitespace-only strings mean "not set" -> null (never 0).
 * - finite numbers and plain numeric strings are accepted.
 * - anything else (booleans, objects, arrays, '12abc', NaN, Infinity) is invalid.
 */
function toOptionalNumber(value: unknown): number | null | 'invalid' {
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : 'invalid'
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : 'invalid'
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
    const price = toOptionalNumber(src.wholesalePriceUsd)
    if (price === 'invalid' || (price !== null && price < 0)) {
      return { ok: false, error: WHOLESALE_PRICE_ERROR }
    }
    data.wholesalePriceUsd = price
  }

  if (src.wholesaleMinQuantity !== undefined) {
    const qty = toOptionalNumber(src.wholesaleMinQuantity)
    if (qty === 'invalid' || (qty !== null && (!Number.isInteger(qty) || qty < 1 || qty > INT32_MAX))) {
      return { ok: false, error: WHOLESALE_MIN_QUANTITY_ERROR }
    }
    data.wholesaleMinQuantity = qty
  }

  return { ok: true, data }
}
