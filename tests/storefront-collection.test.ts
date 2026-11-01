// ZP-489: collection and category listing pages (/shop, /collections/<slug>, /new).
// Pure tests for the query parsing, sort/filter/paging plan, the price-sort
// visibility rule and the 404 / redirect decisions. The data source is a
// stand-in built from the real pure catalogue (buildCatalogue + selectProducts),
// so filtering and sorting are the same code the cached data layer runs.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { buildCatalogue, selectProducts, type CatalogueListOptions } from '../src/lib/storefront/catalogue'
import type { PublicCategory, PublicProductRow } from '../src/lib/storefront/dto'
import {
  LISTING_PAGE_SIZE,
  canonicalUrl,
  effectiveSort,
  listingHref,
  loadListing,
  pageWindow,
  parseListingQuery,
  requestOrigin,
  resolvePage,
  sortOptionsFor,
  type ListingSource,
} from '../src/lib/storefront/listing-query'

const NOW = new Date('2026-11-01T12:00:00Z')
const DAY = 86_400_000

let nextId = 1
function row(over: Partial<PublicProductRow> & { slug: string }): PublicProductRow {
  const id = nextId++
  return {
    id,
    itemNumber: `T-${id}`,
    productName: over.slug,
    publicName: null,
    publicDescription: null,
    colours: null,
    sizes: null,
    featured: false,
    sortOrder: 0,
    published: true,
    publishedAt: new Date(NOW.getTime() - 60 * DAY),
    priceDisplay: 'SHOW_PRICE',
    sellingPriceUsd: 40,
    currentQuantity: 10,
    category: { slug: 'dresses', name: 'Dresses', published: true },
    images: [],
    ...over,
  }
}

const CATEGORIES: PublicCategory[] = [
  { slug: 'dresses', name: 'Dresses', description: 'Flowing pieces.', heroImage: null },
  { slug: 'sets', name: 'Sets', description: null, heroImage: null },
  { slug: 'empty', name: 'Empty', description: null, heroImage: null },
]

function source(rows: PublicProductRow[]): ListingSource & { calls: CatalogueListOptions[] } {
  const catalogue = buildCatalogue(rows, [], { now: NOW })
  const calls: CatalogueListOptions[] = []
  return {
    calls,
    async listPublishedProducts(options = {}) {
      calls.push(options)
      return selectProducts(catalogue, options)
    },
    async getPublishedCategory(slug) {
      return CATEGORIES.find((c) => c.slug === slug) ?? null
    },
  }
}

const sp = (q: string) => Object.fromEntries(new URLSearchParams(q)) as Record<string, string>

describe('parseListingQuery', () => {
  test('defaults', () => {
    assert.deepStrictEqual(parseListingQuery({}), { sort: 'featured', hideSoldOut: false, page: 1 })
  })

  test('reads sort, soldout and page', () => {
    assert.deepStrictEqual(parseListingQuery(sp('sort=newest&soldout=hide&page=2')), {
      sort: 'newest',
      hideSoldOut: true,
      page: 2,
    })
    assert.strictEqual(parseListingQuery(sp('sort=price-asc')).sort, 'price-asc')
    assert.strictEqual(parseListingQuery(sp('sort=price-desc')).sort, 'price-desc')
  })

  test('invalid values fall back to defaults, never throw', () => {
    const bad = [
      'sort=name', // a data-layer sort the pages do not offer
      'sort=PRICE-ASC',
      'sort=',
      'sort=%00',
      `sort=${'x'.repeat(5000)}`,
    ]
    for (const q of bad) assert.strictEqual(parseListingQuery(sp(q)).sort, 'featured', q)
    for (const q of ['soldout=show', 'soldout=1', 'soldout=', 'soldout=HIDE']) {
      assert.strictEqual(parseListingQuery(sp(q)).hideSoldOut, false, q)
    }
    for (const q of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=', 'page=1e3', 'page=+2', 'page=99999999999']) {
      assert.strictEqual(parseListingQuery(sp(q)).page, 1, q)
    }
  })

  test('unknown parameters are ignored', () => {
    assert.deepStrictEqual(parseListingQuery(sp('utm_source=x&category=sets&pageSize=48')), {
      sort: 'featured',
      hideSoldOut: false,
      page: 1,
    })
  })

  test('a repeated parameter uses its first value; non-string values are ignored', () => {
    assert.strictEqual(parseListingQuery({ sort: ['newest', 'price-asc'] }).sort, 'newest')
    assert.strictEqual(parseListingQuery({ page: ['3', '4'] }).page, 3)
    assert.strictEqual(parseListingQuery({ sort: undefined, page: [] }).page, 1)
  })

  test('accepts URLSearchParams too', () => {
    assert.strictEqual(parseListingQuery(new URLSearchParams('soldout=hide')).hideSoldOut, true)
  })
})

