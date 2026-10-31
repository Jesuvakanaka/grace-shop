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
      importedBy: userId
    }
  });

  const rowResults: any[] = [];
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
          detectedRecordType: type,
          status,
          rawData: JSON.stringify(raw),
          mappedData: mapped ? JSON.stringify(mapped) : null
        }
      });

      const allErrors = validation.errors || [];
      
      for (const msg of allErrors) {
        await prisma.importError.create({
          data: {
            importDocumentId: importDocument.id,
            importRowId: importRow.id,
            errorType: 'ERROR',
            errorMessage: msg
          }
        });
      }

      for (const msg of allWarnings) {
        await prisma.importError.create({
          data: {
            importDocumentId: importDocument.id,
            importRowId: importRow.id,
            errorType: 'WARNING',
            errorMessage: msg
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
          const unitCostRmb = mapped.unitCostRmb || 0;
          const unitCostUsd = mapped.unitCostUsd || (exchangeRate ? unitCostRmb * exchangeRate : 0);
          const sellingPriceRmb = mapped.sellingPriceRmb || unitCostRmb * 2;
          const sellingPriceUsd = mapped.sellingPriceUsd || unitCostUsd * 2;
          const openingQuantity = mapped.openingQuantity || 0;

          const product = await tx.product.upsert({
            where: { itemNumber: mapped.itemNumber },
            update: {
              productName: mapped.productName,
              unitCostRmb,
              unitCostUsd,
              sellingPriceRmb,
              sellingPriceUsd,
              sourceImportId: document.id,
              sourceFilename: document.filename,
              sourceSheetName: row.sheetName,
              sourceRowNumber: row.rowNumber
            },
            create: {
              itemNumber: mapped.itemNumber,
              productName: mapped.productName,
              unitCostRmb,
              unitCostUsd,
              sellingPriceRmb,
              sellingPriceUsd,
              openingQuantity,
              currentQuantity: openingQuantity,
              sourceImportId: document.id,
              sourceFilename: document.filename,
              sourceSheetName: row.sheetName,
              sourceRowNumber: row.rowNumber
            }
          });

          if (openingQuantity > 0) {
            await tx.stockMovement.create({
              data: {
                productId: product.id,
                movementDate: new Date(),
                movementType: 'OPENING_BALANCE',
                quantity: openingQuantity,
                openingBalance: 0,
                closingBalance: openingQuantity,
                notes: 'Opening stock from product list import',
                sourceImportId: document.id
              }
            });
          }
        } else if (document.documentType === DOCUMENT_TYPES.OPENING_STOCK) {
          const product = await tx.product.findFirst({
            where: { OR: [{ itemNumber: mapped.itemNumber }, { productName: mapped.productName }] }
          });
          if (product) {
            const addedQty = mapped.openingQuantity || 0;
            await tx.stockMovement.create({
              data: {
                productId: product.id,
                movementDate: mapped.date ? new Date(mapped.date) : new Date(),
                movementType: 'OPENING_BALANCE',
                quantity: addedQty,
                openingBalance: product.currentQuantity,
                closingBalance: product.currentQuantity + addedQty,
                notes: 'Opening stock import',
                sourceImportId: document.id
              }
            });
            await tx.product.update({
              where: { id: product.id },
              data: { currentQuantity: product.currentQuantity + addedQty }
            });
          }
        } else if (document.documentType === DOCUMENT_TYPES.BUSINESS_CONTROL) {
          if (row.detectedRecordType === 'SALE') {
            await tx.sale.create({
              data: {
                saleDate: mapped.saleDate ? new Date(mapped.saleDate) : new Date(),
                paymentType: mapped.paymentType || 'CASH',
                customerName: mapped.customerName,
                customerPhone: mapped.customerPhone,
                totalAmount: mapped.totalAmount || 0,
                cashAmount: mapped.cashAmount || 0,
                creditAmount: mapped.creditAmount || 0,
                notes: mapped.notes
              }
            });
          } else if (row.detectedRecordType === 'EXPENSE') {
            await tx.expense.create({
              data: {
                expenseDate: mapped.expenseDate ? new Date(mapped.expenseDate) : new Date(),
                category: mapped.category || 'Other',
                description: mapped.description,
                amount: mapped.amount || 0,
                paymentMethod: mapped.paymentMethod || 'CASH',
                paidTo: mapped.paidTo,
                notes: mapped.notes
              }
            });
          } else if (row.detectedRecordType === 'DEBTOR') {
            await tx.debtor.create({
              data: {
                customerName: mapped.customerName,
                phoneNumber: mapped.phoneNumber,
                totalCreditAmount: mapped.totalCreditAmount || 0,
                totalPaid: mapped.totalPaid || 0,
                outstandingBalance: mapped.outstandingBalance || 0,
                status: mapped.status || 'OPEN'
              }
            });
          } else if (row.detectedRecordType === 'CREDITOR') {
            await tx.creditor.create({
              data: {
                creditorName: mapped.creditorName,
                phoneNumber: mapped.phoneNumber,
                description: mapped.description,
                totalAmountOwed: mapped.totalAmountOwed || 0,
                totalPaid: mapped.totalPaid || 0,
                outstandingBalance: mapped.outstandingBalance || 0,
                status: mapped.status || 'OPEN'
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
      data: { status: 'COMPLETED', completedAt: new Date(), importedRows, skippedRows }
    });
  }, {
    maxWait: 10_000,
    timeout: 120_000
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
