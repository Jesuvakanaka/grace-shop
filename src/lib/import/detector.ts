import * as XLSX from 'xlsx';
import { getSheetNames, normalizeHeader } from './parser';

export interface DocumentTypeDetection {
  documentType: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  detectedSheets: string[];
  reason: string;
}

export const DOCUMENT_TYPES = {
  PRODUCT_LIST: 'PRODUCT_LIST',
  OPENING_STOCK: 'OPENING_STOCK',
  BUSINESS_CONTROL: 'BUSINESS_CONTROL',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Detect the type of document based on sheet names and column headers.
 * @param workbook The parsed workbook
 * @returns Detection result with documentType, confidence, detectedSheets, and reason
 */
export function detectDocumentType(workbook: XLSX.WorkBook): DocumentTypeDetection {
  const sheetNames = getSheetNames(workbook);
  
  if (sheetNames.length === 0) {
    return {
      documentType: DOCUMENT_TYPES.UNKNOWN,
      confidence: 'LOW',
      detectedSheets: [],
      reason: 'Workbook contains no sheets'
    };
  }

  // Check for Business Control (multiple sheets with specific names)
  const businessControlKeywords = ['sales', 'expenses', 'cash', 'debtors', 'creditors'];
  const matchedBusinessControlSheets = sheetNames.filter(name => 
    businessControlKeywords.some(keyword => name.toLowerCase().includes(keyword))
  );

  if (matchedBusinessControlSheets.length >= 2) {
    return {
      documentType: DOCUMENT_TYPES.BUSINESS_CONTROL,
      confidence: matchedBusinessControlSheets.length >= 4 ? 'HIGH' : 'MEDIUM',
      detectedSheets: matchedBusinessControlSheets,
      reason: `Found sheets indicating Business Control: ${matchedBusinessControlSheets.join(', ')}`
    };
  }

  // Check first sheet for Product List or Opening Stock
  const firstSheetName = sheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];
  
  // Get headers from the first row
  const range = XLSX.utils.decode_range(firstSheet['!ref'] || 'A1:A1');
  const headers: string[] = [];
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const cell = firstSheet[XLSX.utils.encode_cell({ c: C, r: range.s.r })];
    if (cell && cell.v) headers.push(cell.v.toString());
  }
  
  const normalizedHeaders = headers.map(h => normalizeHeader(h));
  
  // Product List keywords
  const productListKeywords = ['itemno', 'productname', 'unitcost', 'sellingprice', 'costrmb', 'pricermb'];
  const matchedProductListHeaders = normalizedHeaders.filter(h => 
    productListKeywords.some(keyword => h.includes(keyword))
  );

  // Opening Stock keywords
  const openingStockKeywords = ['openingstock', 'openingqty', 'openingbalance'];
  const matchedOpeningStockHeaders = normalizedHeaders.filter(h => 
    openingStockKeywords.some(keyword => h.includes(keyword))
  );

  if (matchedOpeningStockHeaders.length > 0) {
    return {
      documentType: DOCUMENT_TYPES.OPENING_STOCK,
      confidence: matchedOpeningStockHeaders.length >= 2 ? 'HIGH' : 'MEDIUM',
      detectedSheets: [firstSheetName],
      reason: `Found opening stock columns: ${headers.filter((_, i) => openingStockKeywords.some(k => normalizedHeaders[i].includes(k))).join(', ')}`
    };
  }

  if (matchedProductListHeaders.length >= 2) {
    return {
      documentType: DOCUMENT_TYPES.PRODUCT_LIST,
      confidence: matchedProductListHeaders.length >= 3 ? 'HIGH' : 'MEDIUM',
      detectedSheets: [firstSheetName],
      reason: `Found product list columns: ${headers.filter((_, i) => productListKeywords.some(k => normalizedHeaders[i].includes(k))).join(', ')}`
    };
  }

  return {
    documentType: DOCUMENT_TYPES.UNKNOWN,
    confidence: 'LOW',
    detectedSheets: [],
    reason: 'Could not determine document type from sheet names or headers'
  };
}