describe('listingHref', () => {
  test('omits defaults and keeps a stable order', () => {
    assert.strictEqual(listingHref('/site/shop', {}), '/site/shop')
    assert.strictEqual(listingHref('/site/shop', { sort: 'featured', hideSoldOut: false, page: 1 }), '/site/shop')
    assert.strictEqual(
      listingHref('/shop', { page: 2, hideSoldOut: true, sort: 'newest' }),
      '/shop?sort=newest&soldout=hide&page=2',
    )
    assert.strictEqual(listingHref('/collections/sets', { sort: 'price-desc' }), '/collections/sets?sort=price-desc')
  })

  test('round-trips through parseListingQuery', () => {
    const q = { sort: 'price-asc' as const, hideSoldOut: true, page: 7 }
    const href = listingHref('/shop', q)
    assert.deepStrictEqual(parseListingQuery(new URLSearchParams(href.split('?')[1])), q)
  })
})

describe('price sort visibility', () => {
  test('price sorts are offered only when every product in view shows a price', () => {
    const values = (allPriced: boolean) => sortOptionsFor(allPriced).map((o) => o.value)
    assert.deepStrictEqual(values(true), ['featured', 'newest', 'price-asc', 'price-desc'])
    assert.deepStrictEqual(values(false), ['featured', 'newest'])
    assert.deepStrictEqual(
      sortOptionsFor(true).map((o) => o.label),
      ['Featured', 'Newest', 'Price: low to high', 'Price: high to low'],
    )
  })

  test('a price sort in the URL falls back to featured when a price is hidden', () => {
    assert.strictEqual(effectiveSort('price-asc', false), 'featured')
    assert.strictEqual(effectiveSort('price-desc', false), 'featured')
    assert.strictEqual(effectiveSort('price-asc', true), 'price-asc')
    assert.strictEqual(effectiveSort('newest', false), 'newest')
  })
})

describe('resolvePage (out-of-range pages redirect to the last page)', () => {
  test('in range', () => {
    assert.deepStrictEqual(resolvePage(1, 0), { page: 1, redirectTo: null })
    assert.deepStrictEqual(resolvePage(1, 3), { page: 1, redirectTo: null })
    assert.deepStrictEqual(resolvePage(3, 3), { page: 3, redirectTo: null })
  })
  test('past the end', () => {
    assert.deepStrictEqual(resolvePage(4, 3), { page: 3, redirectTo: 3 })
    assert.deepStrictEqual(resolvePage(2, 0), { page: 1, redirectTo: 1 })
  })
})

describe('pageWindow', () => {
  test('all pages when few', () => {
    assert.deepStrictEqual(pageWindow(1, 1), [1])
    assert.deepStrictEqual(pageWindow(2, 5), [1, 2, 3, 4, 5])
  })
  test('first, last and neighbours with gaps when many', () => {
    assert.deepStrictEqual(pageWindow(1, 20), [1, 2, 'gap', 20])
    assert.deepStrictEqual(pageWindow(10, 20), [1, 'gap', 9, 10, 11, 'gap', 20])
    assert.deepStrictEqual(pageWindow(20, 20), [1, 'gap', 19, 20])
    assert.deepStrictEqual(pageWindow(3, 20), [1, 2, 3, 4, 'gap', 20])
  })
})

