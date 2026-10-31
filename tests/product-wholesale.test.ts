// ZP-475: wholesale price / wholesale minimum quantity on products.
// Pure tests plus route-handler tests that stop before any database write,
// so this file does not race with business-rules.test.ts (which wipes the DB).
import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { parseWholesaleFields } from '../src/lib/validation/product';
import { getMissingProductDetails, productNeedsDetails } from '../src/lib/product-completeness';
import { pickProductUpdateFields } from '../src/lib/products';

describe('parseWholesaleFields (server validation)', () => {
  test('absent fields are left out so an update does not touch them', () => {
    assert.deepStrictEqual(parseWholesaleFields({ productName: 'x' }), { ok: true, data: {} });
  });

  test('null and empty string clear the value to null (not 0)', () => {
    assert.deepStrictEqual(parseWholesaleFields({ wholesalePriceUsd: null, wholesaleMinQuantity: '' }), {
      ok: true,
      data: { wholesalePriceUsd: null, wholesaleMinQuantity: null },
    });
    assert.deepStrictEqual(parseWholesaleFields({ wholesalePriceUsd: '  ', wholesaleMinQuantity: null }), {
      ok: true,
      data: { wholesalePriceUsd: null, wholesaleMinQuantity: null },
    });
  });

  test('accepts valid numbers and numeric strings', () => {
    assert.deepStrictEqual(parseWholesaleFields({ wholesalePriceUsd: 12.5, wholesaleMinQuantity: 6 }), {
      ok: true,
      data: { wholesalePriceUsd: 12.5, wholesaleMinQuantity: 6 },
    });
    assert.deepStrictEqual(parseWholesaleFields({ wholesalePriceUsd: '0', wholesaleMinQuantity: '1' }), {
      ok: true,
      data: { wholesalePriceUsd: 0, wholesaleMinQuantity: 1 },
    });
  });

  test('rejects a negative, non-finite or non-numeric wholesale price', () => {
    for (const bad of [-1, -0.01, 'abc', '12abc', Infinity, NaN, true, {}, [5]]) {
      const r = parseWholesaleFields({ wholesalePriceUsd: bad });
      assert.strictEqual(r.ok, false, `expected ${String(bad)} to be rejected`);
      if (!r.ok) assert.match(r.error, /wholesale price/i);
    }
  });

  test('rejects a wholesale minimum quantity that is not a whole number >= 1', () => {
    for (const bad of [0, -3, 2.5, '2.5', 'six', 2147483648, false]) {
      const r = parseWholesaleFields({ wholesaleMinQuantity: bad });
      assert.strictEqual(r.ok, false, `expected ${String(bad)} to be rejected`);
      if (!r.ok) assert.match(r.error, /minimum quantity/i);
    }
  });
});

describe('pickProductUpdateFields (no arbitrary body fields reach Prisma)', () => {
  test('keeps editable fields and drops everything else', () => {
    const picked = pickProductUpdateFields({
      productName: 'New name',
      wholesalePriceUsd: 3,
      wholesaleMinQuantity: null,
      itemNumber: 'HACK',
      currentQuantity: 9999,
      id: 1,
      createdAt: 'x',
    });
    assert.deepStrictEqual(picked, { productName: 'New name', wholesalePriceUsd: 3, wholesaleMinQuantity: null });
  });
});

