// ZP-489: the collection page's 404 cases against the real (cached) data
// layer: an unknown and an UNPUBLISHED category give notFound; a published
// one lists only its public products. Also checks the listing never adds
// cache entries (the catalogue + categories entries are the only two).
// Only touches rows it creates ("ZP489C-*", "zp489c-*").
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import { createStorefront, type CacheFn } from '../src/lib/storefront/cached'
import { collectionsWithProducts, loadListing, parseListingQuery, sortForScope } from '../src/lib/storefront/listing-query'

async function cleanup() {
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP489C-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp489c-' } } })
}

/**
 * A memoising stand-in for unstable_cache: one stored value per key (key
 * parts + arguments, as unstable_cache keys entries). `loads` counts calls to
 * the underlying loaders, i.e. cache misses that would hit the database.
 */
function memoCache() {
  const store = new Map<string, Promise<unknown>>()
  let loads = 0
  const cache: CacheFn = (fn, keyParts) =>
    (async (...args: unknown[]) => {
      const key = JSON.stringify([keyParts, args])
      if (!store.has(key)) {
        loads += 1
        store.set(key, fn(...(args as [])))
      }
      return store.get(key)
    }) as unknown as typeof fn
  return { cache, entries: () => store.size, loads: () => loads }
}

describe('collection page data (DB)', () => {
  before(async () => {
    await cleanup()
    const pub = await prisma.category.create({ data: { slug: 'zp489c-pub', name: 'ZP489C Pub', published: true } })
    const hidden = await prisma.category.create({ data: { slug: 'zp489c-hidden', name: 'ZP489C Hidden', published: false } })
    const make = (n: number, categoryId: number, published = true) =>
      prisma.product.create({
        data: {
          itemNumber: `ZP489C-${n}`,
          productName: `ZP489C ${n}`,
          slug: `zp489c-${n}`,
          published,
          publishedAt: published ? new Date() : null,
          categoryId,
          currentQuantity: 5,
        },
      })
    await make(1, pub.id)
    await make(2, pub.id)
    await make(3, pub.id, false)
    await make(4, hidden.id)
  })
  after(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('unknown and unpublished categories are notFound; a published one lists its public products', async () => {
    const sf = createStorefront({ db: prisma, cache: memoCache().cache })
    const q = parseListingQuery({})
    assert.deepStrictEqual(await loadListing(sf, { kind: 'category', slug: 'zp489c-nope' }, q, '/x'), { kind: 'notFound' })
    assert.deepStrictEqual(await loadListing(sf, { kind: 'category', slug: 'zp489c-hidden' }, q, '/x'), { kind: 'notFound' })

    const ok = await loadListing(sf, { kind: 'category', slug: 'zp489c-pub' }, q, '/x')
    assert.ok(ok.kind === 'ok')
    assert.deepStrictEqual(ok.page.items.map((p) => p.slug).sort(), ['zp489c-1', 'zp489c-2'])
    assert.strictEqual(ok.category?.slug, 'zp489c-pub')

    // The product in the unpublished category is not public anywhere.
    const all = await loadListing(sf, { kind: 'all' }, q, '/x')
    assert.ok(all.kind === 'ok')
    assert.ok(!all.page.items.some((p) => p.slug === 'zp489c-4' || p.slug === 'zp489c-3'))

  })

  test('every listing query is answered from the same two cached loads (no per-request DB work)', async () => {
    // Count the database calls the loaders make, through a proxy over prisma.
    let dbCalls = 0
    const counted = new Proxy(prisma, {
      get(target, prop, receiver) {
        const model = Reflect.get(target, prop, receiver)
        if (typeof prop !== 'string' || prop.startsWith('$') || typeof model !== 'object' || model === null) return model
        return new Proxy(model, {
          get(m, method, r) {
            const value = Reflect.get(m, method, r)
            if (typeof value !== 'function') return value
            return (...args: unknown[]) => {
              dbCalls += 1
              return value.apply(m, args)
            }
          },
        })
      },
    })
    const memo = memoCache()
    const sf = createStorefront({ db: counted, cache: memo.cache })
    const queries = [
      {},
      { sort: 'newest' },
      { sort: 'price-asc', soldout: 'hide' },
      { sort: 'price-desc', page: '2' },
      { page: '999' },
      { page: 'abc', sort: 'bogus' },
    ]
    const scopes = [
      { kind: 'all' },
      { kind: 'new' },
      { kind: 'category', slug: 'zp489c-pub' },
      { kind: 'category', slug: 'zp489c-hidden' },
      { kind: 'category', slug: 'zp489c-nope' },
    ] as const
    await loadListing(sf, { kind: 'all' }, parseListingQuery({}), '/x')
    await loadListing(sf, { kind: 'category', slug: 'zp489c-pub' }, parseListingQuery({}), '/x')
    assert.strictEqual(memo.loads(), 2, 'warm: catalogue + categories')
    const warmDbCalls = dbCalls
    assert.ok(warmDbCalls > 0, 'the proxy sees the loaders’ queries')

    for (const scope of scopes) {
      for (const query of queries) {
        const parsed = parseListingQuery(query)
        await loadListing(sf, scope, parsed, '/x')
        await sortForScope(sf, scope, parsed)
      }
    }
    await collectionsWithProducts(sf, await sf.listPublishedCategories())

    assert.strictEqual(memo.loads(), 2, 'no further loader calls')
    assert.strictEqual(memo.entries(), 2, 'no further cache entries')
    assert.strictEqual(dbCalls, warmDbCalls, 'no further database calls')
  })
})
