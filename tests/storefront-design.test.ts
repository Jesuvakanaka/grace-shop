/**
 * ZP-481: storefront design system, pure parts.
 * - Product card derivations from the public product DTO (src/components/storefront/product.ts).
 * - The design preview art route's key parsing (src/app/site/preview/placeholder-art.ts) and gate.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  availabilityLabel,
  cardImages,
  formatPriceUsd,
  productHref,
  toImageData,
} from '../src/components/storefront/product';
import type { PublicProduct } from '../src/components/storefront/types';
import { renderArt } from '../src/app/site/preview/placeholder-art';
import { storefrontPreviewEnabled } from '../src/app/site/preview/preview-gate';
import { GET as artRoute } from '../src/app/site/preview/art/[key]/route';

function product(overrides: Partial<PublicProduct> = {}): PublicProduct {
  return {
    slug: 'lime-wrap-dress',
    name: 'Lime wrap dress',
    description: null,
    category: { slug: 'dresses', name: 'Dresses' },
    colours: null,
    sizes: null,
    availability: 'IN_STOCK',
    images: [],
    isNew: false,
    featured: false,
    priceUsd: null,
    ...overrides,
  };
}

describe('ProductCard derivations from the public DTO', () => {
  test('default href is /site/p/<slug>, slug encoded', () => {
    assert.strictEqual(productHref('lime-wrap-dress'), '/site/p/lime-wrap-dress');
    assert.strictEqual(productHref('a b/c'), '/site/p/a%20b%2Fc');
  });

  test('price label: whole dollars, cents, and null/zero/negative/NaN mean ask for price', () => {
    assert.strictEqual(formatPriceUsd(45), '$45');
    assert.strictEqual(formatPriceUsd(45.5), '$45.50');
    assert.strictEqual(formatPriceUsd(null), null);
    assert.strictEqual(formatPriceUsd(0), null);
    assert.strictEqual(formatPriceUsd(-3), null);
    assert.strictEqual(formatPriceUsd(Number.NaN), null);
  });

  test('availability badge uses the model enum values; none when in stock', () => {
    assert.strictEqual(availabilityLabel('IN_STOCK'), null);
    assert.strictEqual(availabilityLabel('FEW_LEFT'), 'Few left');
    assert.strictEqual(availabilityLabel('SOLD_OUT'), 'Sold out');
  });

  test('primary and hover photos are the first two DTO images; null sizes become undefined', () => {
    const p = product({
      images: [
        { url: '/api/images/public/a.webp', alt: 'Front', width: null, height: null },
        { url: '/api/images/public/b.webp', alt: 'Back', width: 800, height: 1000 },
        { url: '/api/images/public/c.webp', alt: 'Detail', width: null, height: null },
      ],
    });
    const { primary, hover } = cardImages(p);
    assert.deepStrictEqual(primary, { src: '/api/images/public/a.webp', alt: 'Front', width: undefined, height: undefined });
    assert.deepStrictEqual(hover, { src: '/api/images/public/b.webp', alt: 'Back', width: 800, height: 1000 });
    assert.deepStrictEqual(cardImages(product()), { primary: undefined, hover: undefined });
    assert.deepStrictEqual(cardImages(product({ images: [p.images[0]] })).hover, undefined);
    assert.strictEqual(toImageData(p.images[1]).width, 800);
  });
});

describe('design preview art keys', () => {
  test('known shape.tone (and .detail, hero) render SVG', () => {
    for (const key of ['dress.limeOnCream.svg', 'tote.creamOnStone.detail.svg', 'hero.desktop.svg', 'hero.mobile.svg']) {
      assert.match(renderArt(key) ?? '', /^<svg /, key);
    }
  });

  test('inherited keys, unknown names and extra segments are null (404), never a throw', () => {
    for (const key of [
      'dress.constructor.svg',
      'dress.__proto__.svg',
      '__proto__',
      'constructor.svg',
      'dress.toString.svg',
      'dress.hasOwnProperty.detail.svg',
      'dress.limeOnCream',
      'dress.limeOnCream.svg.svg',
      'dress.limeOnCream.zoom.svg',
      'dress.limeOnCream.detail.extra.svg',
      'gown.limeOnCream.svg',
      '../dress.limeOnCream.svg',
      'hero.svg',
      '',
    ]) {
      assert.doesNotThrow(() => renderArt(key), key);
      assert.strictEqual(renderArt(key), null, key);
    }
  });

  test('preview gate is exactly "true"', () => {
    assert.strictEqual(storefrontPreviewEnabled({ GRACE_STOREFRONT_PREVIEW: 'true' }), true);
    for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      assert.strictEqual(storefrontPreviewEnabled({ GRACE_STOREFRONT_PREVIEW: v }), false, String(v));
    }
  });

  test('route: 404 for hostile keys and when the preview is off, 200 SVG otherwise', async () => {
    const previous = process.env.GRACE_STOREFRONT_PREVIEW;
    const call = (key: string) => artRoute(new Request('http://x/'), { params: Promise.resolve({ key }) });
    try {
      process.env.GRACE_STOREFRONT_PREVIEW = 'true';
      for (const key of ['dress.constructor.svg', '__proto__', 'dress.limeOnCream.a.b.svg']) {
        assert.strictEqual((await call(key)).status, 404, key);
      }
      const ok = await call('dress.limeOnCream.svg');
      assert.strictEqual(ok.status, 200);
      assert.match(ok.headers.get('content-type') ?? '', /^image\/svg\+xml/);
      process.env.GRACE_STOREFRONT_PREVIEW = 'false';
      assert.strictEqual((await call('dress.limeOnCream.svg')).status, 404);
    } finally {
      if (previous === undefined) delete process.env.GRACE_STOREFRONT_PREVIEW;
      else process.env.GRACE_STOREFRONT_PREVIEW = previous;
    }
  });
});
