import { test, describe, before, beforeEach, after } from 'node:test';
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

// UAT quick sign-in (GRACE_QUICK_LOGIN). Kept in this file so it runs after the
// DB wipe above instead of racing it from a parallel test process.
describe('8. UAT quick sign-in with the flag on', () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { GRACE_QUICK_LOGIN: env.GRACE_QUICK_LOGIN, JWT_SECRET: env.JWT_SECRET };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  };
  const quickPost = (body: string) =>
    new Request('http://localhost/api/auth/quick-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  /** Turn a Set-Cookie header into the Cookie header a browser would send back. */
  const cookieFrom = (res: Response) => {
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'expected a Set-Cookie header');
    return setCookie.split(';')[0];
  };
  const infoLines: unknown[][] = [];
  const originalInfo = console.info;

  before(async () => {
    env.GRACE_QUICK_LOGIN = 'true';
    env.JWT_SECRET ||= 'quick-login-tests-secret-0123456789abcdef';
    console.info = (...args: unknown[]) => {
      infoLines.push(args);
    };
    const { hashPassword } = await import('../src/lib/auth');
    const password = await hashPassword('quick-login-unused-password');
    await prisma.user.deleteMany({});
    // Inactive OWNER first (lowest id): must be skipped.
    await prisma.user.create({ data: { username: 'ql-old-owner', password, fullName: 'Old Owner', role: 'OWNER', active: false } });
    await prisma.user.create({ data: { username: 'ql-margie', password, fullName: 'Margaret', role: 'OWNER' } });
    await prisma.user.create({ data: { username: 'ql-staff', password, fullName: 'Shop Staff', role: 'STAFF' } });
    await prisma.user.create({ data: { username: 'ql-owner-2', password, fullName: 'Second Owner', role: 'OWNER' } });
  });

  after(() => {
    console.info = originalInfo;
    restore();
  });

  test('GET lists the first active user per role, without ids or password hashes', async () => {
    const { GET } = await import('../src/app/api/auth/quick-login/route');
    const res = await GET();
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.strictEqual(body.enabled, true);
    assert.strictEqual(typeof body.setupAllowed, 'boolean');
    assert.deepStrictEqual(body.users, [
      { role: 'OWNER', username: 'ql-margie', fullName: 'Margaret' },
      { role: 'STAFF', username: 'ql-staff', fullName: 'Shop Staff' },
    ]);
    assert.doesNotMatch(text, /password|\$2[aby]\$|"id"/);
  });

  test('POST OWNER sets the same auth cookie as login, and authorize() accepts it as OWNER', async () => {
    const { POST } = await import('../src/app/api/auth/quick-login/route');
    const { authorize, OWNER_ONLY } = await import('../src/lib/api-auth');
    const res = await POST(quickPost(JSON.stringify({ role: 'OWNER' })));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const margie = await prisma.user.findUnique({ where: { username: 'ql-margie' } });
    assert.deepStrictEqual(body, { user: { id: margie!.id, username: 'ql-margie', fullName: 'Margaret', role: 'OWNER' } });

    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /^auth-token=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=lax/i);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=86400/);
    assert.doesNotMatch(setCookie, /Secure/i); // NODE_ENV is not production in tests

    const auth = await authorize(new Request('http://localhost/api/x', { headers: { cookie: cookieFrom(res) } }), OWNER_ONLY);
    assert.ok(auth.ok, 'expected the quick-login cookie to authorize as OWNER');
    if (auth.ok) {
      assert.strictEqual(auth.session.role, 'OWNER');
      assert.strictEqual(auth.session.username, 'ql-margie');
      assert.strictEqual(auth.session.userId, margie!.id);
    }
    assert.ok(infoLines.some((l) => l[0] === '[quick-login]' && l[1] === 'OWNER' && l[2] === 'ql-margie'));
  });

  test('quick-login cookie flags match POST /api/auth/login exactly', async () => {
    const quick = await import('../src/app/api/auth/quick-login/route');
    const login = await import('../src/app/api/auth/login/route');
    const flags = (res: Response) =>
      // Expires is a wall-clock timestamp that can tick over between the two
      // responses; Max-Age carries the same lifetime, so compare everything else.
      (res.headers.get('set-cookie') ?? '').split(';').slice(1).map((s) => s.trim().toLowerCase())
        .filter((s) => !s.startsWith('expires=')).sort();
    const q = await quick.POST(quickPost(JSON.stringify({ role: 'STAFF' })));
    const l = await login.POST(quickPost(JSON.stringify({ username: 'ql-staff', password: 'quick-login-unused-password' })));
    assert.strictEqual(l.status, 200);
    assert.deepStrictEqual(flags(q), flags(l));
  });

  test('POST STAFF gives a STAFF session that gets 403 on an owner-only route', async () => {
    const { POST } = await import('../src/app/api/auth/quick-login/route');
    const res = await POST(quickPost(JSON.stringify({ role: 'STAFF' })));
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).user.role, 'STAFF');
    const adjust = await import('../src/app/api/stock-movements/adjust/route');
    const denied = await adjust.POST(
      new Request('http://localhost/api/stock-movements/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookieFrom(res) },
        body: '{}',
      })
    );
    assert.strictEqual(denied.status, 403);
    assert.ok(infoLines.some((l) => l[0] === '[quick-login]' && l[1] === 'STAFF' && l[2] === 'ql-staff'));
  });

  test('POST with a bad role is a 400 and sets no cookie', async () => {
    const { POST } = await import('../src/app/api/auth/quick-login/route');
    const res = await POST(quickPost(JSON.stringify({ role: 'ADMIN' })));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.headers.get('set-cookie'), null);
  });

  test('POST for a role with no active user is a 404', async () => {
    const { POST, GET } = await import('../src/app/api/auth/quick-login/route');
    await prisma.user.updateMany({ where: { role: 'STAFF' }, data: { active: false } });
    try {
      const res = await POST(quickPost(JSON.stringify({ role: 'STAFF' })));
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.headers.get('set-cookie'), null);
      const body = await (await GET()).json();
      assert.deepStrictEqual(body.users.map((u: { role: string }) => u.role), ['OWNER']);
    } finally {
      await prisma.user.updateMany({ where: { role: 'STAFF' }, data: { active: true } });
    }
  });
});

