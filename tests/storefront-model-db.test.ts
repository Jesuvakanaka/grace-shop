// ZP-482: Prisma helpers of the storefront data model, against DATABASE_URL.
// Only touches rows it creates (item numbers "ZP482-*", category slugs
// "zp482-*") and removes them again, so it can run after business-rules.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import prisma from '../src/lib/db'
import {
  setProductSlug,
  ensureProductSlug,
  resolveProductSlug,
  syncGalleryFromImageUrl,
  setPrimaryImage,
  ensurePrimaryImage,
  getGallery,
  publishProduct,
} from '../src/lib/storefront-model/db'

const KEY = (c: string) => `products/${c.repeat(32)}.webp`
const URL_ = (c: string) => `/api/images/${c.repeat(32)}.webp`

async function cleanup() {
  await prisma.stockMovement.deleteMany({ where: { product: { itemNumber: { startsWith: 'ZP482-' } } } })
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP482-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp482-' } } })
}

let n = 0
async function product(data: Record<string, unknown> = {}) {
  n += 1
  return prisma.product.create({ data: { itemNumber: `ZP482-${n}`, productName: `Test product ${n}`, ...data } })
}

describe('storefront-model db helpers', () => {
  before(cleanup)
  after(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  describe('new Product columns', () => {
    test('defaults: unpublished, ask for price, not featured, no slug', async () => {
      const p = await product()
      assert.strictEqual(p.published, false)
      assert.strictEqual(p.priceDisplay, 'ASK_FOR_PRICE')
      assert.strictEqual(p.featured, false)
      assert.strictEqual(p.sortOrder, 0)
      assert.strictEqual(p.slug, null)
      assert.strictEqual(p.publishedAt, null)
      assert.strictEqual(p.categoryId, null)
    })
  })

  describe('slugs and redirects', () => {
    test('first slug, rename with redirect, resolve old slug, rename back without a loop', async () => {
      const p = await product()
      assert.deepStrictEqual(await setProductSlug(prisma, p.id, 'zp482 Silk Dress'), { ok: true, slug: 'zp482-silk-dress' })
      assert.strictEqual(await prisma.productSlugRedirect.count({ where: { productId: p.id } }), 0)

      assert.deepStrictEqual(await setProductSlug(prisma, p.id, 'zp482-silk-wrap-dress'), {
        ok: true,
        slug: 'zp482-silk-wrap-dress',
      })
      assert.deepStrictEqual(await resolveProductSlug(prisma, 'zp482-silk-dress'), {
        productId: p.id,
        slug: 'zp482-silk-wrap-dress',
        redirected: true,
      })
      assert.deepStrictEqual(await resolveProductSlug(prisma, 'zp482-silk-wrap-dress'), {
        productId: p.id,
        slug: 'zp482-silk-wrap-dress',
        redirected: false,
      })

      // back to the first slug: its redirect goes away, the other one is added
      await setProductSlug(prisma, p.id, 'zp482-silk-dress')
      const redirects = await prisma.productSlugRedirect.findMany({ where: { productId: p.id }, orderBy: { oldSlug: 'asc' } })
      assert.deepStrictEqual(redirects.map((r) => r.oldSlug), ['zp482-silk-wrap-dress'])
      assert.deepStrictEqual(await resolveProductSlug(prisma, 'zp482-silk-dress'), {
        productId: p.id,
        slug: 'zp482-silk-dress',
        redirected: false,
      })
      assert.strictEqual(await resolveProductSlug(prisma, 'zp482-nothing-here'), null)
    })

    test('a slug used by another product, live or as a redirect, is refused', async () => {
      const a = await product()
      const b = await product()
      await setProductSlug(prisma, a.id, 'zp482-a-old')
      await setProductSlug(prisma, a.id, 'zp482-a')
      const live = await setProductSlug(prisma, b.id, 'zp482-a')
      assert.strictEqual(live.ok, false)
      const redirected = await setProductSlug(prisma, b.id, 'zp482-a-old')
      assert.strictEqual(redirected.ok, false)
      assert.strictEqual((await prisma.product.findUnique({ where: { id: b.id } }))!.slug, null)
    })

    test('setting the same slug twice does nothing', async () => {
      const p = await product()
      await setProductSlug(prisma, p.id, 'zp482-same')
      assert.deepStrictEqual(await setProductSlug(prisma, p.id, 'zp482-same'), { ok: true, slug: 'zp482-same' })
      assert.strictEqual(await prisma.productSlugRedirect.count({ where: { productId: p.id } }), 0)
    })

    test('ensureProductSlug generates a unique slug from the display name and keeps an existing one', async () => {
      const a = await product({ publicName: 'zp482 Gold Hoops' })
      const b = await product({ productName: 'ITEM', publicName: 'zp482 Gold Hoops' })
      const c = await product({ publicName: 'zp482 Gold Hoops' })
      assert.strictEqual(await ensureProductSlug(prisma, a.id), 'zp482-gold-hoops')
      // a's old slug becomes a redirect; it must not be handed to b
      await setProductSlug(prisma, a.id, 'zp482-gold-hoops-earrings')
      assert.strictEqual(await ensureProductSlug(prisma, b.id), 'zp482-gold-hoops-2')
      assert.strictEqual(await ensureProductSlug(prisma, c.id), 'zp482-gold-hoops-3')
      assert.strictEqual(await ensureProductSlug(prisma, c.id), 'zp482-gold-hoops-3')
    })

    test('an unknown product is refused', async () => {
      const r = await setProductSlug(prisma, 99_999_999, 'zp482-x')
      assert.strictEqual(r.ok, false)
    })
  })

  describe('gallery and the admin primary image (Product.imageUrl)', () => {
    test('setting imageUrl creates the primary image; replacing it swaps the primary row', async () => {
      const p = await product({ imageUrl: URL_('a') })
      await syncGalleryFromImageUrl(prisma, p.id, URL_('a'))
      let gallery = await getGallery(prisma, p.id)
      assert.deepStrictEqual(gallery.map((g) => [g.imageKey, g.isPrimary]), [[KEY('a'), true]])

      // re-sync is idempotent
      await syncGalleryFromImageUrl(prisma, p.id, URL_('a'))
      assert.strictEqual(await prisma.productImage.count({ where: { productId: p.id } }), 1)

      // a non-primary gallery image is kept when the admin replaces the picture
      await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('b'), sortOrder: 5 } })
      await prisma.product.update({ where: { id: p.id }, data: { imageUrl: URL_('c') } })
      await syncGalleryFromImageUrl(prisma, p.id, URL_('c'))
      gallery = await getGallery(prisma, p.id)
      assert.deepStrictEqual(gallery.map((g) => [g.imageKey, g.isPrimary]), [
        [KEY('c'), true],
        [KEY('b'), false],
      ])
    })

    test('picking an existing gallery image as the new imageUrl promotes it', async () => {
      const p = await product({ imageUrl: URL_('a') })
      await syncGalleryFromImageUrl(prisma, p.id, URL_('a'))
      await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('b'), sortOrder: 1 } })
      await syncGalleryFromImageUrl(prisma, p.id, URL_('b'))
      const gallery = await getGallery(prisma, p.id)
      assert.deepStrictEqual(gallery.map((g) => [g.imageKey, g.isPrimary]), [[KEY('b'), true]])
    })

    test('clearing imageUrl removes the primary row and promotes the next image into imageUrl', async () => {
      const p = await product({ imageUrl: URL_('a') })
      await syncGalleryFromImageUrl(prisma, p.id, URL_('a'))
      await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('d'), sortOrder: 2 } })
      await prisma.product.update({ where: { id: p.id }, data: { imageUrl: null } })
      await syncGalleryFromImageUrl(prisma, p.id, null)
      const gallery = await getGallery(prisma, p.id)
      assert.deepStrictEqual(gallery.map((g) => [g.imageKey, g.isPrimary]), [[KEY('d'), true]])
      assert.strictEqual((await prisma.product.findUnique({ where: { id: p.id } }))!.imageUrl, URL_('d'))

      // clearing the last one leaves no images and no imageUrl
      await syncGalleryFromImageUrl(prisma, p.id, null)
      assert.strictEqual(await prisma.productImage.count({ where: { productId: p.id } }), 0)
      assert.strictEqual((await prisma.product.findUnique({ where: { id: p.id } }))!.imageUrl, null)
    })

    test('an imageUrl that is not a stored picture is an explicit error and changes nothing', async () => {
      const p = await product({ imageUrl: URL_('a') })
      await syncGalleryFromImageUrl(prisma, p.id, URL_('a'))
      const r = await syncGalleryFromImageUrl(prisma, p.id, 'https://example.test/x.jpg')
      assert.strictEqual(r.ok, false)
      assert.strictEqual(r.changed, false)
      if (!r.ok) assert.match(r.error, /not a stored picture/i)
      assert.deepStrictEqual(
        (await getGallery(prisma, p.id)).map((g) => [g.imageKey, g.isPrimary]),
        [[KEY('a'), true]],
      )
    })

    test('undefined (imageUrl not part of the update) is a no-op; only null or "" clears', async () => {
      const p = await product({ imageUrl: URL_('a') })
      await syncGalleryFromImageUrl(prisma, p.id, URL_('a'))
      const r = await syncGalleryFromImageUrl(prisma, p.id, undefined)
      assert.deepStrictEqual(r, { ok: true, changed: false, primaryImageId: null })
      assert.strictEqual(await prisma.productImage.count({ where: { productId: p.id, isPrimary: true } }), 1)
      assert.strictEqual((await prisma.product.findUnique({ where: { id: p.id } }))!.imageUrl, URL_('a'))

      const cleared = await syncGalleryFromImageUrl(prisma, p.id, '')
      assert.strictEqual(cleared.ok && cleared.changed, true)
      assert.strictEqual(await prisma.productImage.count({ where: { productId: p.id } }), 0)
    })

    test('re-syncing the same imageUrl reports no change', async () => {
      const p = await product({ imageUrl: URL_('a') })
      const first = await syncGalleryFromImageUrl(prisma, p.id, URL_('a'))
      assert.strictEqual(first.ok && first.changed, true)
      const again = await syncGalleryFromImageUrl(prisma, p.id, URL_('a'))
      assert.deepStrictEqual(again, { ok: true, changed: false, primaryImageId: first.ok ? first.primaryImageId : -1 })
    })

    test('setPrimaryImage switches the primary and writes it back to Product.imageUrl', async () => {
      const p = await product({ imageUrl: URL_('a') })
      await syncGalleryFromImageUrl(prisma, p.id, URL_('a'))
      const b = await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('b'), sortOrder: 1 } })
      await setPrimaryImage(prisma, p.id, b.id)
      const gallery = await getGallery(prisma, p.id)
      assert.deepStrictEqual(gallery.map((g) => [g.imageKey, g.isPrimary]), [
        [KEY('b'), true],
        [KEY('a'), false],
      ])
      assert.strictEqual((await prisma.product.findUnique({ where: { id: p.id } }))!.imageUrl, URL_('b'))

      const other = await product()
      await assert.rejects(() => setPrimaryImage(prisma, other.id, b.id), /not found/i)
    })

    test('ensurePrimaryImage backfills from imageUrl and repairs a gallery without a primary', async () => {
      const p = await product({ imageUrl: URL_('e') })
      await ensurePrimaryImage(prisma, p.id)
      await ensurePrimaryImage(prisma, p.id)
      assert.deepStrictEqual(
        (await getGallery(prisma, p.id)).map((g) => [g.imageKey, g.isPrimary]),
        [[KEY('e'), true]],
      )

      const q = await product()
      await prisma.productImage.createMany({
        data: [
          { productId: q.id, imageKey: KEY('f'), sortOrder: 2 },
          { productId: q.id, imageKey: KEY('1'), sortOrder: 1 },
        ],
      })
      await ensurePrimaryImage(prisma, q.id)
      assert.deepStrictEqual(
        (await getGallery(prisma, q.id)).map((g) => [g.imageKey, g.isPrimary]),
        [
          [KEY('1'), true],
          [KEY('f'), false],
        ],
      )
      assert.strictEqual((await prisma.product.findUnique({ where: { id: q.id } }))!.imageUrl, URL_('1'))
    })

    test('the database allows at most one primary image per product', async () => {
      const p = await product()
      await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('a'), isPrimary: true } })
      await assert.rejects(() =>
        prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('b'), isPrimary: true } }),
      )
      await assert.rejects(() => prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('a') } }))
    })
  })

  describe('publishProduct', () => {
    async function readyProduct(data: Record<string, unknown> = {}) {
      const cat = await prisma.category.create({ data: { name: 'Pub', slug: `zp482-pub-${n + 1}` } })
      const p = await product({ publicName: `zp482 Pub ${n + 1}`, imageUrl: URL_('a'), categoryId: cat.id, ...data })
      await ensurePrimaryImage(prisma, p.id)
      return p
    }

    test('refuses a product that is not ready and writes nothing (no slug either)', async () => {
      const p = await product({ publicName: 'zp482 Not Ready' })
      const r = await publishProduct(prisma, p.id, { publish: true })
      assert.deepStrictEqual(r, { ok: false, missing: ['image', 'category'] })
      const after = (await prisma.product.findUnique({ where: { id: p.id } }))!
      assert.strictEqual(after.published, false)
      assert.strictEqual(after.slug, null)
      assert.strictEqual(after.publishedAt, null)
    })

    test('publishes a ready product: ensures a slug and sets publishedAt on the first publish only', async () => {
      const p = await readyProduct()
      const first = new Date('2026-10-01T00:00:00Z')
      const r = await publishProduct(prisma, p.id, { publish: true, now: first })
      assert.ok(r.ok, JSON.stringify(r))
      if (r.ok) {
        assert.strictEqual(r.published, true)
        assert.match(r.slug ?? '', /^zp482-pub-\d+$/)
        assert.deepStrictEqual(r.publishedAt, first)
      }

      const off = await publishProduct(prisma, p.id, { publish: false, now: new Date('2026-10-05T00:00:00Z') })
      assert.ok(off.ok && off.published === false && off.publishedAt?.getTime() === first.getTime())

      const again = await publishProduct(prisma, p.id, { publish: true, now: new Date('2026-10-20T00:00:00Z') })
      assert.ok(again.ok && again.published && again.publishedAt?.getTime() === first.getTime())
      const row = (await prisma.product.findUnique({ where: { id: p.id } }))!
      assert.strictEqual(row.published, true)
      assert.strictEqual(row.publishedAt?.getTime(), first.getTime())
    })

    test('keeps an existing slug', async () => {
      const p = await readyProduct()
      await setProductSlug(prisma, p.id, 'zp482-chosen')
      const r = await publishProduct(prisma, p.id, { publish: true })
      assert.ok(r.ok && r.slug === 'zp482-chosen')
    })

    test('unpublishing needs no readiness', async () => {
      const p = await product()
      const r = await publishProduct(prisma, p.id, { publish: false })
      assert.deepStrictEqual(r, { ok: true, published: false, publishedAt: null, slug: null })
    })

    test('an unknown product is refused', async () => {
      await assert.rejects(() => publishProduct(prisma, 99_999_999, { publish: true }), /not found/i)
    })
  })

  describe('generated slugs: reserved words and concurrent writers', () => {
    test('a product called "New" gets new-2, never the reserved "new"', async () => {
      // Use a unique root first so this test does not depend on other rows.
      const p = await product({ publicName: 'New' })
      const slug = await ensureProductSlug(prisma, p.id)
      assert.notStrictEqual(slug, 'new')
      assert.match(slug, /^new-\d+$/)
    })

    test('concurrent ensureProductSlug calls for the same name all succeed with distinct slugs', async () => {
      const ps = await Promise.all([1, 2, 3].map(() => product({ publicName: 'zp482 Race Dress' })))
      const slugs = await Promise.all(ps.map((p) => ensureProductSlug(prisma, p.id)))
      assert.deepStrictEqual([...slugs].sort(), ['zp482-race-dress', 'zp482-race-dress-2', 'zp482-race-dress-3'])
    })

    test('concurrent publishProduct calls for the same name all succeed', async () => {
      const cat = await prisma.category.create({ data: { name: 'Race', slug: 'zp482-race-cat' } })
      const ps = await Promise.all(
        [1, 2, 3].map(() => product({ publicName: 'zp482 Race Top', imageUrl: URL_('a'), categoryId: cat.id })),
      )
      for (const p of ps) await ensurePrimaryImage(prisma, p.id)
      const results = await Promise.all(ps.map((p) => publishProduct(prisma, p.id, { publish: true })))
      assert.ok(results.every((r) => r.ok), JSON.stringify(results))
      assert.deepStrictEqual(results.map((r) => (r.ok ? r.slug : '')).sort(), [
        'zp482-race-top',
        'zp482-race-top-2',
        'zp482-race-top-3',
      ])
    })
  })

  describe('delete rules', () => {
    test('deleting a product removes its images and slug redirects', async () => {
      const p = await product({ imageUrl: URL_('a') })
      await ensurePrimaryImage(prisma, p.id)
      await setProductSlug(prisma, p.id, 'zp482-del-old')
      await setProductSlug(prisma, p.id, 'zp482-del')
      await prisma.product.delete({ where: { id: p.id } })
      assert.strictEqual(await prisma.productImage.count({ where: { productId: p.id } }), 0)
      assert.strictEqual(await prisma.productSlugRedirect.count({ where: { productId: p.id } }), 0)
    })

    test('a product with stock movements still cannot be deleted (unchanged)', async () => {
      const p = await product()
      await prisma.stockMovement.create({ data: { productId: p.id, movementDate: new Date(), movementType: 'ADJUSTMENT', quantity: 1 } })
      await assert.rejects(() => prisma.product.delete({ where: { id: p.id } }))
    })

    test('a category in use cannot be deleted; an unused one can', async () => {
      const cat = await prisma.category.create({ data: { name: 'Dresses', slug: 'zp482-dresses' } })
      assert.strictEqual(cat.published, false)
      assert.strictEqual(cat.sortOrder, 0)
      const p = await product({ categoryId: cat.id })
      await assert.rejects(() => prisma.category.delete({ where: { id: cat.id } }))
      await prisma.product.update({ where: { id: p.id }, data: { categoryId: null } })
      await prisma.category.delete({ where: { id: cat.id } })
    })
  })
})
