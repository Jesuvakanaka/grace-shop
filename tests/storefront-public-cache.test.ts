// ZP-484 review: anonymous requests must not grow the data cache.
// The cached storefront keeps exactly two entries (the public catalogue and
// the category list), whatever the query or slug. Uses the real
// createStorefront with a recording stand-in for unstable_cache.
// Only touches rows it creates ("ZP484C-*", "zp484c-*").
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import { createStorefront, type CacheFn } from '../src/lib/storefront/cached'
import { STOREFRONT_REVALIDATE_SECONDS } from '../src/lib/storefront/cache-tags'
import { setProductSlug } from '../src/lib/storefront-model/db'

const KEY = (c: string) => `products/${c.repeat(32)}.webp`

async function cleanup() {
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP484C-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp484c-' } } })
}

type Entry = { key: string; tags: string[]; revalidate: number | false | undefined }

function recordingCache() {
  const entries = new Map<string, Entry>()
  let loads = 0
  const cache: CacheFn = (fn, keyParts, options) =>
    (async (...args: unknown[]) => {
      // unstable_cache keys an entry by its key parts AND its arguments.
      const key = JSON.stringify([keyParts, args])
      entries.set(key, { key, tags: [...(options.tags ?? [])], revalidate: options.revalidate })
      loads += 1
      return fn(...(args as []))
    }) as unknown as typeof fn
  return { cache, entries, loads: () => loads }
}

describe('storefront cache entries are bounded', () => {
  before(async () => {
    await cleanup()
    const cat = await prisma.category.create({ data: { slug: 'zp484c-cat', name: 'ZP484C', published: true } })
    for (const n of [1, 2, 3]) {
      const p = await prisma.product.create({
        data: {
          itemNumber: `ZP484C-${n}`,
          productName: `ZP484C ${n}`,
          slug: `zp484c-${n}`,
          published: true,
          publishedAt: new Date(),
          categoryId: cat.id,
          currentQuantity: 5,
        },
      })
      await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY(String(n)), isPrimary: true } })
    }
    const p1 = await prisma.product.findUniqueOrThrow({ where: { slug: 'zp484c-1' } })
    await setProductSlug(prisma, p1.id, 'zp484c-1-new') // zp484c-1 becomes a redirect
  })
  after(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('varied queries and unknown slugs use the same two entries', async () => {
    const rec = recordingCache()
    const sf = createStorefront({ db: prisma, cache: rec.cache })

    // Warm up: one call of each kind.
    await sf.listPublishedProducts()
    await sf.listPublishedCategories()
    const warm = new Set(rec.entries.keys())
    assert.strictEqual(warm.size, 2)

    for (let i = 0; i < 200; i++) {
      await sf.listPublishedProducts({ categorySlug: `zp484c-missing-${i}`, page: (i % 5) + 1, pageSize: (i % 48) + 1 })
    }
    for (const sort of ['featured', 'newest', 'price-asc', 'price-desc', 'name'] as const) {
      await sf.listPublishedProducts({ sort, newOnly: true, featuredOnly: false, hideSoldOut: true })
    }
    for (let i = 0; i < 50; i++) {
      assert.strictEqual(await sf.getPublishedProductBySlug(`zp484c-nope-${i}`), null)
      assert.deepStrictEqual(await sf.listRelatedProducts(`zp484c-nope-${i}`, (i % 12) + 1), [])
      assert.strictEqual(await sf.getPublishedCategory(`zp484c-nope-${i}`), null)
    }
    await sf.getPublishedProductBySlug('Not A Slug')
    await sf.getPublishedProductBySlug('x'.repeat(5000))
    await sf.getPublishedProductBySlug('zp484c-2', { includeItemNumber: true })

    assert.deepStrictEqual(new Set(rec.entries.keys()), warm, 'no new cache entries')
  })

  test('the two entries carry the storefront tags and the 60 s backstop', async () => {
    const rec = recordingCache()
    const sf = createStorefront({ db: prisma, cache: rec.cache })
    await sf.listPublishedProducts()
    await sf.listPublishedCategories()
    const tags = [...rec.entries.values()].map((e) => e.tags.slice().sort())
    assert.deepStrictEqual(tags.sort(), [
      ['storefront', 'storefront:categories'],
      ['storefront', 'storefront:categories', 'storefront:products'],
    ])
    for (const e of rec.entries.values()) assert.strictEqual(e.revalidate, STOREFRONT_REVALIDATE_SECONDS)
  })

  test('answers come from the catalogue: filter, slug, redirect, related, category', async () => {
    const sf = createStorefront({ db: prisma, cache: recordingCache().cache })
    const list = await sf.listPublishedProducts({ categorySlug: 'zp484c-cat' })
    assert.deepStrictEqual(list.items.map((p) => p.slug).sort(), ['zp484c-1-new', 'zp484c-2', 'zp484c-3'])
    assert.strictEqual((await sf.listPublishedProducts({ categorySlug: 'zp484c-missing' })).total, 0)

    const live = await sf.getPublishedProductBySlug('zp484c-2')
    assert.ok(live && 'product' in live && live.product.slug === 'zp484c-2')
    assert.ok(!('itemNumber' in live.product))
    const withItem = await sf.getPublishedProductBySlug('zp484c-2', { includeItemNumber: true })
    assert.ok(withItem && 'product' in withItem && withItem.product.itemNumber === 'ZP484C-2')
    assert.deepStrictEqual(await sf.getPublishedProductBySlug('zp484c-1'), { redirectTo: 'zp484c-1-new' })

    const related = (await sf.listRelatedProducts('zp484c-2', 2)).map((p) => p.slug)
    assert.deepStrictEqual(related.sort(), ['zp484c-1-new', 'zp484c-3'])
    assert.deepStrictEqual(await sf.getPublishedCategory('zp484c-cat'), {
      slug: 'zp484c-cat',
      name: 'ZP484C',
      description: null,
      heroImage: null,
    })
  })

  test('the cached catalogue holds no private fields', async () => {
    let stored: unknown
    const cache: CacheFn = (fn) =>
      (async (...args: unknown[]) => {
        const value = await fn(...(args as []))
        stored ??= value
        return value
      }) as unknown as typeof fn
    await createStorefront({ db: prisma, cache }).listPublishedProducts()
    const json = JSON.stringify(stored)
    assert.ok(json.includes('zp484c-2'))
    for (const k of ['cost', 'wholesale', 'Quantity', 'source', 'notes', 'createdBy', 'updatedBy', 'sellingPrice']) {
      assert.ok(!json.includes(k), k)
    }
  })
})
