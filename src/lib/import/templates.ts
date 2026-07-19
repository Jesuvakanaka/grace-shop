import * as XLSX from 'xlsx';

/**
 * Helper to generate a basic template buffer for a single sheet.
 * @param sheetName Name of the sheet
 * @param headers Array of header column names
 * @returns Buffer containing the Excel file
 */
function generateTemplateBuffer(sheetName: string, headers: string[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Generate an Excel template for Product List imports.
 */
export function generateProductListTemplate(): Buffer {
  return generateTemplateBuffer('Product List', [
    'Item No',
    'Product Name',
    'Unit Cost RMB',
    'Unit Cost USD',
    'Selling Price RMB',
    'Selling Price USD',
    'Opening Qty'
  ]);
}

/**
 * Generate an Excel template for Opening Stock imports.
 */
export function generateOpeningStockTemplate(): Buffer {
  return generateTemplateBuffer('Opening Stock', [
    'Item No',
    'Product Name',
    'Opening Stock',
    'Date'
  ]);
}

/**
 * Generate an Excel template for Sales imports.
 */
export function generateSalesTemplate(): Buffer {
  return generateTemplateBuffer('Sales', [
    'Item No',
    'Product Name',
    'Quantity',
    'Amount',
    'Date'
  ]);
}

/**
 * Generate an Excel template for Expenses imports.
 */
export function generateExpensesTemplate(): Buffer {
  return generateTemplateBuffer('Expenses', [
    'Description',
    'Amount',
    'Date'
  ]);
}

/**
 * Generate an Excel template for Debtors imports.
 */
export function generateDebtorsTemplate(): Buffer {
  return generateTemplateBuffer('Debtors', [
    'Customer Name',
    'Amount',
    'Date'
  ]);
}

/**
 * Generate an Excel template for Creditors imports.
 */
export function generateCreditorsTemplate(): Buffer {
  return generateTemplateBuffer('Creditors', [
    'Creditor Name',
    'Amount',
    'Date'
  ]);
}
