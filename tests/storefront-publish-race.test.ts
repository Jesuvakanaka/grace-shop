// ZP-483 review: concurrent publishProduct / ensureProductSlug on one product
// must behave like one publish: publishedAt from the first, the base slug,
// no stray redirects. Only touches rows it creates ("ZP483R-*").
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import { ensureProductSlug, publishProduct } from '../src/lib/storefront-model/db'

async function cleanup() {
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP483R-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp483r-' } } })
}

let n = 0
async function readyProduct(name: string) {
  n += 1
  const cat = await prisma.category.create({ data: { name: `zp483r cat ${n}`, slug: `zp483r-cat-${n}` } })
  const p = await prisma.product.create({ data: { itemNumber: `ZP483R-${n}`, productName: name, categoryId: cat.id } })
  await prisma.productImage.create({
    data: { productId: p.id, imageKey: `products/${'c'.repeat(32)}.webp`, isPrimary: true },
  })
  return p
}

describe('publishProduct under concurrency', () => {
  before(cleanup)
  after(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('8 parallel publishes: publishedAt of the first, the base slug, no redirects', async () => {
    const p = await readyProduct('ZP483R Race Product')
    const times = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, 10, 1, 10, 0, i)))
    const results = await Promise.all(times.map((now) => publishProduct(prisma, p.id, { publish: true, now })))
    assert.ok(results.every((r) => r.ok), JSON.stringify(results))

    const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
    assert.strictEqual(row.published, true)
    assert.strictEqual(row.slug, 'zp483r-race-product')
    const winner = results.map((r) => (r.ok ? r.publishedAt?.getTime() : null))
    assert.ok(winner.every((t) => t === row.publishedAt!.getTime()), 'every caller sees the same publishedAt')
    assert.ok(times.some((t) => t.getTime() === row.publishedAt!.getTime()))
    assert.strictEqual(await prisma.productSlugRedirect.count({ where: { productId: p.id } }), 0)
  })

  test('8 parallel ensureProductSlug calls agree on one slug', async () => {
    const p = await readyProduct('ZP483R Slug Race')
    const slugs = await Promise.all(Array.from({ length: 8 }, () => ensureProductSlug(prisma, p.id)))
    assert.deepStrictEqual(new Set(slugs), new Set(['zp483r-slug-race']))
    assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).slug, 'zp483r-slug-race')
    assert.strictEqual(await prisma.productSlugRedirect.count({ where: { productId: p.id } }), 0)
  })
})
