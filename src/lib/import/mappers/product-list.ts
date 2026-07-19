import { normalizeHeader } from '../parser';

export interface MappedProduct {
  itemNumber: string;
  productName: string;
  unitCostRmb?: number;
  unitCostUsd?: number;
  sellingPriceRmb?: number;
  sellingPriceUsd?: number;
  openingQuantity?: number;
}

export interface MapResult<T> {
  mapped: T | null;
  warnings: string[];
}

/**
 * Find value by possible header names (case insensitive, ignores spaces)
 */
export function getValueByHeaders(row: Record<string, any>, possibleHeaders: string[]): any {
  const normalizedPossibles = possibleHeaders.map(normalizeHeader);
  for (const key of Object.keys(row)) {
    const normKey = normalizeHeader(key);
    if (normalizedPossibles.includes(normKey)) {
      return row[key];
    }
  }
  return undefined;
}

/**
 * Check if the row contains branded goods columns
 */
function hasBrandedColumns(row: Record<string, any>): boolean {
  return Object.keys(row).some(key => normalizeHeader(key).includes('brand'));
}

/**
 * Maps a raw Excel row to product fields.
 */
export function mapProductListRow(
  row: Record<string, any>, 
  rowNumber: number,
  exchangeRate?: number
): MapResult<MappedProduct> {
  const warnings: string[] = [];
  
  if (hasBrandedColumns(row)) {
    warnings.push('Row contains branded goods columns, which are ignored.');
  }

  const itemNumber = getValueByHeaders(row, ['Item No', 'Item Number', 'No', '#']);
  const productName = getValueByHeaders(row, ['Product Name', 'Product', 'Name', 'Description']);
  
  const unitCostRmbRaw = getValueByHeaders(row, ['Unit Cost RMB', 'Cost RMB', 'Cost (RMB)', 'Purchase Price RMB']);
  const unitCostUsdRaw = getValueByHeaders(row, ['Unit Cost USD', 'Cost USD', 'Cost (USD)', 'Purchase Price USD']);
  const sellingPriceRmbRaw = getValueByHeaders(row, ['Selling Price RMB', 'Price RMB', 'Sale Price RMB']);
  const sellingPriceUsdRaw = getValueByHeaders(row, ['Selling Price USD', 'Price USD', 'Sale Price USD']);
  const openingQuantityRaw = getValueByHeaders(row, ['Opening Qty', 'Opening Stock', 'Qty', 'Quantity', 'Stock']);

  let unitCostRmb = unitCostRmbRaw ? Number(unitCostRmbRaw) : undefined;
  let unitCostUsd = unitCostUsdRaw ? Number(unitCostUsdRaw) : undefined;
  let sellingPriceRmb = sellingPriceRmbRaw ? Number(sellingPriceRmbRaw) : undefined;
  let sellingPriceUsd = sellingPriceUsdRaw ? Number(sellingPriceUsdRaw) : undefined;
  const openingQuantity = openingQuantityRaw !== undefined ? Number(openingQuantityRaw) : undefined;

  if (isNaN(unitCostRmb as number)) unitCostRmb = undefined;
  if (isNaN(unitCostUsd as number)) unitCostUsd = undefined;
  if (isNaN(sellingPriceRmb as number)) sellingPriceRmb = undefined;
  if (isNaN(sellingPriceUsd as number)) sellingPriceUsd = undefined;

  if (!sellingPriceRmb && unitCostRmb) {
    sellingPriceRmb = unitCostRmb * 2;
    warnings.push('Selling Price RMB missing, calculated as 2 * Cost.');
  }

  if (!unitCostUsd && unitCostRmb && exchangeRate) {
    unitCostUsd = unitCostRmb / exchangeRate;
  }
  if (!sellingPriceUsd && sellingPriceRmb && exchangeRate) {
    sellingPriceUsd = sellingPriceRmb / exchangeRate;
  }

  const mapped: MappedProduct = {
    itemNumber: itemNumber?.toString(),
    productName: productName?.toString(),
    unitCostRmb,
    unitCostUsd,
    sellingPriceRmb,
    sellingPriceUsd,
    openingQuantity
  };

  return { mapped, warnings };
}
