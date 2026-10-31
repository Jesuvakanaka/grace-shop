// ZP-484: public data layer and public image route, against DATABASE_URL.
// Only touches rows it creates (item numbers "ZP484-*", category slugs
// "zp484-*") and removes them again.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import prisma from '../src/lib/db'
import { LocalImageStorage } from '../src/lib/storage/local'
import { setProductSlug } from '../src/lib/storefront-model/db'
import {
  listPublishedProducts,
  getPublishedProductBySlug,
  listRelatedProducts,
  listPublishedCategories,
  getPublishedCategory,
  isPublicImageKey,
} from '../src/lib/storefront/queries'
import { servePublicImage } from '../src/lib/storefront/public-image'
import { ByteLruCache } from '../src/lib/storefront/resize-cache'
import sharp from 'sharp'

const HEX = (c: string) => c.repeat(32)
const KEY = (c: string) => `products/${HEX(c)}.webp`
const SRCSET = (c: string) =>
  [320, 480, 640, 828, 1080, 1200].map((w) => `/api/images/public/${HEX(c)}.webp?w=${w} ${w}w`).join(', ')
const DAY = 86_400_000
const NOW = Date.now()
const at = (days: number) => new Date(NOW - days * DAY)

async function cleanup() {
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP484-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp484-' } } })
}

let n = 0
async function product(data: Record<string, unknown>, imageKeys: string[] = []) {
  n += 1
  const p = await prisma.product.create({
    data: {
      itemNumber: `ZP484-${n}`,
      productName: `ZP484 product ${n}`,
      unitCostUsd: 7.77,
      currentQuantity: 10,
      notes: 'private note',
      ...data,
    },
  })
  for (const [i, imageKey] of imageKeys.entries()) {
    await prisma.productImage.create({ data: { productId: p.id, imageKey, isPrimary: i === 0, sortOrder: i } })
  }
  return p
}

let tmp: string
let storage: LocalImageStorage

