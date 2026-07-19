import { prisma } from '@/lib/db';
import { parseWorkbook, parseSheet, getSheetNames } from './parser';
import { detectDocumentType, DOCUMENT_TYPES } from './detector';
import { mapProductListRow } from './mappers/product-list';
import { mapOpeningStockRow } from './mappers/opening-stock';
import { mapSalesRow, mapExpenseRow, mapDebtorRow, mapCreditorRow } from './mappers/business-control';
import { validateProductRow } from './validators/product';
import { validateOpeningStockRow } from './validators/stock';
import { validateSaleRow, validateExpenseRow, validateDebtorRow, validateCreditorRow } from './validators/transactions';

export async function processImport(buffer: Buffer, filename: string, userId: string) {
  const workbook = parseWorkbook(buffer);
  const detection = detectDocumentType(workbook);

  if (detection.documentType === DOCUMENT_TYPES.UNKNOWN) {
    throw new Error('Unknown document type. Could not determine how to process this file.');
  }

  // Pre-fetch products for validation if necessary
  let existingProducts = new Map();
  if (detection.documentType === DOCUMENT_TYPES.PRODUCT_LIST || detection.documentType === DOCUMENT_TYPES.OPENING_STOCK) {
    const products = await prisma.product.findMany();
    products.forEach(p => existingProducts.set(p.itemNumber, p));
  }

  const importDocument = await prisma.importDocument.create({
    data: {
      filename,
      documentType: detection.documentType,
      status: 'DRAFT',
      userId
    }
  });

  const rowResults = [];
  let summary = { total: 0, ready: 0, warnings: 0, errors: 0 };

  const processSheetRows = async (sheetName: string, mapFn: any, validateFn: any, type: string) => {
    const rawRows = parseSheet(workbook, sheetName);
    summary.total += rawRows.length;

    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i];
      // Skip empty rows (header parsing might return empty objects if not careful)
      if (Object.keys(raw).length === 0) continue;

      const { mapped, warnings: mapWarnings } = mapFn(raw, i + 2); // i+2 assuming 1 header row
      const validation = validateFn(mapped, existingProducts);
      
      const allWarnings = [...mapWarnings, ...validation.warnings];
      let status = validation.status;
      if (status === 'READY' && allWarnings.length > 0) status = 'WARNING';

      if (status === 'READY') summary.ready++;
      else if (status === 'WARNING') summary.warnings++;
      else summary.errors++;

      const importRow = await prisma.importRow.create({
        data: {
          importDocumentId: importDocument.id,
          rowNumber: i + 2,
          sheetName,
          rowType: type,
          status,
          rawData: JSON.stringify(raw),
          mappedData: mapped ? JSON.stringify(mapped) : null
        }
      });

      const allErrors = validation.errors || [];
      
      for (const msg of allErrors) {
        await prisma.importError.create({
          data: {
            importRowId: importRow.id,
            errorType: 'ERROR',
            message: msg
          }
        });
      }

      for (const msg of allWarnings) {
        await prisma.importError.create({
          data: {
            importRowId: importRow.id,
            errorType: 'WARNING',
            message: msg
          }
        });
      }

      rowResults.push({
        rowNumber: i + 2,
        data: mapped,
        status,
        errors: allErrors,
        warnings: allWarnings
      });
    }
  };

  if (detection.documentType === DOCUMENT_TYPES.PRODUCT_LIST) {
    await processSheetRows(detection.detectedSheets[0], mapProductListRow, validateProductRow, 'PRODUCT');
  } else if (detection.documentType === DOCUMENT_TYPES.OPENING_STOCK) {
    await processSheetRows(detection.detectedSheets[0], mapOpeningStockRow, validateOpeningStockRow, 'STOCK');
  } else if (detection.documentType === DOCUMENT_TYPES.BUSINESS_CONTROL) {
    for (const sheet of detection.detectedSheets) {
      const lowerSheet = sheet.toLowerCase();
      if (lowerSheet.includes('sales')) await processSheetRows(sheet, mapSalesRow, validateSaleRow, 'SALE');
      else if (lowerSheet.includes('expense')) await processSheetRows(sheet, mapExpenseRow, validateExpenseRow, 'EXPENSE');
      else if (lowerSheet.includes('debtor')) await processSheetRows(sheet, mapDebtorRow, validateDebtorRow, 'DEBTOR');
      else if (lowerSheet.includes('creditor')) await processSheetRows(sheet, mapCreditorRow, validateCreditorRow, 'CREDITOR');
    }
  }

  return {
    importDocumentId: importDocument.id,
    documentType: detection.documentType,
    rows: rowResults,
    summary
  };
}

