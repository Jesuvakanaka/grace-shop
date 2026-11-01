/**
 * ZP-481: storefront price helpers (src/components/storefront/product.ts).
 * ZP-514: the product card derivations and the design preview page (with its
 * art route and gate) are gone with the grid pages and /site/preview.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ASK_FOR_PRICE, formatPriceUsd } from '../src/components/storefront/product';

describe('price label', () => {
  test('whole dollars, cents, and null/zero/negative/NaN mean ask for price', () => {
    assert.strictEqual(formatPriceUsd(45), '$45');
    assert.strictEqual(formatPriceUsd(45.5), '$45.50');
    assert.strictEqual(formatPriceUsd(null), null);
    assert.strictEqual(formatPriceUsd(0), null);
    assert.strictEqual(formatPriceUsd(-3), null);
    assert.strictEqual(formatPriceUsd(Number.NaN), null);
    assert.strictEqual(ASK_FOR_PRICE, 'Ask for price');
  });
});
