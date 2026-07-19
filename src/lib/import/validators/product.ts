import { MappedProduct } from '../mappers/product-list';

export interface ValidationResult {
  status: 'READY' | 'WARNING' | 'ERROR';
  errors: string[];
  warnings: string[];
}

export function validateProductRow(
  mapped: MappedProduct | null, 
  existingProducts: Map<string, any>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!mapped) {
    return { status: 'ERROR', errors: ['Row could not be mapped to a product.'], warnings: [] };
  }

  if (!mapped.productName || mapped.productName.trim() === '') {
    errors.push('Product name is required and cannot be empty.');
  }

  if (!mapped.itemNumber || mapped.itemNumber.trim() === '') {
    errors.push('Item number is required and cannot be empty.');
  } else if (existingProducts.has(mapped.itemNumber)) {
    warnings.push(`Product with item number ${mapped.itemNumber} already exists. It will be updated.`);
  }

  if (
    (mapped.unitCostRmb === undefined || isNaN(mapped.unitCostRmb) || mapped.unitCostRmb < 0) &&
    (mapped.unitCostUsd === undefined || isNaN(mapped.unitCostUsd) || mapped.unitCostUsd < 0)
  ) {
    errors.push('Either Unit Cost RMB or Unit Cost USD must be a valid positive number.');
  }

  if (mapped.openingQuantity !== undefined) {
    if (isNaN(mapped.openingQuantity) || mapped.openingQuantity < 0 || !Number.isInteger(mapped.openingQuantity)) {
      errors.push('Opening quantity must be a non-negative integer.');
    }
  }

  let status: 'READY' | 'WARNING' | 'ERROR' = 'READY';
  if (errors.length > 0) {
    status = 'ERROR';
  } else if (warnings.length > 0) {
    status = 'WARNING';
  }

  return { status, errors, warnings };
}
