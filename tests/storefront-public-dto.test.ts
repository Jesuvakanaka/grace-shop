// ZP-484: the public data layer's pure parts. No database.
// - The public product DTO has an exact key set and never carries private fields.
// - Price, images, sort, paging, revalidation tags, JSON query allow-list, rate limit.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  publicImageUrl,
  toPublicProduct,
  toPublicCategory,
  type PublicProductRow,
} from '../src/lib/storefront/dto'
import { sortProductRows, normalisePaging, PUBLIC_PRODUCT_SORTS } from '../src/lib/storefront/listing'
import {
  revalidateStorefront,
  STOREFRONT_TAGS,
  storefrontProductTag,
  storefrontCategoryTag,
} from '../src/lib/storefront/cache-tags'
import { parsePublicProductsQuery } from '../src/lib/storefront/public-products-query'
import { TokenBucketLimiter } from '../src/lib/storefront/rate-limit'

const KEY = (c: string) => `products/${c.repeat(32)}.webp`
const NOW = new Date('2026-11-01T12:00:00Z')
const DAY = 86_400_000

let nextId = 1
function row(overrides: Partial<PublicProductRow> = {}): PublicProductRow {
  const id = nextId++
  return {
    id,
    itemNumber: `ITEM-${id}`,
    productName: `Product ${id}`,
    publicName: null,
    slug: `product-${id}`,
    publicDescription: 'A lovely thing',
    colours: 'black, cream',
    sizes: 'S-XL',
    featured: false,
    sortOrder: 0,
    published: true,
    publishedAt: new Date(NOW.getTime() - 60 * DAY),
    priceDisplay: 'SHOW_PRICE',
    sellingPriceUsd: 25,
    currentQuantity: 10,
    category: { slug: 'dresses', name: 'Dresses', published: true },
    images: [
      { id: 2, imageKey: KEY('b'), alt: null, sortOrder: 1, isPrimary: false },
      { id: 1, imageKey: KEY('a'), alt: 'Front', sortOrder: 5, isPrimary: true },
    ],
    ...overrides,
  }
}

const FORBIDDEN = /cost|wholesale|quantity|source|note|createdBy|updatedBy|itemNumber/i

