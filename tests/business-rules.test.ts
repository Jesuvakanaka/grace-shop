import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import prisma from '../src/lib/db';
import { createProduct, getAllProducts, calculateSellingPrice } from '../src/lib/products';
import { createStockMovement, getStockLedger } from '../src/lib/stock';
import { createSale } from '../src/lib/sales';
import { createExpense } from '../src/lib/expenses';
import { recordDebtorPayment, getAllDebtors } from '../src/lib/debtors';
import { recordCreditorPayment, createCreditor, getAllCreditors } from '../src/lib/creditors';
import { getOrCreateCashPosition, setActualCash } from '../src/lib/cash';
import { getDayClosingSummary, createOrUpdateDayClosing, closeDayClosing } from '../src/lib/closing';
import { mapProductListRow } from '../src/lib/import/mappers/product-list';
import { validateProductRow } from '../src/lib/import/validators/product';

describe('Business Control MVP Tests', () => {
  // Clear DB before tests
  before(async () => {
    await prisma.stockMovement.deleteMany({});
    await prisma.saleItem.deleteMany({});
    await prisma.sale.deleteMany({});
    await prisma.expense.deleteMany({});
    await prisma.debtorTransaction.deleteMany({});
    await prisma.debtor.deleteMany({});
    await prisma.creditorTransaction.deleteMany({});
    await prisma.creditor.deleteMany({});
    await prisma.cashPosition.deleteMany({});
    await prisma.dayClosing.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('1. Product Master & Pricing Rules', () => {
    test('Selling price should be automatically calculated as 2x purchase price', () => {
      const cost = 10.5;
      const expectedSellingPrice = 21.0;
      assert.strictEqual(calculateSellingPrice(cost), expectedSellingPrice);
    });

    test('Creating a product should calculate selling price correctly and initialize quantities', async () => {
      const product = await createProduct({
        itemNumber: 'P001',
        productName: 'Test Product 1',
        unitCostRmb: 100,
        unitCostUsd: 14,
        openingQuantity: 50,
      });

      assert.strictEqual(product.sellingPriceRmb, 200);
      assert.strictEqual(product.sellingPriceUsd, 28);
      assert.strictEqual(product.currentQuantity, 50);
    });

    test('Prevent duplicate products with same item number', async () => {
      await assert.rejects(
        createProduct({
          itemNumber: 'P001',
          productName: 'Duplicate Product',
          unitCostRmb: 50,
          unitCostUsd: 7,
          openingQuantity: 10,
        }),
        /already exists/i
      );
    });
  });

  describe('2. Excel Import Mapping & Validation', () => {
    test('Ignored branded column during row mapping', () => {
      const rawRow = {
        'Item No': 'P002',
        'Product Name': 'Branded Shoe',
        'Unit Cost RMB': '50',
        'Unit Cost USD': '7',
        'Opening Qty': '20',
        'Brand Name': 'BrandX',
        'Branded': 'Yes'
      };

      const mapped = mapProductListRow(rawRow, 1);
      assert.strictEqual(mapped.mapped.itemNumber, 'P002');
      assert.strictEqual(mapped.mapped.productName, 'Branded Shoe');
      assert.strictEqual((mapped.mapped as any).brand, undefined);
      assert.strictEqual((mapped.mapped as any).branded, undefined);
    });

    test('Validation detects missing productName', () => {
      const invalidMapped = {
        itemNumber: 'P003',
        productName: '',
        unitCostRmb: 10,
        unitCostUsd: 1.4,
        sellingPriceRmb: 20,
        sellingPriceUsd: 2.8,
        openingQuantity: 5,
      };

      const existing = new Map();
      const validation = validateProductRow(invalidMapped, existing);
      assert.strictEqual(validation.status, 'ERROR');
      assert.ok(validation.errors.some(e => e.includes('Product name is required')));
    });
  });

  describe('3. Core Sales Loop', () => {
    test('Cash sale reduces stock, increases cash position', async () => {
      const product = await prisma.product.findUnique({ where: { itemNumber: 'P001' } });
      const originalStock = product!.currentQuantity;

      // Record Sale
      const saleDate = new Date();
      await createSale({
        saleDate,
        paymentType: 'CASH',
        items: [{ productId: product!.id, quantity: 2, unitPrice: product!.sellingPriceUsd }],
        cashAmount: product!.sellingPriceUsd * 2,
      });

      // Verify stock reduced
      const updatedProduct = await prisma.product.findUnique({ where: { id: product!.id } });
      assert.strictEqual(updatedProduct!.currentQuantity, originalStock - 2);

      // Verify cash position updated
      const cashPos = await getOrCreateCashPosition(saleDate);
      assert.strictEqual(cashPos.cashSales, product!.sellingPriceUsd * 2);
    });

    test('Credit sale reduces stock, increases debtor outstanding balance', async () => {
      const product = await prisma.product.findUnique({ where: { itemNumber: 'P001' } });
      const originalStock = product!.currentQuantity;

      const saleDate = new Date();
      await createSale({
        saleDate,
        paymentType: 'CREDIT',
        customerName: 'Alice Debtor',
        customerPhone: '1234567890',
        items: [{ productId: product!.id, quantity: 3, unitPrice: product!.sellingPriceUsd }],
        creditAmount: product!.sellingPriceUsd * 3,
      });

      // Verify stock reduced
      const updatedProduct = await prisma.product.findUnique({ where: { id: product!.id } });
      assert.strictEqual(updatedProduct!.currentQuantity, originalStock - 3);

      // Verify debtor balance
      const debtors = await getAllDebtors();
      const alice = debtors.find(d => d.customerName === 'Alice Debtor');
      assert.ok(alice);
      assert.strictEqual(alice.outstandingBalance, product!.sellingPriceUsd * 3);
      assert.strictEqual(alice.status, 'OPEN');
    });

    test('Negative stock prevention', async () => {
      const product = await prisma.product.findUnique({ where: { itemNumber: 'P001' } });
      const currentQty = product!.currentQuantity;

      await assert.rejects(
        createSale({
          saleDate: new Date(),
          paymentType: 'CASH',
          items: [{ productId: product!.id, quantity: currentQty + 1, unitPrice: 20 }],
          cashAmount: 20 * (currentQty + 1),
        }),
        /insufficient stock/i
      );
    });
  });

  describe('4. Expenses & Creditors & Debtor Payments', () => {
    test('Expense reduces cash position', async () => {
      const date = new Date();
      const initialCash = await getOrCreateCashPosition(date);
      const initialExpenses = initialCash.expensesPaid;

      await createExpense({
        expenseDate: date,
        category: 'Food',
        description: 'Lunch for staff',
        amount: 25.5,
        paymentMethod: 'CASH',
      });

      const updatedCash = await getOrCreateCashPosition(date);
      assert.strictEqual(updatedCash.expensesPaid, initialExpenses + 25.5);
    });

    test('Debtor payment reduces debtor balance, increases cash position', async () => {
      const debtors = await getAllDebtors();
      const alice = debtors.find(d => d.customerName === 'Alice Debtor');
      assert.ok(alice);

      const originalOutstanding = alice.outstandingBalance;
      const date = new Date();
      const initialCash = await getOrCreateCashPosition(date);

      // Alice pays 10 USD
      await recordDebtorPayment(alice.id, 10, 'Part payment', 'system');

      const updatedDebtors = await getAllDebtors();
      const updatedAlice = updatedDebtors.find(d => d.id === alice.id);
      assert.strictEqual(updatedAlice!.outstandingBalance, originalOutstanding - 10);
      assert.strictEqual(updatedAlice!.status, 'PART_PAID');

      const updatedCash = await getOrCreateCashPosition(date);
      assert.strictEqual(updatedCash.debtorPaymentsReceived, initialCash.debtorPaymentsReceived + 10);
    });

    test('Creditor payment reduces creditor balance, reduces cash position', async () => {
      const date = new Date();
      const creditor = await createCreditor({
        creditorName: 'Supplier Bob',
        totalAmountOwed: 200,
        description: 'Initial supply',
      });

      const initialCash = await getOrCreateCashPosition(date);

      // Pay 50 USD
      await recordCreditorPayment(creditor.id, 50, 'Partial pay Supplier Bob', 'system');

      const creditors = await getAllCreditors();
      const updatedCreditor = creditors.find(c => c.id === creditor.id);
      assert.strictEqual(updatedCreditor!.outstandingBalance, 150);
      assert.strictEqual(updatedCreditor!.status, 'PART_PAID');

      const updatedCash = await getOrCreateCashPosition(date);
      assert.strictEqual(updatedCash.creditorPaymentsMade, initialCash.creditorPaymentsMade + 50);
    });
  });

  describe('5. Stock Ledger & Closing Balances', () => {
    test('Stock ledger correctly reflects movements and daily aggregations', async () => {
      const product = await createProduct({
        itemNumber: 'P005',
        productName: 'Ledger Test Product',
        unitCostRmb: 10,
        unitCostUsd: 1.4,
        openingQuantity: 100,
      });

      const movements = await getStockLedger(product.id);
      // Verify closing balance matches formula
      // For a new product with opening stock of 100, ledger shows 100 opening, 0 received, 0 returns, 0 adjustments, 0 sold, 100 closing
      assert.strictEqual(movements[0].closingBalance, 100);
    });

    test('Cash Position calculations expected closing and variance', async () => {
      const date = new Date();
      // Set actual counted cash
      await setActualCash(date, 500);

      const cashPos = await getOrCreateCashPosition(date);
      // Expected = openingCash + cashSales + debtorPaymentsReceived + otherCashIn - expensesPaid - creditorPaymentsMade
      const expected = cashPos.openingCash + cashPos.cashSales + cashPos.debtorPaymentsReceived + cashPos.otherCashIn - cashPos.expensesPaid - cashPos.creditorPaymentsMade;
      assert.strictEqual(cashPos.expectedClosingCash, expected);
      assert.strictEqual(cashPos.variance, 500 - expected);
    });

    test('End of day closing DRAFT to CLOSED flow', async () => {
      const date = new Date();
      const summary = await getDayClosingSummary(date);

      // Create draft closing
      const closing = await createOrUpdateDayClosing(date, {
        actualCountedCash: 500,
        signOffName: 'Owner User',
        closingNotes: 'Closing the day tests',
      });

      assert.strictEqual(closing.status, 'DRAFT');

      // Finalize day closing
      const closed = await closeDayClosing(closing.id, 'Owner User', 500, 'system');
      assert.strictEqual(closed.status, 'CLOSED');
    });
  });
});