// scripts/set-user.js against this test DB (users only; never passwords).
describe('9. set-user script (rename owner -> margie)', () => {
  let originalHash: string;
  let setUser: typeof import('../scripts/set-user.js').setUser;

  before(async () => {
    ({ setUser } = await import('../scripts/set-user.js'));
    const { hashPassword } = await import('../src/lib/auth');
    await prisma.user.deleteMany({});
    const owner = await prisma.user.create({
      data: { username: 'owner', password: await hashPassword('set-user-test-password'), fullName: 'Business Owner', role: 'OWNER' },
    });
    originalHash = owner.password;
  });

  test('first run renames owner to margie and sets the full name, keeping id, role and password', async () => {
    const beforeRename = await prisma.user.findUnique({ where: { username: 'owner' } });
    const result = await setUser(prisma, { from: 'owner', to: 'margie', fullName: 'Margaret' });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.action, 'rename');
    assert.strictEqual(await prisma.user.findUnique({ where: { username: 'owner' } }), null);
    const margie = await prisma.user.findUnique({ where: { username: 'margie' } });
    assert.strictEqual(margie?.id, beforeRename?.id);
    assert.strictEqual(margie?.fullName, 'Margaret');
    assert.strictEqual(margie?.role, 'OWNER');
    assert.strictEqual(margie?.password, originalHash);
    assert.doesNotMatch(result.message, /\$2[aby]\$|password/i);
  });

  test('second run is a no-op with exit 0', async () => {
    const result = await setUser(prisma, { from: 'owner', to: 'margie', fullName: 'Margaret' });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.action, 'noop');
    assert.strictEqual(await prisma.user.count({ where: { username: 'margie' } }), 1);
  });

  test('when --to exists only the full name changes', async () => {
    const result = await setUser(prisma, { from: 'owner', to: 'margie', fullName: 'Margaret G' });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.action, 'update');
    const margie = await prisma.user.findUnique({ where: { username: 'margie' } });
    assert.strictEqual(margie?.fullName, 'Margaret G');
    assert.strictEqual(margie?.password, originalHash);
  });

  test('both --from and --to exist as different users: exit 1, nothing changes', async () => {
    const { hashPassword } = await import('../src/lib/auth');
    const other = await prisma.user.create({
      data: { username: 'set-user-other', password: await hashPassword('set-user-other-password'), fullName: 'Other', role: 'STAFF' },
    });
    const margie = await prisma.user.findUnique({ where: { username: 'margie' } });
    const result = await setUser(prisma, { from: 'set-user-other', to: 'margie', fullName: 'Changed' });
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(result.message, `Both 'set-user-other' (id ${other.id}) and 'margie' (id ${margie!.id}) exist; resolve manually. Nothing changed.`);
    assert.strictEqual((await prisma.user.findUnique({ where: { id: margie!.id } }))?.fullName, margie!.fullName);
    assert.strictEqual((await prisma.user.findUnique({ where: { id: other.id } }))?.username, 'set-user-other');
  });

  test('neither user exists: exit 1, nothing changes', async () => {
    const countBefore = await prisma.user.count();
    const result = await setUser(prisma, { from: 'nobody', to: 'nobody-else' });
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.message, /Neither 'nobody' nor 'nobody-else' exists/);
    assert.strictEqual(await prisma.user.count(), countBefore);
  });
});
