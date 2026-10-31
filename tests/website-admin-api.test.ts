/* eslint-disable @typescript-eslint/no-explicit-any -- JSON response bodies in assertions */
// ZP-483: admin "Website" API routes, called directly as the OWNER against
// DATABASE_URL. Only touches rows it creates (item numbers "ZP483-*",
// category slugs "zp483-*") and removes them again.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.JWT_SECRET = 'zp483-website-api-tests-secret-0123456789abcdef'
const IMAGE_DIR = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'zp483-images-'))
process.env.GRACE_IMAGE_STORAGE = 'local'
process.env.GRACE_IMAGE_DIR = IMAGE_DIR

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import { getImageStorage } from '../src/lib/storage/images'
import * as websiteProduct from '../src/app/api/website/products/[id]/route'
import * as websiteProducts from '../src/app/api/website/products/route'
import * as publishRoute from '../src/app/api/website/products/[id]/publish/route'
import * as bulkRoute from '../src/app/api/website/products/bulk/route'
import * as imagesRoute from '../src/app/api/website/products/[id]/images/route'
import * as imageRoute from '../src/app/api/website/products/[id]/images/[imageId]/route'
import * as previewRoute from '../src/app/api/website/products/[id]/preview-token/route'
import * as categoriesRoute from '../src/app/api/website/categories/route'
import * as categoryRoute from '../src/app/api/website/categories/[id]/route'
import * as productById from '../src/app/api/products/[id]/route'
import * as productsRoute from '../src/app/api/products/route'
import { verifyPreviewToken } from '../src/lib/website/preview-token'

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
const h = (fn: unknown) => fn as Handler

const HEX = (c: string) => c.repeat(32)
const KEY = (c: string) => `products/${HEX(c)}.webp`
const URL_ = (c: string) => `/api/images/${HEX(c)}.webp`

let ownerToken = ''

async function call(
  fn: unknown,
  method: string,
  params: Record<string, string> = {},
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', cookie: `auth-token=${ownerToken}` } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await h(fn)(new Request('http://localhost/api/test', init), { params: Promise.resolve(params) })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

async function cleanup() {
  await prisma.stockMovement.deleteMany({ where: { product: { itemNumber: { startsWith: 'ZP483-' } } } })
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'ZP483-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp483-' } } })
}

let n = 0
async function product(data: Record<string, unknown> = {}) {
  n += 1
  return prisma.product.create({
    data: { itemNumber: `ZP483-${n}`, productName: `ZP483 product ${n}`, sellingPriceUsd: 25, ...data },
  })
}
async function category(name = `zp483 cat ${++n}`) {
  return prisma.category.create({ data: { name, slug: `zp483-cat-${n}` } })
}
/** A product with a category and a primary gallery image: ready to publish. */
async function readyProduct(letter: string) {
  const cat = await category()
  const p = await product({ categoryId: cat.id, imageUrl: URL_(letter) })
  await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY(letter), isPrimary: true } })
  return p
}
async function stored(letter: string) {
  await getImageStorage().put(KEY(letter), Buffer.from('fake-webp'), 'image/webp')
}

