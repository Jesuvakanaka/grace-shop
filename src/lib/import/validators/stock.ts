import { MappedOpeningStock } from '../mappers/opening-stock';
import { ValidationResult } from './product';

export function validateOpeningStockRow(
  mapped: MappedOpeningStock | null, 
  existingProducts: Map<string, any>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!mapped) {
    return { status: 'ERROR', errors: ['Row could not be mapped to opening stock.'], warnings: [] };
  }

  let productFound = false;
  let productData = null;

  if (mapped.itemNumber && existingProducts.has(mapped.itemNumber)) {
    productFound = true;
    productData = existingProducts.get(mapped.itemNumber);
  } else if (mapped.productName) {
    // Search by product name (assuming existingProducts values have productName)
    for (const [key, value] of existingProducts.entries()) {
      if (value.productName === mapped.productName) {
        productFound = true;
        productData = value;
        break;
      }
    }
  }

  if (!productFound) {
    errors.push(`Product must be identifiable. Neither Item Number '${mapped.itemNumber}' nor Product Name '${mapped.productName}' were found in existing products.`);
  }

  if (isNaN(mapped.openingQuantity) || mapped.openingQuantity < 0 || !Number.isInteger(mapped.openingQuantity)) {
    errors.push('Opening quantity must be a non-negative integer.');
  }

  if (productData && productData.hasStockMovements) {
    warnings.push('Product already has stock movements. Proceeding will create an additional opening balance movement.');
  }

  let status: 'READY' | 'WARNING' | 'ERROR' = 'READY';
  if (errors.length > 0) {
    status = 'ERROR';
  } else if (warnings.length > 0) {
    status = 'WARNING';
  }

  return { status, errors, warnings };
}
