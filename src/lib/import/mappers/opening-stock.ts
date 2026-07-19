import { getValueByHeaders, MapResult } from './product-list';

export interface MappedOpeningStock {
  itemNumber?: string;
  productName?: string;
  openingQuantity: number;
  date?: Date;
}

export function mapOpeningStockRow(
  row: Record<string, any>, 
  rowNumber: number
): MapResult<MappedOpeningStock> {
  const warnings: string[] = [];

  const itemNumber = getValueByHeaders(row, ['Item No', 'Item Number', 'No', '#']);
  const productName = getValueByHeaders(row, ['Product Name', 'Product', 'Name', 'Description']);
  const openingQuantityRaw = getValueByHeaders(row, ['Opening Stock', 'Opening Qty', 'Opening Balance', 'Qty']);
  const dateRaw = getValueByHeaders(row, ['Date']);

  const openingQuantity = openingQuantityRaw !== undefined ? Number(openingQuantityRaw) : NaN;
  
  let date: Date | undefined = undefined;
  if (dateRaw) {
    const parsedDate = new Date(dateRaw);
    if (!isNaN(parsedDate.getTime())) {
      date = parsedDate;
    } else {
      warnings.push(`Invalid date format for row ${rowNumber}.`);
    }
  }

  const mapped: MappedOpeningStock = {
    itemNumber: itemNumber?.toString(),
    productName: productName?.toString(),
    openingQuantity,
    date
  };

  return { mapped, warnings };
}
