import * as XLSX from 'xlsx';

/**
 * Parse an Excel file buffer into a workbook object.
 * @param buffer The file buffer containing the Excel data
 * @returns The parsed workbook object
 */
export function parseWorkbook(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: 'buffer' });
}

/**
 * Extract rows from a specific sheet as an array of objects.
 * @param workbook The workbook object
 * @param sheetName The name of the sheet to parse
 * @returns Array of rows as objects
 */
export function parseSheet(workbook: XLSX.WorkBook, sheetName: string): Record<string, any>[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet ${sheetName} not found`);
  }
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

/**
 * Return a list of sheet names from the workbook.
 * @param workbook The workbook object
 * @returns Array of sheet names
 */
export function getSheetNames(workbook: XLSX.WorkBook): string[] {
  return workbook.SheetNames;
}

/**
 * Trim, lowercase, and remove special characters from headers for matching.
 * @param headers Array of header strings
 * @returns Array of normalized header strings
 */
export function normalizeHeaders(headers: string[]): string[] {
  return headers.map(header => normalizeHeader(header));
}

/**
 * Normalizes a single header string.
 * @param header The header string to normalize
 * @returns The normalized header string
 */
export function normalizeHeader(header: string): string {
  if (!header) return '';
  return header.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
