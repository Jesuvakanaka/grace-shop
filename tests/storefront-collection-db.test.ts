// ZP-489: the collection page's 404 cases against the real (cached) data
// layer: an unknown and an UNPUBLISHED category give notFound; a published
// one lists only its public products. Also checks the listing never adds
// cache entries (the catalogue + categories entries are the only two).
// Only touches rows it creates ("ZP489C-*", "zp489c-*").
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import { createStorefront, type CacheFn } from '../src/lib/storefront/cached'
import { loadListing, parseListingQuery } from '../src/lib/storefront/listing-query'

async function cleanup() {
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP489C-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp489c-' } } })
}

function recordingCache() {
  const keys = new Set<string>()
  const cache: CacheFn = (fn, keyParts) =>
    (async (...args: unknown[]) => {
      keys.add(JSON.stringify([keyParts, args]))
      return fn(...(args as []))
    }) as unknown as typeof fn
  return { cache, keys }
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
    const rec = recordingCache()
    const sf = createStorefront({ db: prisma, cache: rec.cache })
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

    const before = rec.keys.size
    for (let i = 0; i < 50; i++) {
      await loadListing(sf, { kind: 'category', slug: `zp489c-x${i}` }, parseListingQuery({ page: String(i + 1), sort: 'newest' }), '/x')
      await loadListing(sf, { kind: 'all' }, parseListingQuery({ page: String(i + 1), soldout: 'hide' }), '/x')
    }
    assert.strictEqual(rec.keys.size, before, 'no new cache entries')
    assert.strictEqual(before, 2)
  })
})