describe('getMissingProductDetails ("needs details" check, reused by ZP-468)', () => {
  const complete = { unitCostRmb: 55, unitCostUsd: 8.13, sellingPriceUsd: 16.26, wholesalePriceUsd: 12.5 };

  test('a complete product needs nothing (zero stock is not missing)', () => {
    assert.deepStrictEqual(getMissingProductDetails({ ...complete, currentQuantity: 0 } as typeof complete), []);
    assert.strictEqual(productNeedsDetails(complete), false);
  });

  test('a wholesale price of 0 counts as set; null/undefined counts as missing', () => {
    assert.deepStrictEqual(getMissingProductDetails({ ...complete, wholesalePriceUsd: 0 }), []);
    assert.deepStrictEqual(getMissingProductDetails({ ...complete, wholesalePriceUsd: null }), ['wholesale price']);
    assert.deepStrictEqual(getMissingProductDetails({ ...complete, wholesalePriceUsd: undefined }), ['wholesale price']);
    assert.strictEqual(productNeedsDetails({ ...complete, wholesalePriceUsd: null }), true);
  });

  test('cost price is missing only when both RMB and USD cost are 0', () => {
    assert.deepStrictEqual(getMissingProductDetails({ ...complete, unitCostUsd: 0 }), []);
    assert.deepStrictEqual(getMissingProductDetails({ ...complete, unitCostRmb: 0 }), []);
    assert.deepStrictEqual(getMissingProductDetails({ ...complete, unitCostRmb: 0, unitCostUsd: 0 }), ['cost price']);
  });

  test('retail price missing when selling price USD is 0; reasons come in a stable order', () => {
    assert.deepStrictEqual(
      getMissingProductDetails({ unitCostRmb: 0, unitCostUsd: 0, sellingPriceUsd: 0, wholesalePriceUsd: null }),
      ['cost price', 'retail price', 'wholesale price'],
    );
  });
});

describe('product route handlers', () => {
  const TEST_SECRET = 'zp475-unit-test-secret-0123456789abcdef';
  let createToken: (userId: number, username: string, role: string) => Promise<string>;
  let putProduct: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  let postProduct: (req: Request) => Promise<Response>;

  before(async () => {
    // auth.ts reads JWT_SECRET at import time, so import after setting it.
    process.env.JWT_SECRET = TEST_SECRET;
    ({ createToken } = await import('../src/lib/auth'));
    ({ PUT: putProduct } = await import('../src/app/api/products/[id]/route'));
    ({ POST: postProduct } = await import('../src/app/api/products/route'));
  });

  async function jsonRequest(url: string, method: string, role: string | null, body: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (role) headers.cookie = `auth-token=${await createToken(role === 'OWNER' ? 1 : 2, role.toLowerCase(), role)}`;
    return new Request(url, { method, headers, body: JSON.stringify(body) });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  test('STAFF cannot edit wholesale fields (PUT -> 403)', async () => {
    const req = await jsonRequest('http://localhost/api/products/1', 'PUT', 'STAFF', {
      wholesalePriceUsd: 12.5,
      wholesaleMinQuantity: 6,
    });
    const res = await putProduct(req, ctx('1'));
    assert.strictEqual(res.status, 403);
  });

  test('STAFF cannot create a product with wholesale fields (POST -> 403)', async () => {
    const req = await jsonRequest('http://localhost/api/products', 'POST', 'STAFF', {
      itemNumber: 'ZP475-STAFF',
      productName: 'x',
      unitCostRmb: 1,
      openingQuantity: 0,
      wholesalePriceUsd: 1,
    });
    const res = await postProduct(req);
    assert.strictEqual(res.status, 403);
  });

  test('OWNER PUT with a negative wholesale price -> 400 with a clear message', async () => {
    const req = await jsonRequest('http://localhost/api/products/1', 'PUT', 'OWNER', { wholesalePriceUsd: -1 });
    const res = await putProduct(req, ctx('1'));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /wholesale price/i);
  });

  test('OWNER PUT with wholesale minimum quantity 0 -> 400', async () => {
    const req = await jsonRequest('http://localhost/api/products/1', 'PUT', 'OWNER', { wholesaleMinQuantity: 0 });
    const res = await putProduct(req, ctx('1'));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /minimum quantity/i);
  });

  test('OWNER POST with a non-integer wholesale minimum quantity -> 400', async () => {
    const req = await jsonRequest('http://localhost/api/products', 'POST', 'OWNER', {
      itemNumber: 'ZP475-BAD',
      productName: 'x',
      unitCostRmb: 1,
      openingQuantity: 0,
      wholesaleMinQuantity: 2.5,
    });
    const res = await postProduct(req);
    assert.strictEqual(res.status, 400);
  });
});