export async function confirmImport(importDocumentId: number, exchangeRate?: number) {
  const document = await prisma.importDocument.findUnique({
    where: { id: importDocumentId },
    include: { rows: true }
  });

  if (!document) throw new Error('Import document not found');
  if (document.status !== 'DRAFT') throw new Error('Can only confirm DRAFT imports');

  let importedRows = 0;
  let skippedRows = 0;
  let errors: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const row of document.rows) {
      if (row.status === 'ERROR') {
        skippedRows++;
        continue;
      }

      const mapped = row.mappedData ? JSON.parse(row.mappedData as string) : null;
      if (!mapped) continue;

      try {
        if (document.documentType === DOCUMENT_TYPES.PRODUCT_LIST) {
          const unitCostRmb = mapped.unitCostRmb || (exchangeRate && mapped.unitCostUsd ? mapped.unitCostUsd * exchangeRate : 0);
          const sellingPriceRmb = mapped.sellingPriceRmb || unitCostRmb * 2;
          
          const product = await tx.product.upsert({
            where: { itemNumber: mapped.itemNumber },
            update: {
              name: mapped.productName,
              costPrice: unitCostRmb,
              sellingPrice: sellingPriceRmb,
              sourceFilename: document.filename
            },
            create: {
              itemNumber: mapped.itemNumber,
              name: mapped.productName,
              costPrice: unitCostRmb,
              sellingPrice: sellingPriceRmb,
              sourceFilename: document.filename
            }
          });

          if (mapped.openingQuantity) {
            await tx.stockMovement.create({
              data: {
                productId: product.id,
                quantity: mapped.openingQuantity,
                type: 'OPENING_BALANCE',
                date: new Date(),
                sourceFilename: document.filename
              }
            });
          }
        } else if (document.documentType === DOCUMENT_TYPES.OPENING_STOCK) {
          const product = await tx.product.findFirst({
            where: { OR: [{ itemNumber: mapped.itemNumber }, { name: mapped.productName }] }
          });
          if (product) {
            await tx.stockMovement.create({
              data: {
                productId: product.id,
                quantity: mapped.openingQuantity,
                type: 'OPENING_BALANCE',
                date: mapped.date ? new Date(mapped.date) : new Date(),
                sourceFilename: document.filename
              }
            });
          }
        } else if (document.documentType === DOCUMENT_TYPES.BUSINESS_CONTROL) {
          if (row.rowType === 'SALE') {
            await tx.sale.create({
              data: {
                productName: mapped.productName || mapped.itemNumber,
                quantity: mapped.quantity,
                amount: mapped.amount,
                date: mapped.date ? new Date(mapped.date) : new Date(),
                sourceFilename: document.filename
              }
            });
          } else if (row.rowType === 'EXPENSE') {
            await tx.expense.create({
              data: {
                description: mapped.description,
                amount: mapped.amount,
                date: mapped.date ? new Date(mapped.date) : new Date(),
                sourceFilename: document.filename
              }
            });
          } else if (row.rowType === 'DEBTOR') {
            await tx.debtor.create({
              data: {
                customerName: mapped.customerName,
                amount: mapped.amount,
                date: mapped.date ? new Date(mapped.date) : new Date(),
                sourceFilename: document.filename
              }
            });
          } else if (row.rowType === 'CREDITOR') {
            await tx.creditor.create({
              data: {
                creditorName: mapped.creditorName,
                amount: mapped.amount,
                date: mapped.date ? new Date(mapped.date) : new Date(),
                sourceFilename: document.filename
              }
            });
          }
        }
        importedRows++;
      } catch (e: any) {
        skippedRows++;
        errors.push(`Row ${row.rowNumber}: ${e.message}`);
      }
    }

    await tx.importDocument.update({
      where: { id: importDocumentId },
      data: { status: 'COMPLETED' }
    });
  });

  return { importedRows, skippedRows, errors };
}

export async function cancelImport(importDocumentId: number) {
  return prisma.importDocument.update({
    where: { id: importDocumentId },
    data: { status: 'CANCELLED' }
  });
}

export async function getImportHistory() {
  return prisma.importDocument.findMany({
    orderBy: { createdAt: 'desc' }
  });
}

export async function getImportDetail(importDocumentId: number) {
  return prisma.importDocument.findUnique({
    where: { id: importDocumentId },
    include: {
      rows: {
        include: { errors: true }
      }
    }
  });
}
