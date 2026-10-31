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
      assert.ok(mapped.mapped);
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

// ZP-465: audit fields must come from the session, never from the client body.
// Kept in this file (not a separate one) so it runs after the DB wipe above instead
// of racing it from a parallel test process.
describe('6. Audit fields come from the session (ZP-465)', () => {
  const asJson = (token: string, body: unknown) =>
    new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: `auth-token=${token}` },
      body: JSON.stringify(body),
    });
  let staffToken: string;
  let ownerToken: string;
  let productId: number;

  before(async () => {
    process.env.JWT_SECRET ||= 'zp465-audit-field-tests-secret-0123456789abcdef';
    const { createToken } = await import('../src/lib/auth');
    staffToken = await createToken(910001, 'audit-staff', 'STAFF');
    ownerToken = await createToken(910002, 'audit-owner', 'OWNER');
    const p = await createProduct({
      itemNumber: 'ZP465-AUDIT', productName: 'Audit Product', unitCostRmb: 10, unitCostUsd: 1.4, openingQuantity: 10,
    });
    productId = p.id;
  });

  test('STAFF POST /api/expenses with createdBy "owner" stores the session username and ignores unknown columns', async () => {
    const { POST } = await import('../src/app/api/expenses/route');
    const res = await POST(asJson(staffToken, {
      category: 'Food', description: 'audit lunch', amount: 3,
      createdBy: 'owner', createdAt: '2000-01-01T00:00:00.000Z', id: 987654,
    }));
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    const stored = await prisma.expense.findUnique({ where: { id: body.id } });
    assert.strictEqual(stored?.createdBy, 'audit-staff');
    assert.notStrictEqual(stored?.id, 987654);
    assert.notStrictEqual(stored?.createdAt.getUTCFullYear(), 2000);
  });

  test('STAFF POST /api/sales with createdBy "owner" stores the session username', async () => {
    const { POST } = await import('../src/app/api/sales/route');
    const res = await POST(asJson(staffToken, {
      paymentType: 'CASH', items: [{ productId, quantity: 1, unitPrice: 20 }], cashAmount: 20,
      createdBy: 'owner',
    }));
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    const stored = await prisma.sale.findUnique({ where: { id: body.id } });
    assert.strictEqual(stored?.createdBy, 'audit-staff');
  });

  test('OWNER POST /api/products with createdBy "someone-else" stores the session username', async () => {
    const { POST } = await import('../src/app/api/products/route');
    const res = await POST(asJson(ownerToken, {
      itemNumber: 'ZP465-AUDIT-2', productName: 'Audit Product 2', unitCostRmb: 5, unitCostUsd: 0.7, openingQuantity: 1,
      createdBy: 'someone-else',
    }));
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    const stored = await prisma.product.findUnique({ where: { id: body.id } });
    assert.strictEqual(stored?.createdBy, 'audit-owner');
  });
});

// ZP-465: 500 responses must not leak internals (JWT config, Prisma errors).
describe('7. Auth routes return generic 500s (ZP-465)', () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { NODE_ENV: env.NODE_ENV, JWT_SECRET: env.JWT_SECRET, ALLOW_SETUP: env.ALLOW_SETUP };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  };
  const post = (body: string) =>
    new Request('http://localhost/api/auth/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

  test('setup with a misconfigured JWT secret: generic 500 and no OWNER created', async () => {
    const { POST } = await import('../src/app/api/auth/setup/route');
    await prisma.user.deleteMany({});
    env.NODE_ENV = 'production';
    env.ALLOW_SETUP = 'true';
    delete env.JWT_SECRET;
    try {
      const res = await POST(post(JSON.stringify({ username: 'zp465-setup', password: 'zp465-setup-password', fullName: 'X' })));
      assert.strictEqual(res.status, 500);
      assert.deepStrictEqual(await res.json(), { error: 'Internal Server Error' });
      assert.strictEqual(await prisma.user.count(), 0);
    } finally {
      restore();
    }
  });

  test('login with a misconfigured JWT secret: generic 500 without the config message', async () => {
    const { POST } = await import('../src/app/api/auth/login/route');
    const { hashPassword } = await import('../src/lib/auth');
    await prisma.user.create({
      data: { username: 'zp465-login', password: await hashPassword('zp465-login-password'), fullName: 'L', role: 'STAFF' },
    });
    env.NODE_ENV = 'production';
    delete env.JWT_SECRET;
    try {
      const res = await POST(post(JSON.stringify({ username: 'zp465-login', password: 'zp465-login-password' })));
      assert.strictEqual(res.status, 500);
      const text = await res.text();
      assert.deepStrictEqual(JSON.parse(text), { error: 'Internal Server Error' });
      assert.doesNotMatch(text, /JWT|prisma/i);
    } finally {
      restore();
    }
  });

  test('malformed JSON body is a 400, not a 500 with a parser message', async () => {
    const login = await import('../src/app/api/auth/login/route');
    const res = await login.POST(post('{not-json'));
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(await res.json(), { error: 'Invalid request body' });
  });
});