function allKeys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => allKeys(v, `${prefix}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [`${prefix}${k}`, ...allKeys(v, `${prefix}${k}.`)])
  }
  return []
}

describe('public product DTO', () => {
  test('exact key set (snapshot)', () => {
    const dto = toPublicProduct(row(), { now: NOW })
    assert.deepStrictEqual(Object.keys(dto).sort(), [
      'availability',
      'category',
      'colours',
      'description',
      'featured',
      'images',
      'isNew',
      'name',
      'priceUsd',
      'sizes',
      'slug',
    ])
    assert.deepStrictEqual(Object.keys(dto.category).sort(), ['name', 'slug'])
    for (const image of dto.images) assert.deepStrictEqual(Object.keys(image).sort(), ['alt', 'height', 'url', 'width'])
  })

  test('no key, at any depth, looks private', () => {
    // Even a row carrying extra private columns (as a raw Prisma row would) must not leak them.
    const raw = {
      ...row(),
      unitCostRmb: 1,
      unitCostUsd: 2,
      wholesalePriceUsd: 3,
      wholesaleMinQuantity: 4,
      openingQuantity: 5,
      notes: 'secret',
      sourceFilename: 'August trip.xlsx',
      sourceRowNumber: 7,
      createdBy: 'owner',
      updatedBy: 'staff',
    } as PublicProductRow
    const dto = toPublicProduct(raw, { now: NOW })
    const keys = allKeys(dto)
    assert.ok(keys.length > 10)
    for (const k of keys) assert.doesNotMatch(k, FORBIDDEN, `leaked key ${k}`)
    assert.ok(!JSON.stringify(dto).includes('secret'))
    assert.ok(!JSON.stringify(dto).includes('ITEM-'))
    assert.ok(!('id' in dto))
  })

  test('itemNumber only with the opt-in flag', () => {
    const r = row()
    assert.ok(!('itemNumber' in toPublicProduct(r, { now: NOW })))
    assert.strictEqual(toPublicProduct(r, { now: NOW, includeItemNumber: true }).itemNumber, r.itemNumber)
  })

  test('display name, description, category, colours and sizes', () => {
    const dto = toPublicProduct(row({ productName: 'Internal name', publicName: '  Silk Dress ' }), { now: NOW })
    assert.strictEqual(dto.name, 'Silk Dress')
    assert.strictEqual(dto.description, 'A lovely thing')
    assert.deepStrictEqual(dto.category, { slug: 'dresses', name: 'Dresses' })
    assert.strictEqual(dto.colours, 'black, cream')
    assert.strictEqual(dto.sizes, 'S-XL')
    assert.strictEqual(toPublicProduct(row({ publicDescription: '  ' }), { now: NOW }).description, null)
  })

  test('price: ASK_FOR_PRICE -> none; SHOW_PRICE with 0 -> none; SHOW_PRICE > 0 -> price', () => {
    assert.strictEqual(toPublicProduct(row({ priceDisplay: 'ASK_FOR_PRICE', sellingPriceUsd: 40 }), { now: NOW }).priceUsd, null)
    assert.strictEqual(toPublicProduct(row({ priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 0 }), { now: NOW }).priceUsd, null)
    assert.strictEqual(toPublicProduct(row({ priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 40 }), { now: NOW }).priceUsd, 40)
  })

  test('availability label from quantity, threshold is a parameter; quantity itself never exposed', () => {
    assert.strictEqual(toPublicProduct(row({ currentQuantity: 0 }), { now: NOW }).availability, 'SOLD_OUT')
    assert.strictEqual(toPublicProduct(row({ currentQuantity: 3 }), { now: NOW }).availability, 'FEW_LEFT')
    assert.strictEqual(toPublicProduct(row({ currentQuantity: 4 }), { now: NOW }).availability, 'IN_STOCK')
    assert.strictEqual(toPublicProduct(row({ currentQuantity: 4 }), { now: NOW, fewLeftThreshold: 5 }).availability, 'FEW_LEFT')
    assert.ok(!JSON.stringify(toPublicProduct(row({ currentQuantity: 987 }), { now: NOW })).includes('987'))
  })

  test('isNew is derived from publishedAt', () => {
    assert.strictEqual(toPublicProduct(row({ publishedAt: new Date(NOW.getTime() - 2 * DAY) }), { now: NOW }).isNew, true)
    assert.strictEqual(toPublicProduct(row({ publishedAt: new Date(NOW.getTime() - 40 * DAY) }), { now: NOW }).isNew, false)
  })

  test('images: public URLs, primary first, alt falls back to the name, invalid keys dropped', () => {
    const dto = toPublicProduct(
      row({
        publicName: 'Silk Dress',
        images: [
          { id: 3, imageKey: '../../etc/passwd', alt: null, sortOrder: 0, isPrimary: false },
          { id: 2, imageKey: KEY('b'), alt: null, sortOrder: 1, isPrimary: false },
          { id: 1, imageKey: KEY('a'), alt: 'Front', sortOrder: 5, isPrimary: true },
        ],
      }),
      { now: NOW },
    )
    assert.deepStrictEqual(dto.images, [
      { url: `/api/images/public/${'a'.repeat(32)}.webp`, alt: 'Front', width: null, height: null },
      { url: `/api/images/public/${'b'.repeat(32)}.webp`, alt: 'Silk Dress', width: null, height: null },
    ])
  })

  test('publicImageUrl validates the key', () => {
    assert.strictEqual(publicImageUrl(KEY('c')), `/api/images/public/${'c'.repeat(32)}.webp`)
    assert.throws(() => publicImageUrl('products/../x.webp'))
    assert.throws(() => publicImageUrl('products/ABC.webp'))
  })

  test('category DTO: allow-listed keys and hero image URL', () => {
    const dto = toPublicCategory({
      id: 9,
      slug: 'dresses',
      name: 'Dresses',
      description: 'All dresses',
      heroImageKey: KEY('d'),
      sortOrder: 1,
      published: true,
    } as Parameters<typeof toPublicCategory>[0])
    assert.deepStrictEqual(dto, {
      slug: 'dresses',
      name: 'Dresses',
      description: 'All dresses',
      heroImage: { url: `/api/images/public/${'d'.repeat(32)}.webp`, alt: 'Dresses', width: null, height: null },
    })
    assert.strictEqual(
      toPublicCategory({ slug: 'x', name: 'X', description: null, heroImageKey: 'bad' }).heroImage,
      null,
    )
  })
})

describe('sort and pagination (pure)', () => {
  const at = (days: number) => new Date(NOW.getTime() - days * DAY)
  const rows = () => [
    row({ slug: 'a', sortOrder: 2, featured: false, publishedAt: at(1), sellingPriceUsd: 30, productName: 'Delta' }),
    row({ slug: 'b', sortOrder: 1, featured: false, publishedAt: at(5), sellingPriceUsd: 10, productName: 'Alpha' }),
    row({ slug: 'c', sortOrder: 9, featured: true, publishedAt: at(9), sellingPriceUsd: 20, productName: 'Charlie' }),
    row({ slug: 'd', sortOrder: 1, featured: false, publishedAt: at(2), priceDisplay: 'ASK_FOR_PRICE', sellingPriceUsd: 1, productName: 'Bravo' }),
    row({ slug: 'e', sortOrder: 1, featured: true, publishedAt: at(3), sellingPriceUsd: 0, productName: 'Echo' }),
  ]
  const slugs = (sort: (typeof PUBLIC_PRODUCT_SORTS)[number]) => sortProductRows(rows(), sort).map((r) => r.slug)

  test('default: featured desc, then sortOrder asc, then publishedAt desc', () => {
    assert.deepStrictEqual(slugs('featured'), ['e', 'c', 'd', 'b', 'a'])
  })
  test('newest: publishedAt desc', () => {
    assert.deepStrictEqual(slugs('newest'), ['a', 'd', 'e', 'b', 'c'])
  })
  test('price sorts use only visible prices; hidden prices go last in default order', () => {
    assert.deepStrictEqual(slugs('price-asc'), ['b', 'c', 'a', 'e', 'd'])
    assert.deepStrictEqual(slugs('price-desc'), ['a', 'c', 'b', 'e', 'd'])
  })
  test('name: display name A-Z', () => {
    assert.deepStrictEqual(slugs('name'), ['b', 'd', 'c', 'a', 'e'])
  })
  test('normalisePaging clamps page and pageSize', () => {
    assert.deepStrictEqual(normalisePaging({}), { page: 1, pageSize: 24 })
    assert.deepStrictEqual(normalisePaging({ page: 0, pageSize: 1000 }), { page: 1, pageSize: 48 })
    assert.deepStrictEqual(normalisePaging({ page: 2.7, pageSize: -3 }), { page: 2, pageSize: 1 })
    assert.deepStrictEqual(normalisePaging({ page: Number.NaN, pageSize: Number.NaN }), { page: 1, pageSize: 24 })
  })
})

describe('revalidation helpers', () => {
  function spy() {
    const calls: [string, unknown][] = []
    return { calls, deps: { revalidateTag: (tag: string, profile: unknown) => void calls.push([tag, profile]) } }
  }

  test('tag names', () => {
    assert.strictEqual(STOREFRONT_TAGS.all, 'storefront')
    assert.strictEqual(STOREFRONT_TAGS.products, 'storefront:products')
    assert.strictEqual(STOREFRONT_TAGS.categories, 'storefront:categories')
    assert.strictEqual(storefrontProductTag('silk-dress'), 'storefront:product:silk-dress')
    assert.strictEqual(storefrontCategoryTag('dresses'), 'storefront:category:dresses')
  })

  test('no scope: everything, expiring immediately', () => {
    const s = spy()
    assert.deepStrictEqual(revalidateStorefront(undefined, s.deps), ['storefront'])
    assert.deepStrictEqual(s.calls, [['storefront', { expire: 0 }]])
  })

  test('product slugs (old and new): the products tag plus each product tag', () => {
    const s = spy()
    revalidateStorefront({ productSlugs: ['silk-dress', 'old-silk', 'silk-dress'] }, s.deps)
    assert.deepStrictEqual(
      s.calls.map((c) => c[0]),
      ['storefront:products', 'storefront:product:silk-dress', 'storefront:product:old-silk'],
    )
    assert.ok(s.calls.every((c) => JSON.stringify(c[1]) === '{"expire":0}'))
  })

  test('category slugs: the categories tag plus each category tag', () => {
    const s = spy()
    revalidateStorefront({ categorySlugs: ['dresses'] }, s.deps)
    assert.deepStrictEqual(s.calls.map((c) => c[0]), ['storefront:categories', 'storefront:category:dresses'])
  })

  test('both, and invalid slugs are skipped', () => {
    const s = spy()
    revalidateStorefront({ productSlugs: ['ok', 'Not A Slug', ''], categorySlugs: [] }, s.deps)
    assert.deepStrictEqual(s.calls.map((c) => c[0]), ['storefront:products', 'storefront:product:ok', 'storefront:categories'])
  })
})

describe('GET /api/public/products query allow-list', () => {
  const q = (s: string) => parsePublicProductsQuery(new URLSearchParams(s))

  test('defaults', () => {
    assert.deepStrictEqual(q(''), {
      ok: true,
      options: { sort: 'featured', page: 1, pageSize: 24 },
    })
  })
  test('all allowed params', () => {
    assert.deepStrictEqual(q('category=dresses&new=1&featured=true&sort=newest&page=2&pageSize=12&hideSoldOut=1'), {
      ok: true,
      options: {
        categorySlug: 'dresses',
        newOnly: true,
        featuredOnly: true,
        hideSoldOut: true,
        sort: 'newest',
        page: 2,
        pageSize: 12,
      },
    })
  })
  test('unknown, repeated or malformed params are rejected', () => {
    for (const s of ['itemNumber=1', 'include=cost', 'sort=cost', 'page=abc', 'page=1&page=2', 'category=Bad Slug', 'new=maybe', 'pageSize=0']) {
      assert.strictEqual(q(s).ok, false, s)
    }
  })
})

describe('rate limiter (token bucket)', () => {
  test('allows a burst, then refills over time', () => {
    let t = 0
    const limiter = new TokenBucketLimiter({ capacity: 3, refillPerSecond: 1, now: () => t })
    assert.strictEqual(limiter.take('1.1.1.1').ok, true)
    assert.strictEqual(limiter.take('1.1.1.1').ok, true)
    assert.strictEqual(limiter.take('1.1.1.1').ok, true)
    const denied = limiter.take('1.1.1.1')
    assert.strictEqual(denied.ok, false)
    assert.ok(denied.retryAfterSeconds >= 1)
    assert.strictEqual(limiter.take('2.2.2.2').ok, true, 'buckets are per key')
    t += 1000
    assert.strictEqual(limiter.take('1.1.1.1').ok, true)
    assert.strictEqual(limiter.take('1.1.1.1').ok, false)
  })
  test('the number of tracked keys is bounded', () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 1, maxKeys: 2, now: () => 0 })
    limiter.take('a')
    limiter.take('b')
    limiter.take('c')
    assert.ok(limiter.size <= 2)
  })
})