describe('canonical URL ignores the query', () => {
  test('built from the origin and the site base', () => {
    assert.strictEqual(canonicalUrl('https://uat.example.com', '/site', '/shop'), 'https://uat.example.com/site/shop')
    assert.strictEqual(canonicalUrl('https://vyra.example', '', '/collections/sets'), 'https://vyra.example/collections/sets')
    assert.strictEqual(canonicalUrl('https://vyra.example', '', '/shop?sort=newest&page=2'), 'https://vyra.example/shop')
    assert.strictEqual(canonicalUrl(null, '/site', '/new'), '/site/new')
  })

  test('requestOrigin from Host and X-Forwarded-Proto, rejecting junk', () => {
    assert.strictEqual(requestOrigin('uat.example.com', 'https'), 'https://uat.example.com')
    assert.strictEqual(requestOrigin('uat.example.com', 'https,http'), 'https://uat.example.com')
    assert.strictEqual(requestOrigin('localhost:3400', null), 'http://localhost:3400')
    assert.strictEqual(requestOrigin('shop.example.com', null), 'https://shop.example.com')
    assert.strictEqual(requestOrigin('shop.example.com', 'ftp'), 'https://shop.example.com')
    assert.strictEqual(requestOrigin(null, 'https'), null)
    assert.strictEqual(requestOrigin('evil.com/path', 'https'), null)
    assert.strictEqual(requestOrigin('a b', 'https'), null)
  })
})