describe('admin website API (ZP-483)', () => {
  before(async () => {
    ownerToken = await createToken(900483, 'zp483-owner', 'OWNER')
    await cleanup()
  })
  after(async () => {
    await cleanup()
    await prisma.$disconnect()
    fs.rmSync(IMAGE_DIR, { recursive: true, force: true })
  })

  describe('publish', () => {
    test('a product that is not ready returns 422 with what is missing and writes nothing', async () => {
      const p = await product()
      const before = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      const res = await call(publishRoute.POST, 'POST', { id: String(p.id) }, { publish: true })
      assert.strictEqual(res.status, 422)
      assert.deepStrictEqual(res.json.missing, ['image', 'category'])
      assert.match(res.json.error, /photo/i)
      const afterRow = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      assert.strictEqual(afterRow.published, false)
      assert.strictEqual(afterRow.publishedAt, null)
      assert.strictEqual(afterRow.slug, null)
      assert.strictEqual(afterRow.updatedAt.getTime(), before.updatedAt.getTime())
    })

    test('a ready product is published with a slug and publishedAt; unpublish keeps them', async () => {
      const p = await readyProduct('a')
      const res = await call(publishRoute.POST, 'POST', { id: String(p.id) }, { publish: true })
      assert.strictEqual(res.status, 200, JSON.stringify(res.json))
      assert.strictEqual(res.json.published, true)
      assert.ok(res.json.slug)
      const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      assert.strictEqual(row.published, true)
      assert.ok(row.publishedAt)

      const off = await call(publishRoute.POST, 'POST', { id: String(p.id) }, { publish: false })
      assert.strictEqual(off.status, 200)
      const row2 = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      assert.strictEqual(row2.published, false)
      assert.strictEqual(row2.publishedAt?.getTime(), row.publishedAt!.getTime())
    })

    test('publish needs a boolean and an existing product', async () => {
      const p = await readyProduct('b')
      assert.strictEqual((await call(publishRoute.POST, 'POST', { id: String(p.id) }, { publish: 'yes' })).status, 400)
      assert.strictEqual((await call(publishRoute.POST, 'POST', { id: String(p.id) }, {})).status, 400)
      assert.strictEqual((await call(publishRoute.POST, 'POST', { id: '987654321' }, { publish: true })).status, 404)
      assert.strictEqual((await call(publishRoute.POST, 'POST', { id: 'abc' }, { publish: true })).status, 400)
    })

    test('PATCH never accepts published or publishedAt from the client', async () => {
      const p = await readyProduct('c')
      for (const body of [{ published: true }, { publishedAt: '2020-01-01T00:00:00Z' }, { slug: 'x', published: true }]) {
        const res = await call(websiteProduct.PATCH, 'PATCH', { id: String(p.id) }, body)
        assert.strictEqual(res.status, 400, JSON.stringify(body))
      }
      // Prototype keys are just unknown fields, with a readable message.
      for (const raw of ['{"__proto__":{"x":1}}', '{"constructor":"x"}', '{"toString":"x"}']) {
        const res = await h(websiteProduct.PATCH)(
          new Request('http://localhost/api/test', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', cookie: `auth-token=${ownerToken}` },
            body: raw,
          }),
          { params: Promise.resolve({ id: String(p.id) }) },
        )
        assert.strictEqual(res.status, 400, raw)
        assert.match((await res.json()).error, /^Unknown field "/, raw)
      }
      const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      assert.strictEqual(row.published, false)
      assert.strictEqual(row.publishedAt, null)
      assert.strictEqual(row.slug, null)
    })
  })

  describe('bulk', () => {
    test('bulk publish with mixed readiness reports per-product failures with their missing items', async () => {
      const ready1 = await readyProduct('d')
      const ready2 = await readyProduct('e')
      const notReady = await product()
      const res = await call(bulkRoute.POST, 'POST', {}, { action: 'publish', ids: [ready1.id, notReady.id, ready2.id, 987654321] })
      assert.strictEqual(res.status, 200, JSON.stringify(res.json))
      const byId = new Map(res.json.results.map((r: any) => [r.id, r]))
      assert.strictEqual((byId.get(ready1.id) as any).ok, true)
      assert.strictEqual((byId.get(ready2.id) as any).ok, true)
      assert.deepStrictEqual(byId.get(notReady.id), { id: notReady.id, ok: false, missing: ['image', 'category'] })
      assert.deepStrictEqual(byId.get(987654321), { id: 987654321, ok: false, error: 'Product not found' })
      assert.strictEqual(res.json.succeeded, 2)
      assert.strictEqual(res.json.failed, 2)
      const rows = await prisma.product.findMany({ where: { id: { in: [ready1.id, ready2.id, notReady.id] } } })
      assert.deepStrictEqual(
        Object.fromEntries(rows.map((r) => [r.id, r.published])),
        { [ready1.id]: true, [ready2.id]: true, [notReady.id]: false },
      )

      const off = await call(bulkRoute.POST, 'POST', {}, { action: 'unpublish', ids: [ready1.id, ready2.id] })
      assert.strictEqual(off.json.succeeded, 2)
      assert.strictEqual(await prisma.product.count({ where: { id: { in: [ready1.id, ready2.id] }, published: true } }), 0)
    })

    test('bulk set category, and input is validated', async () => {
      const cat = await category()
      const a = await product()
      const b = await product()
      const res = await call(bulkRoute.POST, 'POST', {}, { action: 'set-category', ids: [a.id, b.id], categoryId: cat.id })
      assert.strictEqual(res.status, 200, JSON.stringify(res.json))
      assert.strictEqual(res.json.updated, 2)
      assert.strictEqual(await prisma.product.count({ where: { id: { in: [a.id, b.id] }, categoryId: cat.id } }), 2)

      const cases: [unknown, number][] = [
        [{ action: 'set-category', ids: [a.id], categoryId: 987654321 }, 404],
        [{ action: 'set-category', ids: [a.id] }, 400],
        [{ action: 'delete', ids: [a.id] }, 400],
        [{ action: 'publish', ids: [] }, 400],
        [{ action: 'publish', ids: ['1'] }, 400],
        [{ action: 'publish', ids: Array.from({ length: 501 }, (_, i) => i + 1) }, 400],
      ]
      for (const [body, expected] of cases) {
        assert.strictEqual((await call(bulkRoute.POST, 'POST', {}, body)).status, expected, JSON.stringify(body).slice(0, 60))
      }
    })
  })

  describe('website fields and slug', () => {
    test('saves allow-listed fields and rejects unknown or invalid ones', async () => {
      const cat = await category()
      const p = await product()
      const res = await call(websiteProduct.PATCH, 'PATCH', { id: String(p.id) }, {
        publicName: '  ZP483 Gold Evening Dress ',
        publicDescription: 'Silk. Fits true to size.',
        categoryId: cat.id,
        priceDisplay: 'SHOW_PRICE',
        colours: 'gold',
        sizes: 'S-XL',
        featured: true,
      })
      assert.strictEqual(res.status, 200, JSON.stringify(res.json))
      const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      assert.strictEqual(row.publicName, 'ZP483 Gold Evening Dress')
      assert.strictEqual(row.categoryId, cat.id)
      assert.strictEqual(row.priceDisplay, 'SHOW_PRICE')
      assert.strictEqual(row.featured, true)

      for (const body of [
        { unitCostRmb: 1 },
        { sellingPriceUsd: 99 },
        { priceDisplay: 'FREE' },
        { featured: 'yes' },
        { categoryId: 987654321 },
        { publicName: 'x'.repeat(121) },
        { publicDescription: 'x'.repeat(2001) },
      ]) {
        const bad = await call(websiteProduct.PATCH, 'PATCH', { id: String(p.id) }, body)
        assert.ok([400, 404].includes(bad.status), `${JSON.stringify(body).slice(0, 40)} -> ${bad.status}`)
      }
      const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      assert.strictEqual(unchanged.sellingPriceUsd, 25)
      assert.strictEqual(unchanged.categoryId, cat.id)
    })

    test('a reserved slug or one used by another product is refused inline, and nothing else is saved', async () => {
      const other = await product()
      await call(websiteProduct.PATCH, 'PATCH', { id: String(other.id) }, { slug: 'zp483-taken' })
      const p = await product()

      const reserved = await call(websiteProduct.PATCH, 'PATCH', { id: String(p.id) }, { slug: 'preview', publicName: 'ZP483 Should not save' })
      assert.strictEqual(reserved.status, 400)
      assert.strictEqual(reserved.json.field, 'slug')
      assert.match(reserved.json.error, /reserved/)

      const dup = await call(websiteProduct.PATCH, 'PATCH', { id: String(p.id) }, { slug: 'ZP483 Taken' })
      assert.strictEqual(dup.status, 400)
      assert.strictEqual(dup.json.field, 'slug')
      assert.match(dup.json.error, /already used/)

      const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      assert.strictEqual(row.slug, null)
      assert.strictEqual(row.publicName, null)

      const ok = await call(websiteProduct.PATCH, 'PATCH', { id: String(p.id) }, { slug: 'ZP483 Mine' })
      assert.strictEqual(ok.status, 200)
      assert.strictEqual(ok.json.slug, 'zp483-mine')
    })

    test('a published product cannot lose its category', async () => {
      const p = await readyProduct('f')
      await call(publishRoute.POST, 'POST', { id: String(p.id) }, { publish: true })
      const res = await call(websiteProduct.PATCH, 'PATCH', { id: String(p.id) }, { categoryId: null })
      assert.strictEqual(res.status, 400)
      assert.ok((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).categoryId)
    })

    test('GET returns website fields, readiness and the gallery; list shows status', async () => {
      const p = await product()
      const res = await call(websiteProduct.GET, 'GET', { id: String(p.id) })
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(res.json.readiness, { ready: false, missing: ['image', 'category', 'slug'] })
      assert.deepStrictEqual(res.json.images, [])
      assert.strictEqual(res.json.status, 'NOT_READY')
      assert.strictEqual(res.json.unitCostRmb, undefined, 'cost is not part of the website payload')

      const list = await call(websiteProducts.GET, 'GET')
      assert.strictEqual(list.status, 200)
      const mine = list.json.find((r: any) => r.id === p.id)
      assert.strictEqual(mine.status, 'NOT_READY')
    })
  })

  describe('gallery', () => {
    test('add, reorder, set primary and delete keep Product.imageUrl in sync', async () => {
      const p = await product()
      await stored('1')
      await stored('2')
      await stored('3')
      const add = await call(imagesRoute.POST, 'POST', { id: String(p.id) }, { urls: [URL_('1'), URL_('2'), URL_('3')] })
      assert.strictEqual(add.status, 200, JSON.stringify(add.json))
      assert.deepStrictEqual(add.json.images.map((i: any) => i.url), [URL_('1'), URL_('2'), URL_('3')])
      assert.strictEqual(add.json.images[0].isPrimary, true)
      assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).imageUrl, URL_('1'))

      const ids = add.json.images.map((i: any) => i.id) as number[]
      // Reorder: the first photo is the primary photo.
      const re = await call(imagesRoute.PUT, 'PUT', { id: String(p.id) }, { order: [ids[2], ids[0], ids[1]] })
      assert.strictEqual(re.status, 200, JSON.stringify(re.json))
      assert.deepStrictEqual(re.json.images.map((i: any) => i.id), [ids[2], ids[0], ids[1]])
      assert.strictEqual(re.json.images[0].isPrimary, true)
      assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).imageUrl, URL_('3'))

      // Set primary moves the photo to the front.
      const prim = await call(imageRoute.PATCH, 'PATCH', { id: String(p.id), imageId: String(ids[1]) }, { primary: true, alt: 'Back view' })
      assert.strictEqual(prim.status, 200, JSON.stringify(prim.json))
      assert.deepStrictEqual(prim.json.images.map((i: any) => i.id), [ids[1], ids[2], ids[0]])
      assert.strictEqual(prim.json.images[0].alt, 'Back view')
      assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).imageUrl, URL_('2'))
      assert.strictEqual(await prisma.productImage.count({ where: { productId: p.id, isPrimary: true } }), 1)

      // Deleting the primary promotes the next photo.
      const del = await call(imageRoute.DELETE, 'DELETE', { id: String(p.id), imageId: String(ids[1]) })
      assert.strictEqual(del.status, 200, JSON.stringify(del.json))
      assert.deepStrictEqual(del.json.images.map((i: any) => i.id), [ids[2], ids[0]])
      assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).imageUrl, URL_('3'))

      // Deleting the rest clears imageUrl.
      await call(imageRoute.DELETE, 'DELETE', { id: String(p.id), imageId: String(ids[2]) })
      const last = await call(imageRoute.DELETE, 'DELETE', { id: String(p.id), imageId: String(ids[0]) })
      assert.deepStrictEqual(last.json.images, [])
      assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).imageUrl, null)
    })

    test('rejects pictures that were not uploaded, bad orders and another product\'s image', async () => {
      const p = await product()
      const other = await product()
      await stored('4')
      assert.strictEqual((await call(imagesRoute.POST, 'POST', { id: String(p.id) }, { urls: ['https://evil.example/x.jpg'] })).status, 400)
      assert.strictEqual((await call(imagesRoute.POST, 'POST', { id: String(p.id) }, { urls: [URL_('9')] })).status, 400, 'not in storage')
      const add = await call(imagesRoute.POST, 'POST', { id: String(other.id) }, { urls: [URL_('4')] })
      const otherImage = add.json.images[0].id
      assert.strictEqual((await call(imagesRoute.PUT, 'PUT', { id: String(p.id) }, { order: [otherImage] })).status, 400)
      assert.strictEqual(
        (await call(imageRoute.PATCH, 'PATCH', { id: String(p.id), imageId: String(otherImage) }, { primary: true })).status,
        404,
      )
      assert.strictEqual((await call(imageRoute.DELETE, 'DELETE', { id: String(p.id), imageId: String(otherImage) })).status, 404)
      assert.strictEqual((await prisma.product.findUniqueOrThrow({ where: { id: other.id } })).imageUrl, URL_('4'))
    })

    test('the last photo of a published product cannot be deleted', async () => {
      const p = await readyProduct('5')
      await call(publishRoute.POST, 'POST', { id: String(p.id) }, { publish: true })
      const img = await prisma.productImage.findFirstOrThrow({ where: { productId: p.id } })
      const res = await call(imageRoute.DELETE, 'DELETE', { id: String(p.id), imageId: String(img.id) })
      assert.strictEqual(res.status, 400)
      assert.strictEqual(await prisma.productImage.count({ where: { productId: p.id } }), 1)
    })
  })

  describe('admin product routes sync the gallery from imageUrl', () => {
    test('PUT with a new imageUrl makes it the primary image; without imageUrl the gallery is untouched', async () => {
      const p = await product({ imageUrl: URL_('6') })
      await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('6'), isPrimary: true } })
      await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('7'), sortOrder: 1 } })

      const res = await call(productById.PUT, 'PUT', { id: String(p.id) }, { imageUrl: URL_('8') })
      assert.strictEqual(res.status, 200, JSON.stringify(res.json))
      const images = await prisma.productImage.findMany({ where: { productId: p.id }, orderBy: { id: 'asc' } })
      assert.deepStrictEqual(images.map((i) => [i.imageKey, i.isPrimary]), [[KEY('7'), false], [KEY('8'), true]])

      const keep = await call(productById.PUT, 'PUT', { id: String(p.id) }, { notes: 'hello' })
      assert.strictEqual(keep.status, 200)
      assert.strictEqual(await prisma.productImage.count({ where: { productId: p.id } }), 2)

      const cleared = await call(productById.PUT, 'PUT', { id: String(p.id) }, { imageUrl: null })
      assert.strictEqual(cleared.status, 200)
      const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      assert.strictEqual(row.imageUrl, URL_('7'))
      assert.strictEqual(cleared.json.imageUrl, URL_('7'))
    })

    test('PUT imageUrl:null cannot remove the last photo of a published product', async () => {
      const p = await readyProduct('9')
      await call(publishRoute.POST, 'POST', { id: String(p.id) }, { publish: true })
      const res = await call(productById.PUT, 'PUT', { id: String(p.id) }, { imageUrl: null, notes: 'should not save' })
      assert.strictEqual(res.status, 400, JSON.stringify(res.json))
      assert.strictEqual(res.json.error, 'Unpublish the product before removing its last photo')
      const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      assert.strictEqual(row.published, true)
      assert.strictEqual(row.imageUrl, URL_('9'))
      assert.strictEqual(row.notes, null)
      assert.strictEqual(await prisma.productImage.count({ where: { productId: p.id } }), 1)
    })

    test('PUT imageUrl:null on a published product with more photos promotes the next one', async () => {
      const p = await readyProduct('8')
      await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('7'), sortOrder: 1 } })
      await call(publishRoute.POST, 'POST', { id: String(p.id) }, { publish: true })
      const res = await call(productById.PUT, 'PUT', { id: String(p.id) }, { imageUrl: null })
      assert.strictEqual(res.status, 200, JSON.stringify(res.json))
      assert.strictEqual(res.json.imageUrl, URL_('7'))
    })

    test('PUT with an external imageUrl is refused and changes nothing', async () => {
      const p = await product({ imageUrl: URL_('6') })
      await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('6'), isPrimary: true } })
      const res = await call(productById.PUT, 'PUT', { id: String(p.id) }, { imageUrl: 'https://evil.example/x.jpg', notes: 'n' })
      assert.strictEqual(res.status, 400)
      const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } })
      assert.strictEqual(row.imageUrl, URL_('6'))
      assert.strictEqual(row.notes, null)
    })

    test('POST with an imageUrl stores the picture and creates the primary gallery image', async () => {
      const res = await call(productsRoute.POST, 'POST', {}, {
        itemNumber: 'ZP483-NEW',
        productName: 'ZP483 new',
        unitCostRmb: 10,
        unitCostUsd: 1.5,
        openingQuantity: 0,
        imageUrl: URL_('a'),
      })
      assert.strictEqual(res.status, 201, JSON.stringify(res.json))
      assert.strictEqual(res.json.imageUrl, URL_('a'))
      const images = await prisma.productImage.findMany({ where: { productId: res.json.id } })
      assert.deepStrictEqual(images.map((i) => [i.imageKey, i.isPrimary]), [[KEY('a'), true]])
    })
  })

  describe('categories', () => {
    test('create with an automatic slug, rename, reserved and duplicate slugs are refused', async () => {
      const a = await call(categoriesRoute.POST, 'POST', {}, { name: 'ZP483 Dresses' })
      assert.strictEqual(a.status, 201, JSON.stringify(a.json))
      assert.strictEqual(a.json.slug, 'zp483-dresses')
      assert.strictEqual(a.json.published, false)
      const again = await call(categoriesRoute.POST, 'POST', {}, { name: 'ZP483 Dresses' })
      assert.strictEqual(again.json.slug, 'zp483-dresses-2', 'generated slugs get a suffix')

      const reserved = await call(categoryRoute.PATCH, 'PATCH', { id: String(a.json.id) }, { slug: 'shop' })
      assert.strictEqual(reserved.status, 400)
      assert.strictEqual(reserved.json.field, 'slug')
      const dup = await call(categoryRoute.PATCH, 'PATCH', { id: String(a.json.id) }, { slug: 'zp483-dresses-2' })
      assert.strictEqual(dup.status, 400)
      assert.strictEqual(dup.json.field, 'slug')
      const typed = await call(categoriesRoute.POST, 'POST', {}, { name: 'ZP483 X', slug: 'new' })
      assert.strictEqual(typed.status, 400)

      const renamed = await call(categoryRoute.PATCH, 'PATCH', { id: String(a.json.id) }, { name: 'ZP483 Evening', slug: 'zp483-evening', published: true })
      assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.json))
      assert.strictEqual(renamed.json.slug, 'zp483-evening')
      assert.strictEqual(renamed.json.published, true)

      assert.strictEqual((await call(categoriesRoute.POST, 'POST', {}, { name: '' })).status, 400)
      assert.strictEqual((await call(categoriesRoute.POST, 'POST', {}, { name: 'ZP483 y', sortOrder: 5 })).status, 400)
    })

    test('reorder sets sortOrder from the given order', async () => {
      const list0 = await call(categoriesRoute.GET, 'GET')
      const c1 = await category()
      const c2 = await category()
      const ids = [...list0.json.map((c: any) => c.id), c1.id, c2.id]
      const order = [c2.id, ...ids.filter((id) => id !== c2.id)]
      const res = await call(categoriesRoute.PUT, 'PUT', {}, { order })
      assert.strictEqual(res.status, 200, JSON.stringify(res.json))
      assert.deepStrictEqual(res.json.map((c: any) => c.id), order)
      assert.strictEqual((await call(categoriesRoute.PUT, 'PUT', {}, { order: [c1.id] })).status, 400, 'must list every category')
    })

    test('delete is blocked while products use the category', async () => {
      const cat = await category()
      const p = await product({ categoryId: cat.id })
      await product({ categoryId: cat.id })
      const res = await call(categoryRoute.DELETE, 'DELETE', { id: String(cat.id) })
      assert.strictEqual(res.status, 409)
      assert.strictEqual(res.json.error, 'Move 2 products first')
      assert.strictEqual(res.json.productCount, 2)
      assert.ok(await prisma.category.findUnique({ where: { id: cat.id } }))

      await prisma.product.updateMany({ where: { categoryId: cat.id }, data: { categoryId: null } })
      const ok = await call(categoryRoute.DELETE, 'DELETE', { id: String(cat.id) })
      assert.strictEqual(ok.status, 200)
      assert.strictEqual(await prisma.category.findUnique({ where: { id: cat.id } }), null)
      assert.ok(p)
    })

    test('hero image must be an uploaded picture', async () => {
      const cat = await category()
      await stored('b')
      const ok = await call(categoryRoute.PATCH, 'PATCH', { id: String(cat.id) }, { heroImageUrl: URL_('b') })
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.json))
      assert.strictEqual(ok.json.heroImageKey, KEY('b'))
      assert.strictEqual((await call(categoryRoute.PATCH, 'PATCH', { id: String(cat.id) }, { heroImageUrl: 'https://x.example/a.jpg' })).status, 400)
      const cleared = await call(categoryRoute.PATCH, 'PATCH', { id: String(cat.id) }, { heroImageUrl: null })
      assert.strictEqual(cleared.json.heroImageKey, null)
    })
  })

  describe('preview token', () => {
    test('issues a short-lived token for the product and a preview URL', async () => {
      const p = await product({ publicName: 'ZP483 Preview Me' })
      const res = await call(previewRoute.POST, 'POST', { id: String(p.id) })
      assert.strictEqual(res.status, 200, JSON.stringify(res.json))
      assert.deepStrictEqual(await verifyPreviewToken(res.json.token), { productId: p.id })
      assert.strictEqual(res.json.url, `/site/p/zp483-preview-me?preview=${res.json.token}`)
      assert.ok(new Date(res.json.expiresAt).getTime() > Date.now())
      assert.strictEqual((await call(previewRoute.POST, 'POST', { id: '987654321' })).status, 404)
    })
  })
})
