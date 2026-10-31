// "Needs details" check for products (ZP-475; extended by the ZP-468 import).
//
// A product needs details when any reason below applies:
// - 'quantity'        : (ZP-468) the product came from a spreadsheet import
//                       (sourceFilename is set) and has never had stock:
//                       openingQuantity === 0 AND currentQuantity === 0.
//                       This flags rows the import created without a quantity.
//                       It clears as soon as the owner sets stock (current > 0),
//                       and an imported row that had a quantity keeps its
//                       openingQuantity, so selling it out does not re-flag it.
//                       Known limit: an imported no-quantity row that the owner
//                       stocks and then sells out completely shows up again.
// - 'cost price'      : both unitCostUsd and unitCostRmb are 0 (or missing).
//                       One currency is enough, since the other can be derived.
// - 'retail price'    : sellingPriceUsd is 0 (or missing).
// - 'wholesale price' : wholesalePriceUsd is not set (null/undefined).
//                       A wholesale price of 0 is a deliberate value, not missing.
//
// Stock quantity is otherwise NOT checked: 0 on hand is a normal state (sold
// out), so for products created in the app it says nothing about whether the
// record is complete. wholesaleMinQuantity is not checked either; the owner
// decision only asks for the wholesale price.

export type MissingProductDetail = 'quantity' | 'cost price' | 'retail price' | 'wholesale price'

export type ProductCompletenessInput = {
  unitCostRmb?: number | null
  unitCostUsd?: number | null
  sellingPriceUsd?: number | null
  wholesalePriceUsd?: number | null
  // Only used for the 'quantity' reason (imported products).
  openingQuantity?: number | null
  currentQuantity?: number | null
  sourceFilename?: string | null
}

const isPositive = (n: number | null | undefined) => typeof n === 'number' && n > 0

/** True for an imported product that has never had any stock. */
function importedWithoutQuantity(product: ProductCompletenessInput): boolean {
  const imported = typeof product.sourceFilename === 'string' && product.sourceFilename.trim() !== ''
  return imported && (product.openingQuantity ?? 0) === 0 && (product.currentQuantity ?? 0) === 0
}

/** Reasons the product needs details, in a stable order. Empty when complete. */
export function getMissingProductDetails(product: ProductCompletenessInput): MissingProductDetail[] {
  const missing: MissingProductDetail[] = []
  if (importedWithoutQuantity(product)) missing.push('quantity')
  if (!isPositive(product.unitCostUsd) && !isPositive(product.unitCostRmb)) missing.push('cost price')
  if (!isPositive(product.sellingPriceUsd)) missing.push('retail price')
  if (product.wholesalePriceUsd === null || product.wholesalePriceUsd === undefined) missing.push('wholesale price')
  return missing
}

export function productNeedsDetails(product: ProductCompletenessInput): boolean {
  return getMissingProductDetails(product).length > 0
}