describe('loadListing', () => {
  function many(n: number, over: (i: number) => Partial<Omit<PublicProductRow, 'slug'>> = () => ({})) {
    return Array.from({ length: n }, (_, i) => row({ slug: `p-${String(i + 1).padStart(2, '0')}`, ...over(i) }))
  }

  test('unknown category -> notFound, without listing products', async () => {
    const src = source(many(3))
    assert.deepStrictEqual(await loadListing(src, { kind: 'category', slug: 'nope' }, parseListingQuery({}), '/shop'), {
      kind: 'notFound',
    })
    assert.strictEqual(src.calls.length, 0)
  })

  test('invalid category slug -> notFound', async () => {
    for (const slug of ['Not A Slug', '', '../x', 'x'.repeat(500)]) {
      const r = await loadListing(source([]), { kind: 'category', slug }, parseListingQuery({}), '/x')
      assert.deepStrictEqual(r, { kind: 'notFound' }, slug)
    }
  })

  test('/shop pages of 24 over every published product', async () => {
    const src = source(many(30))
    const p1 = await loadListing(src, { kind: 'all' }, parseListingQuery({}), '/site/shop')
    assert.ok(p1.kind === 'ok')
    assert.strictEqual(p1.page.items.length, LISTING_PAGE_SIZE)
    assert.strictEqual(p1.page.total, 30)
    assert.strictEqual(p1.page.pageCount, 2)
    assert.strictEqual(p1.category, null)
    const p2 = await loadListing(src, { kind: 'all' }, parseListingQuery(sp('page=2')), '/site/shop')
    assert.ok(p2.kind === 'ok')
    assert.strictEqual(p2.page.items.length, 6)
    const seen = new Set([...p1.page.items, ...p2.page.items].map((p) => p.slug))
    assert.strictEqual(seen.size, 30)
    for (const call of src.calls) assert.strictEqual(call.pageSize, LISTING_PAGE_SIZE)
  })

  test('out-of-range page redirects to the last page, keeping sort and filter', async () => {
    const src = source(many(30))
    const r = await loadListing(src, { kind: 'all' }, parseListingQuery(sp('page=9&sort=newest&soldout=hide')), '/site/shop')
    assert.deepStrictEqual(r, { kind: 'redirect', to: '/site/shop?sort=newest&soldout=hide&page=2' })
    const empty = await loadListing(source([]), { kind: 'all' }, parseListingQuery(sp('page=2')), '/shop')
    assert.deepStrictEqual(empty, { kind: 'redirect', to: '/shop' })
  })

  test('category scope filters by category and returns the category', async () => {
    const rows = [
      ...many(3),
      row({ slug: 'set-a', category: { slug: 'sets', name: 'Sets', published: true } }),
    ]
    const r = await loadListing(source(rows), { kind: 'category', slug: 'sets' }, parseListingQuery({}), '/collections/sets')
    assert.ok(r.kind === 'ok')
    assert.deepStrictEqual(r.page.items.map((p) => p.slug), ['set-a'])
    assert.strictEqual(r.category?.name, 'Sets')
  })

  test('a published category with no products is ok and empty (empty state)', async () => {
    const r = await loadListing(source(many(2)), { kind: 'category', slug: 'empty' }, parseListingQuery({}), '/c')
    assert.ok(r.kind === 'ok')
    assert.strictEqual(r.page.total, 0)
    assert.strictEqual(r.page.items.length, 0)
  })

  test('/new lists new arrivals only', async () => {
    const rows = [
      row({ slug: 'old' }),
      row({ slug: 'fresh', publishedAt: new Date(NOW.getTime() - 2 * DAY) }),
    ]
    const r = await loadListing(source(rows), { kind: 'new' }, parseListingQuery({}), '/new')
    assert.ok(r.kind === 'ok')
    assert.deepStrictEqual(r.page.items.map((p) => p.slug), ['fresh'])
  })

  test('hide sold out', async () => {
    const rows = [row({ slug: 'gone', currentQuantity: 0 }), row({ slug: 'here' })]
    const shown = await loadListing(source(rows), { kind: 'all' }, parseListingQuery({}), '/shop')
    const hidden = await loadListing(source(rows), { kind: 'all' }, parseListingQuery(sp('soldout=hide')), '/shop')
    assert.ok(shown.kind === 'ok' && hidden.kind === 'ok')
    assert.deepStrictEqual(shown.page.items.map((p) => p.slug).sort(), ['gone', 'here'])
    assert.deepStrictEqual(hidden.page.items.map((p) => p.slug), ['here'])
    assert.strictEqual(hidden.query.hideSoldOut, true)
  })

  test('sorts: newest and price both ways', async () => {
    const rows = [
      row({ slug: 'mid', sellingPriceUsd: 50, publishedAt: new Date(NOW.getTime() - 5 * DAY) }),
      row({ slug: 'cheap', sellingPriceUsd: 20, publishedAt: new Date(NOW.getTime() - 9 * DAY) }),
      row({ slug: 'dear', sellingPriceUsd: 90, publishedAt: new Date(NOW.getTime() - 1 * DAY) }),
    ]
    const slugs = async (q: string) => {
      const r = await loadListing(source(rows), { kind: 'all' }, parseListingQuery(sp(q)), '/shop')
      assert.ok(r.kind === 'ok')
      return r.page.items.map((p) => p.slug)
    }
    assert.deepStrictEqual(await slugs('sort=newest'), ['dear', 'mid', 'cheap'])
    assert.deepStrictEqual(await slugs('sort=price-asc'), ['cheap', 'mid', 'dear'])
    assert.deepStrictEqual(await slugs('sort=price-desc'), ['dear', 'mid', 'cheap'])
  })

  test('price sort is offered and applied only when every product in view shows a price', async () => {
    const priced = [row({ slug: 'a', sellingPriceUsd: 30 }), row({ slug: 'b', sellingPriceUsd: 10 })]
    const ok = await loadListing(source(priced), { kind: 'all' }, parseListingQuery(sp('sort=price-asc')), '/shop')
    assert.ok(ok.kind === 'ok')
    assert.strictEqual(ok.allPriced, true)
    assert.strictEqual(ok.query.sort, 'price-asc')
    assert.deepStrictEqual(ok.sortOptions.map((o) => o.value), ['featured', 'newest', 'price-asc', 'price-desc'])
    assert.deepStrictEqual(ok.page.items.map((p) => p.slug), ['b', 'a'])

    const mixed = [...priced, row({ slug: 'ask', priceDisplay: 'ASK_FOR_PRICE' })]
    const r = await loadListing(source(mixed), { kind: 'all' }, parseListingQuery(sp('sort=price-asc')), '/shop')
    assert.ok(r.kind === 'ok')
    assert.strictEqual(r.allPriced, false)
    assert.strictEqual(r.query.sort, 'featured')
    assert.deepStrictEqual(r.sortOptions.map((o) => o.value), ['featured', 'newest'])
  })

  test('the price rule looks at the products in view, not the whole catalogue', async () => {
    const rows = [
      row({ slug: 'priced-set', category: { slug: 'sets', name: 'Sets', published: true } }),
      row({ slug: 'ask-dress', priceDisplay: 'ASK_FOR_PRICE' }),
      row({ slug: 'ask-gone', priceDisplay: 'ASK_FOR_PRICE', currentQuantity: 0, category: { slug: 'sets', name: 'Sets', published: true } }),
    ]
    const sets = await loadListing(source(rows), { kind: 'category', slug: 'sets' }, parseListingQuery({}), '/c')
    assert.ok(sets.kind === 'ok')
    assert.strictEqual(sets.allPriced, false, 'the sold-out ask-for-price set is in view')
    const setsHidden = await loadListing(
      source(rows),
      { kind: 'category', slug: 'sets' },
      parseListingQuery(sp('soldout=hide')),
      '/c',
    )
    assert.ok(setsHidden.kind === 'ok')
    assert.strictEqual(setsHidden.allPriced, true)
  })
})
