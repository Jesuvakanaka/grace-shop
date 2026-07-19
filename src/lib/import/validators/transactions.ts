import { MappedSale, MappedExpense, MappedDebtor, MappedCreditor } from '../mappers/business-control';
import { ValidationResult } from './product';

export function validateSaleRow(mapped: MappedSale | null): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!mapped) return { status: 'ERROR', errors: ['Row could not be mapped to sale.'], warnings: [] };

  if (!mapped.productName && !mapped.itemNumber) {
    errors.push('Product name or Item number is required.');
  }

  if (isNaN(mapped.quantity) || mapped.quantity <= 0) {
    errors.push('Quantity must be greater than 0.');
  }

  if (isNaN(mapped.amount) || mapped.amount < 0) {
    errors.push('Amount must be non-negative.');
  }

  return { 
    status: errors.length > 0 ? 'ERROR' : (warnings.length > 0 ? 'WARNING' : 'READY'), 
    errors, 
    warnings 
  };
}

export function validateExpenseRow(mapped: MappedExpense | null): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!mapped) return { status: 'ERROR', errors: ['Row could not be mapped to expense.'], warnings: [] };

  if (!mapped.description || mapped.description.trim() === '') {
    errors.push('Expense description is required.');
  }

  if (isNaN(mapped.amount) || mapped.amount <= 0) {
    errors.push('Amount must be greater than 0.');
  }

  return { 
    status: errors.length > 0 ? 'ERROR' : (warnings.length > 0 ? 'WARNING' : 'READY'), 
    errors, 
    warnings 
  };
}

export function validateDebtorRow(mapped: MappedDebtor | null): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!mapped) return { status: 'ERROR', errors: ['Row could not be mapped to debtor.'], warnings: [] };

  if (!mapped.customerName || mapped.customerName.trim() === '') {
    errors.push('Customer name is required.');
  }

  if (isNaN(mapped.amount)) {
    errors.push('Amount is required and must be a number.');
  }

  return { 
    status: errors.length > 0 ? 'ERROR' : (warnings.length > 0 ? 'WARNING' : 'READY'), 
    errors, 
    warnings 
  };
}

export function validateCreditorRow(mapped: MappedCreditor | null): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!mapped) return { status: 'ERROR', errors: ['Row could not be mapped to creditor.'], warnings: [] };

  if (!mapped.creditorName || mapped.creditorName.trim() === '') {
    errors.push('Creditor name is required.');
  }

  if (isNaN(mapped.amount)) {
    errors.push('Amount is required and must be a number.');
  }

  return { 
    status: errors.length > 0 ? 'ERROR' : (warnings.length > 0 ? 'WARNING' : 'READY'), 
    errors, 
    warnings 
  };
}
