/**
 * ZP-512: /p/<slug> is the flip feed on that look with its details sheet
 * open (src/lib/storefront/product-landing.ts).
 * - Which pages get the full-screen feed frame (home, and /p/<slug>; not its 404).
 * - The history entries written when a /p/<slug> page lands: the feed on
 *   that look behind, the sheet entry (`?d=<slug>`) on top, like `/?d=<slug>`.
 * - The landing piece's place in the first load.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'
import { isFeedFrame, productLandingHistory, withLandingItem } from '../src/lib/storefront/product-landing'

describe('feed frame (no header / footer)', () => {
  test('home: /site on UAT, / on a storefront host (segment null)', () => {
    assert.strictEqual(isFeedFrame({ segment: null, pathname: '/site' }), true)
    assert.strictEqual(isFeedFrame({ segment: null, pathname: '/' }), true)
  })
  test('the product route /p/<slug>, also after its URL became the feed URL', () => {
    assert.strictEqual(isFeedFrame({ segment: 'p', pathname: '/site/p/linen-dress' }), true)
    assert.strictEqual(isFeedFrame({ segment: 'p', pathname: '/p/linen-dress' }), true)
    assert.strictEqual(isFeedFrame({ segment: 'p', pathname: '/site' }), true)
  })
  test('other pages and the 404 boundary (segment null on a non-home path) keep the header', () => {
    assert.strictEqual(isFeedFrame({ segment: null, pathname: '/site/p/unknown' }), false)
    assert.strictEqual(isFeedFrame({ segment: 'shop', pathname: '/site/shop' }), false)
    assert.strictEqual(isFeedFrame({ segment: 'collections', pathname: '/collections/dresses' }), false)
  })
})

describe('productLandingHistory', () => {
  test('feed on the look behind, sheet entry on top (home path of this host)', () => {
    assert.deepStrictEqual(productLandingHistory({ homePath: '/site', search: '', slug: 'linen-dress' }), {
      replace: '/site#look-linen-dress',
      push: '/site?d=linen-dress#look-linen-dress',
    })
    assert.deepStrictEqual(productLandingHistory({ homePath: '/', search: '', slug: 'linen-dress' }), {
      replace: '/#look-linen-dress',
      push: '/?d=linen-dress#look-linen-dress',
    })
  })
  test('campaign parameters are kept; preview and a stray d are not', () => {
    assert.deepStrictEqual(
      productLandingHistory({ homePath: '/', search: '?utm_source=ig&preview=abc&d=other', slug: 'linen-dress' }),
      { replace: '/?utm_source=ig#look-linen-dress', push: '/?utm_source=ig&d=linen-dress#look-linen-dress' },
    )
  })
})

describe('withLandingItem', () => {
  const a = { slug: 'a' }
  const b = { slug: 'b' }
  const c = { slug: 'c' }
  test('unchanged when the look is in the load', () => {
    assert.deepStrictEqual(withLandingItem([a, b], b), [a, b])
  })
  test('first when it is not (further down than one load reaches)', () => {
    assert.deepStrictEqual(withLandingItem([a, b], c), [c, a, b])
  })
})