describe('storefront public data layer (database)', () => {
  before(async () => {
    await cleanup()
    tmp = await mkdtemp(path.join(tmpdir(), 'zp484-'))
    storage = new LocalImageStorage(tmp)
    for (const c of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) await storage.put(KEY(c), Buffer.from(`webp-${c}`))

    const pub = await prisma.category.create({
      data: { slug: 'zp484-pub', name: 'ZP484 Public', published: true, sortOrder: 2, heroImageKey: KEY('8') },
    })
    const pub2 = await prisma.category.create({ data: { slug: 'zp484-pub-b', name: 'ZP484 Public B', published: true, sortOrder: 1 } })
    const hidden = await prisma.category.create({
      data: { slug: 'zp484-hidden', name: 'ZP484 Hidden', published: false, heroImageKey: KEY('9') },
    })

    // Visible in zp484-pub. Default order: p1 (featured), then sortOrder 1: p3 (newer) before p2, then p4.
    await product({ slug: 'zp484-p1', published: true, publishedAt: at(40), categoryId: pub.id, featured: true, sortOrder: 5, priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 30 }, [KEY('1'), KEY('7')])
    await product({ slug: 'zp484-p2', published: true, publishedAt: at(20), categoryId: pub.id, sortOrder: 1, priceDisplay: 'ASK_FOR_PRICE', sellingPriceUsd: 99 }, [KEY('2')])
    await product({ slug: 'zp484-p3', published: true, publishedAt: at(2), categoryId: pub.id, sortOrder: 1, priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 0, currentQuantity: 0 }, [KEY('3')])
    await product({ slug: 'zp484-p4', published: true, publishedAt: at(1), categoryId: pub.id, sortOrder: 3, currentQuantity: 2 }, [])
    await product({ slug: 'zp484-b1', published: true, publishedAt: at(1), categoryId: pub2.id })
    // Never visible.
    await product({ slug: 'zp484-unpublished', published: false, publishedAt: at(3), categoryId: pub.id }, [KEY('4'), KEY('7')])
    await product({ slug: 'zp484-hidden-cat', published: true, publishedAt: at(3), categoryId: hidden.id }, [KEY('5')])
    await product({ slug: 'zp484-no-cat', published: true, publishedAt: at(3), categoryId: null }, [KEY('6')])
  })

  after(async () => {
    await cleanup()
    await rm(tmp, { recursive: true, force: true })
    await prisma.$disconnect()
  })

  const ours = (slugs: string[]) => slugs.filter((s) => s.startsWith('zp484-'))

  describe('visibility', () => {
    test('lists only published products with a published category', async () => {
      const all = await listPublishedProducts(prisma, { pageSize: 48, page: 1 })
      // Other test data may exist; check every page for our rows.
      const seen: string[] = []
      for (let page = 1; page <= all.pageCount; page++) {
        const res = await listPublishedProducts(prisma, { pageSize: 48, page })
        seen.push(...res.items.map((p) => p.slug))
      }
      assert.deepStrictEqual(ours(seen).sort(), ['zp484-b1', 'zp484-p1', 'zp484-p2', 'zp484-p3', 'zp484-p4'])
    })

    test('category filter; an unpublished category gives nothing', async () => {
      const res = await listPublishedProducts(prisma, { categorySlug: 'zp484-pub' })
      assert.deepStrictEqual(res.items.map((p) => p.slug), ['zp484-p1', 'zp484-p3', 'zp484-p2', 'zp484-p4'])
      assert.strictEqual((await listPublishedProducts(prisma, { categorySlug: 'zp484-hidden' })).total, 0)
      assert.strictEqual((await listPublishedProducts(prisma, { categorySlug: 'zp484-nope' })).total, 0)
    })

    test('getPublishedProductBySlug hides unpublished, hidden-category and no-category products', async () => {
      assert.ok(await getPublishedProductBySlug(prisma, 'zp484-p1'))
      for (const slug of ['zp484-unpublished', 'zp484-hidden-cat', 'zp484-no-cat']) {
        assert.strictEqual(await getPublishedProductBySlug(prisma, slug), null, slug)
      }
    })

    test('categories: only published ones, in sortOrder', async () => {
      const cats = await listPublishedCategories(prisma)
      assert.deepStrictEqual(ours(cats.map((c) => c.slug)), ['zp484-pub-b', 'zp484-pub'])
      assert.strictEqual(await getPublishedCategory(prisma, 'zp484-hidden'), null)
      assert.strictEqual(await getPublishedCategory(prisma, 'zp484-nope'), null)
      const pub = await getPublishedCategory(prisma, 'zp484-pub')
      assert.deepStrictEqual(pub, {
        slug: 'zp484-pub',
        name: 'ZP484 Public',
        description: null,
        heroImage: { url: `/api/images/public/${HEX('8')}.webp`, alt: 'ZP484 Public', srcSet: SRCSET('8'), width: null, height: null },
      })
    })

    test('filters: newOnly, featuredOnly, hideSoldOut', async () => {
      const slugs = async (o: Parameters<typeof listPublishedProducts>[1]) =>
        (await listPublishedProducts(prisma, { categorySlug: 'zp484-pub', ...o })).items.map((p) => p.slug)
      assert.deepStrictEqual(await slugs({ newOnly: true }), ['zp484-p3', 'zp484-p2', 'zp484-p4'])
      assert.deepStrictEqual(await slugs({ featuredOnly: true }), ['zp484-p1'])
      assert.deepStrictEqual(await slugs({ hideSoldOut: true }), ['zp484-p1', 'zp484-p2', 'zp484-p4'])
    })
  })

  describe('DTO from the database', () => {
    test('allow-listed fields only; price and availability rules', async () => {
      const res = await getPublishedProductBySlug(prisma, 'zp484-p1')
      assert.ok(res && 'product' in res)
      const p = res.product
      assert.strictEqual(p.priceUsd, 30)
      assert.strictEqual(p.availability, 'IN_STOCK')
      assert.strictEqual(p.isNew, false)
      assert.deepStrictEqual(p.category, { slug: 'zp484-pub', name: 'ZP484 Public' })
      assert.deepStrictEqual(p.images.map((i) => i.url), [`/api/images/public/${HEX('1')}.webp`, `/api/images/public/${HEX('7')}.webp`])
      const json = JSON.stringify(p)
      assert.ok(!json.includes('7.77') && !json.includes('private note') && !json.includes('ZP484-'))

      const p2 = (await getPublishedProductBySlug(prisma, 'zp484-p2')) as { product: { priceUsd: number | null } }
      assert.strictEqual(p2.product.priceUsd, null, 'ASK_FOR_PRICE')
      const p3 = (await getPublishedProductBySlug(prisma, 'zp484-p3')) as { product: { priceUsd: number | null; availability: string; isNew: boolean } }
      assert.strictEqual(p3.product.priceUsd, null, 'SHOW_PRICE with 0')
      assert.strictEqual(p3.product.availability, 'SOLD_OUT')
      assert.strictEqual(p3.product.isNew, true)
      const p4 = (await getPublishedProductBySlug(prisma, 'zp484-p4', { fewLeftThreshold: 3 })) as { product: { availability: string } }
      assert.strictEqual(p4.product.availability, 'FEW_LEFT')
      const p4b = (await getPublishedProductBySlug(prisma, 'zp484-p4', { fewLeftThreshold: 1 })) as { product: { availability: string } }
      assert.strictEqual(p4b.product.availability, 'IN_STOCK')
    })

    test('itemNumber only with the opt-in flag', async () => {
      const off = (await getPublishedProductBySlug(prisma, 'zp484-p1')) as { product: object }
      assert.ok(!('itemNumber' in off.product))
      const on = (await getPublishedProductBySlug(prisma, 'zp484-p1', { includeItemNumber: true })) as { product: { itemNumber?: string } }
      assert.match(on.product.itemNumber ?? '', /^ZP484-/)
    })
  })

  describe('slugs', () => {
    test('an old slug returns redirectTo; an unknown or invalid slug returns null', async () => {
      const p = await prisma.product.findUniqueOrThrow({ where: { slug: 'zp484-p2' } })
      assert.deepStrictEqual(await setProductSlug(prisma, p.id, 'zp484-p2-renamed'), { ok: true, slug: 'zp484-p2-renamed' })
      try {
        assert.deepStrictEqual(await getPublishedProductBySlug(prisma, 'zp484-p2'), { redirectTo: 'zp484-p2-renamed' })
        const live = await getPublishedProductBySlug(prisma, 'zp484-p2-renamed')
        assert.ok(live && 'product' in live && live.product.slug === 'zp484-p2-renamed')
        assert.strictEqual(await getPublishedProductBySlug(prisma, 'zp484-does-not-exist'), null)
        assert.strictEqual(await getPublishedProductBySlug(prisma, '../etc'), null)
      } finally {
        await setProductSlug(prisma, p.id, 'zp484-p2')
      }
    })

    test('an old slug of an unpublished product does not redirect', async () => {
      const p = await prisma.product.findUniqueOrThrow({ where: { slug: 'zp484-unpublished' } })
      await setProductSlug(prisma, p.id, 'zp484-unpublished-2')
      assert.strictEqual(await getPublishedProductBySlug(prisma, 'zp484-unpublished'), null)
      assert.strictEqual(await getPublishedProductBySlug(prisma, 'zp484-unpublished-2'), null)
    })
  })

  describe('sort and pagination', () => {
    test('pages through the default order without overlap', async () => {
      const page1 = await listPublishedProducts(prisma, { categorySlug: 'zp484-pub', page: 1, pageSize: 3 })
      const page2 = await listPublishedProducts(prisma, { categorySlug: 'zp484-pub', page: 2, pageSize: 3 })
      const page3 = await listPublishedProducts(prisma, { categorySlug: 'zp484-pub', page: 3, pageSize: 3 })
      assert.deepStrictEqual(page1.items.map((p) => p.slug), ['zp484-p1', 'zp484-p3', 'zp484-p2'])
      assert.deepStrictEqual(page2.items.map((p) => p.slug), ['zp484-p4'])
      assert.deepStrictEqual(page3.items, [])
      assert.deepStrictEqual(
        { total: page1.total, page: page1.page, pageSize: page1.pageSize, pageCount: page1.pageCount },
        { total: 4, page: 1, pageSize: 3, pageCount: 2 },
      )
    })

    test('newest and price sorts', async () => {
      const slugs = async (sort: 'newest' | 'price-asc') =>
        (await listPublishedProducts(prisma, { categorySlug: 'zp484-pub', sort })).items.map((p) => p.slug)
      assert.deepStrictEqual(await slugs('newest'), ['zp484-p4', 'zp484-p3', 'zp484-p2', 'zp484-p1'])
      // Only p1 shows a price; p4 has the default ASK_FOR_PRICE.
      assert.deepStrictEqual(await slugs('price-asc'), ['zp484-p1', 'zp484-p3', 'zp484-p2', 'zp484-p4'])
    })
  })

  describe('related products', () => {
    test('same category first, never itself, sold out or hidden products', async () => {
      const related = await listRelatedProducts(prisma, 'zp484-p1', 3)
      const slugs = related.map((p) => p.slug)
      assert.strictEqual(slugs.length, 3)
      assert.deepStrictEqual(slugs.slice(0, 2), ['zp484-p2', 'zp484-p4'])
      for (const bad of ['zp484-p1', 'zp484-p3', 'zp484-unpublished', 'zp484-hidden-cat', 'zp484-no-cat']) {
        assert.ok(!slugs.includes(bad), bad)
      }
      assert.deepStrictEqual(await listRelatedProducts(prisma, 'zp484-unpublished-2', 3), [])
      assert.deepStrictEqual(await listRelatedProducts(prisma, 'zp484-nope', 3), [])
    })
  })

  describe('public images', () => {
    const get = (fileName: string, query = '') => servePublicImage(fileName, new URLSearchParams(query), { db: prisma, storage, cache: new ByteLruCache(1024 * 1024) })

    test('isPublicImageKey', async () => {
      assert.strictEqual(await isPublicImageKey(prisma, KEY('1')), true)
      assert.strictEqual(await isPublicImageKey(prisma, KEY('8')), true, 'hero of a published category')
      for (const c of ['4', '5', '6', '9']) assert.strictEqual(await isPublicImageKey(prisma, KEY(c)), false, c)
    })

    test('published product image: 200 with public cache headers', async () => {
      const res = await get(`${HEX('1')}.webp`)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('content-type'), 'image/webp')
      assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400')
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff')
      assert.strictEqual(res.headers.get('content-security-policy'), "default-src 'none'; sandbox")
      assert.strictEqual(await res.text(), 'webp-1')
    })

    test('published category hero: 200', async () => {
      assert.strictEqual((await get(`${HEX('8')}.webp`)).status, 200)
    })

    test('a key shared by a published and an unpublished product: 200', async () => {
      assert.strictEqual((await get(`${HEX('7')}.webp`)).status, 200)
    })

    test('unpublished product, hidden category, no category, hidden hero, unknown key: 404, not cached', async () => {
      for (const c of ['4', '5', '6', '9', 'f']) {
        const res = await get(`${HEX(c)}.webp`)
        assert.strictEqual(res.status, 404, c)
        assert.strictEqual(res.headers.get('cache-control'), 'no-store')
      }
    })

    test('garbage and traversal keys: 404', async () => {
      for (const name of ['../../.env', '..%2F..%2F.env', `${HEX('1')}.png`, `${'A'.repeat(32)}.webp`, `products/${HEX('1')}.webp`, '', 'x'.repeat(5000)]) {
        assert.strictEqual((await get(name)).status, 404, name.slice(0, 40))
      }
    })

    test('public in the database but the bytes are missing: 404', async () => {
      const p = await prisma.product.findUniqueOrThrow({ where: { slug: 'zp484-p4' } })
      await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('e'), isPrimary: true } })
      assert.strictEqual((await get(`${HEX('e')}.webp`)).status, 404)
    })
  })

  describe('public image sizes (?w=)', () => {
    const SIZED = 'c' // 1200x800 real WebP
    let cache: ByteLruCache
    let productId: number
    const getSized = (query: string, fileName = `${HEX(SIZED)}.webp`) =>
      servePublicImage(fileName, new URLSearchParams(query), { db: prisma, storage, cache })

    before(async () => {
      cache = new ByteLruCache(8 * 1024 * 1024)
      const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#a33' } }).webp().toBuffer()
      await storage.put(KEY(SIZED), bytes)
      const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'zp484-pub' } })
      const p = await product({ slug: 'zp484-sized', published: true, publishedAt: at(1), categoryId: cat.id }, [KEY(SIZED)])
      productId = p.id
    })

    test('an invalid width is a 400, for public and private keys alike', async () => {
      for (const q of ['w=800', 'w=abc', 'w=', 'w=640&w=320', 'w=640&q=75', 'foo=1']) {
        const res = await getSized(q)
        assert.strictEqual(res.status, 400, q)
        assert.strictEqual(res.headers.get('cache-control'), 'no-store')
      }
      assert.strictEqual((await getSized('w=800', `${HEX('4')}.webp`)).status, 400)
    })

    test('a resized response is WebP and narrower than the original', async () => {
      const original = Buffer.from(await (await getSized('')).arrayBuffer())
      assert.strictEqual((await sharp(original).metadata()).width, 1200)

      const res = await getSized('w=640')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('content-type'), 'image/webp')
      assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400')
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff')
      assert.strictEqual(res.headers.get('content-security-policy'), "default-src 'none'; sandbox")
      const resized = Buffer.from(await res.arrayBuffer())
      assert.strictEqual(res.headers.get('content-length'), String(resized.length))
      const meta = await sharp(resized).metadata()
      assert.strictEqual(meta.format, 'webp')
      assert.strictEqual(meta.width, 640)
      assert.strictEqual(meta.height, 427)
      assert.ok(resized.length < original.length)
    })

    test('never upscales: w=1600 on a 1200px picture is 1200px', async () => {
      const res = await getSized('w=1600')
      assert.strictEqual(res.status, 200)
      assert.strictEqual((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width, 1200)
    })

    test('the resized bytes are cached', async () => {
      assert.ok(cache.size >= 2)
      const before = cache.size
      await getSized('w=640')
      assert.strictEqual(cache.size, before)
    })

    test('unpublished after a size was cached: that size is a 404, the cache is not consulted first', async () => {
      assert.ok(cache.has(`${KEY(SIZED)}|640`), 'w=640 was cached while published')
      await prisma.product.update({ where: { id: productId }, data: { published: false } })
      try {
        for (const q of ['w=640', 'w=1600', 'w=320', '']) {
          const res = await getSized(q)
          assert.strictEqual(res.status, 404, q)
          assert.strictEqual(res.headers.get('cache-control'), 'no-store')
        }
      } finally {
        await prisma.product.update({ where: { id: productId }, data: { published: true } })
      }
      assert.strictEqual((await getSized('w=640')).status, 200, 'republished: served again')
    })

    test('a picture that cannot be decoded gives a 500, not the bytes', async () => {
      const res = await getSized('w=640', `${HEX('1')}.webp`) // stored bytes are "webp-1"
      assert.strictEqual(res.status, 500)
      assert.strictEqual(res.headers.get('cache-control'), 'no-store')
    })
  })
})
