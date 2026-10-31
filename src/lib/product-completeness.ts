// "Needs details" check for products (ZP-475; reused by the ZP-468 import).
//
// A product needs details when any reason below applies:
// - 'cost price'      : both unitCostUsd and unitCostRmb are 0 (or missing).
//                       One currency is enough, since the other can be derived.
// - 'retail price'    : sellingPriceUsd is 0 (or missing).
// - 'wholesale price' : wholesalePriceUsd is not set (null/undefined).
//                       A wholesale price of 0 is a deliberate value, not missing.
//
// Stock quantity is deliberately NOT checked: 0 on hand is a normal state
// (sold out), so it says nothing about whether the product record is complete.
// wholesaleMinQuantity is not checked either; the owner decision only asks
// for the wholesale price.

export type MissingProductDetail = 'cost price' | 'retail price' | 'wholesale price'

export type ProductCompletenessInput = {
  unitCostRmb?: number | null
  unitCostUsd?: number | null
  sellingPriceUsd?: number | null
  wholesalePriceUsd?: number | null
}

const isPositive = (n: number | null | undefined) => typeof n === 'number' && n > 0

/** Reasons the product needs details, in a stable order. Empty when complete. */
export function getMissingProductDetails(product: ProductCompletenessInput): MissingProductDetail[] {
  const missing: MissingProductDetail[] = []
  if (!isPositive(product.unitCostUsd) && !isPositive(product.unitCostRmb)) missing.push('cost price')
  if (!isPositive(product.sellingPriceUsd)) missing.push('retail price')
  if (product.wholesalePriceUsd === null || product.wholesalePriceUsd === undefined) missing.push('wholesale price')
  return missing
}

export function productNeedsDetails(product: ProductCompletenessInput): boolean {
  return getMissingProductDetails(product).length > 0
}
