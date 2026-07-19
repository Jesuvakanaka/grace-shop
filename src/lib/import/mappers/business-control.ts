import { getValueByHeaders, MapResult } from './product-list';

export interface MappedSale {
  itemNumber?: string;
  productName?: string;
  quantity: number;
  amount: number;
  date?: Date;
}

export interface MappedExpense {
  description: string;
  amount: number;
  date?: Date;
}

export interface MappedDebtor {
  customerName: string;
  amount: number;
  date?: Date;
}

export interface MappedCreditor {
  creditorName: string;
  amount: number;
  date?: Date;
}

export interface MappedCashPosition {
  accountName: string;
  amount: number;
  date?: Date;
}

function parseDate(dateRaw: any, rowNumber: number, warnings: string[]): Date | undefined {
  if (!dateRaw) return undefined;
  const parsedDate = new Date(dateRaw);
  if (!isNaN(parsedDate.getTime())) {
    return parsedDate;
  }
  warnings.push(`Invalid date format for row ${rowNumber}.`);
  return undefined;
}

export function mapSalesRow(row: Record<string, any>, rowNumber: number): MapResult<MappedSale> {
  const warnings: string[] = [];
  const itemNumber = getValueByHeaders(row, ['Item No', 'Item Number', 'Product ID', 'No']);
  const productName = getValueByHeaders(row, ['Product Name', 'Product', 'Item']);
  const quantityRaw = getValueByHeaders(row, ['Quantity', 'Qty']);
  const amountRaw = getValueByHeaders(row, ['Amount', 'Total', 'Price', 'Sales']);
  const dateRaw = getValueByHeaders(row, ['Date', 'Sale Date']);

  return {
    mapped: {
      itemNumber: itemNumber?.toString(),
      productName: productName?.toString(),
      quantity: Number(quantityRaw) || 0,
      amount: Number(amountRaw) || 0,
      date: parseDate(dateRaw, rowNumber, warnings)
    },
    warnings
  };
}

export function mapExpenseRow(row: Record<string, any>, rowNumber: number): MapResult<MappedExpense> {
  const warnings: string[] = [];
  const description = getValueByHeaders(row, ['Description', 'Expense', 'Details', 'Name']);
  const amountRaw = getValueByHeaders(row, ['Amount', 'Total', 'Cost']);
  const dateRaw = getValueByHeaders(row, ['Date', 'Expense Date']);

  return {
    mapped: {
      description: description?.toString() || '',
      amount: Number(amountRaw) || 0,
      date: parseDate(dateRaw, rowNumber, warnings)
    },
    warnings
  };
}

export function mapDebtorRow(row: Record<string, any>, rowNumber: number): MapResult<MappedDebtor> {
  const warnings: string[] = [];
  const customerName = getValueByHeaders(row, ['Customer Name', 'Customer', 'Debtor', 'Name']);
  const amountRaw = getValueByHeaders(row, ['Amount', 'Balance', 'Total']);
  const dateRaw = getValueByHeaders(row, ['Date', 'Due Date']);

  return {
    mapped: {
      customerName: customerName?.toString() || '',
      amount: Number(amountRaw) || 0,
      date: parseDate(dateRaw, rowNumber, warnings)
    },
    warnings
  };
}

export function mapCreditorRow(row: Record<string, any>, rowNumber: number): MapResult<MappedCreditor> {
  const warnings: string[] = [];
  const creditorName = getValueByHeaders(row, ['Creditor Name', 'Creditor', 'Supplier', 'Name']);
  const amountRaw = getValueByHeaders(row, ['Amount', 'Balance', 'Total']);
  const dateRaw = getValueByHeaders(row, ['Date', 'Due Date']);

  return {
    mapped: {
      creditorName: creditorName?.toString() || '',
      amount: Number(amountRaw) || 0,
      date: parseDate(dateRaw, rowNumber, warnings)
    },
    warnings
  };
}

export function mapCashPositionRow(row: Record<string, any>, rowNumber: number): MapResult<MappedCashPosition> {
  const warnings: string[] = [];
  const accountName = getValueByHeaders(row, ['Account Name', 'Account', 'Bank', 'Cash']);
  const amountRaw = getValueByHeaders(row, ['Amount', 'Balance', 'Total']);
  const dateRaw = getValueByHeaders(row, ['Date', 'As Of']);

  return {
    mapped: {
      accountName: accountName?.toString() || '',
      amount: Number(amountRaw) || 0,
      date: parseDate(dateRaw, rowNumber, warnings)
    },
    warnings
  };
}
