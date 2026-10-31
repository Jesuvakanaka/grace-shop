// ZP-483: the revalidation shim uses exactly ZP-484's tag names and scope rules.
import { test } from 'node:test'
import assert from 'node:assert'
import { revalidateStorefront, storefrontTagsFor } from '../src/lib/website/revalidate'

test('no scope expires every storefront entry', () => {
  assert.deepStrictEqual(storefrontTagsFor(), ['storefront'])
})

test('product slugs: the products tag plus each valid slug (old and new)', () => {
  assert.deepStrictEqual(storefrontTagsFor({ productSlugs: ['old-dress', 'gold-evening-dress', null, 'Bad Slug!'] }), [
    'storefront:products',
    'storefront:product:old-dress',
    'storefront:product:gold-evening-dress',
  ])
  assert.deepStrictEqual(storefrontTagsFor({ productSlugs: [null] }), ['storefront:products'])
})

test('category slugs: the categories tag plus each slug', () => {
  assert.deepStrictEqual(storefrontTagsFor({ categorySlugs: ['dresses', 'dresses'] }), [
    'storefront:categories',
    'storefront:category:dresses',
  ])
})

test('outside a Next request it never throws', () => {
  assert.deepStrictEqual(revalidateStorefront({ productSlugs: ['x'] }), ['storefront:products', 'storefront:product:x'])
})
