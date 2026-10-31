// ZP-482: pure rules of the storefront (VYRA website) data model.
// No database: see storefront-model-db.test.ts for the Prisma helpers.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  SLUG_MAX_LENGTH,
  slugify,
  uniqueSlug,
  isValidSlug,
  planSlugChange,
  getAvailability,
  getPublishReadiness,
  displayName,
  publicPriceUsd,
  isNewArrival,
  NEW_ARRIVAL_DAYS,
  nextPublishState,
  imageKeyFromImageUrl,
  planPrimaryImage,
} from '../src/lib/storefront-model'

describe('slugify', () => {
  test('lowercases and joins words with single hyphens', () => {
    assert.strictEqual(slugify('Silk Wrap Dress'), 'silk-wrap-dress')
    assert.strictEqual(slugify('  Gold   hoop -- earrings  '), 'gold-hoop-earrings')
    assert.strictEqual(slugify('T-shirt / Tank (2 pack)'), 't-shirt-tank-2-pack')
  })

  test('folds accents to ASCII and drops other non-ASCII characters', () => {
    assert.strictEqual(slugify('Crème Brûlée Café'), 'creme-brulee-cafe')
    assert.match(slugify('Ærø straße'), /^[a-z0-9-]*$/)
    assert.strictEqual(slugify('连衣裙 dress 2024'), 'dress-2024')
    assert.strictEqual(slugify("Women's 100% cotton"), 'womens-100-cotton')
  })

  test('returns "" when nothing usable is left', () => {
    assert.strictEqual(slugify(''), '')
    assert.strictEqual(slugify('  !!! ---  '), '')
    assert.strictEqual(slugify('连衣裙'), '')
  })

  test(`is at most ${SLUG_MAX_LENGTH} characters and never ends with a hyphen`, () => {
    const long = slugify('word '.repeat(60))
    assert.ok(long.length <= SLUG_MAX_LENGTH, `length ${long.length}`)
    assert.ok(!long.endsWith('-'))
    assert.ok(isValidSlug(long))
    assert.strictEqual(slugify('a'.repeat(200)).length, SLUG_MAX_LENGTH)
  })

  test('its output always passes isValidSlug (or is empty)', () => {
    for (const s of ['Hello', 'a--b', '-x-', '9 Lives', 'ÉCLAIR', 'x'.repeat(81)]) {
      const out = slugify(s)
      assert.ok(out === '' || isValidSlug(out), `${s} -> ${out}`)
    }
  })
})

describe('isValidSlug', () => {
  test('accepts lowercase ascii words joined by single hyphens', () => {
    for (const ok of ['a', 'silk-dress', 'dress-2', '2024-collection']) assert.ok(isValidSlug(ok), ok)
  })
  test('rejects everything else', () => {
    for (const bad of ['', 'Silk', 'a--b', '-a', 'a-', 'a b', 'a_b', 'é', 'a/b', 'x'.repeat(81), null, 5]) {
      assert.ok(!isValidSlug(bad), String(bad))
    }
  })
})

describe('uniqueSlug', () => {
  test('returns the base when it is free', () => {
    assert.strictEqual(uniqueSlug('silk-dress', () => false), 'silk-dress')
  })

  test('appends -2, -3, ... until a free slug is found', () => {
    const taken = new Set(['silk-dress', 'silk-dress-2', 'silk-dress-3'])
    assert.strictEqual(uniqueSlug('silk-dress', (s) => taken.has(s)), 'silk-dress-4')
    assert.strictEqual(uniqueSlug('silk-dress', (s) => s === 'silk-dress'), 'silk-dress-2')
  })

  test('keeps a suffixed slug within the length limit', () => {
    const base = 'a'.repeat(SLUG_MAX_LENGTH)
    const out = uniqueSlug(base, (s) => s === base)
    assert.strictEqual(out.length, SLUG_MAX_LENGTH)
    assert.ok(out.endsWith('-2'))
    assert.ok(isValidSlug(out))
  })

  test('does not leave a hyphen before the suffix when truncating', () => {
    const base = `${'a'.repeat(SLUG_MAX_LENGTH - 2)}-b` // truncation would end on "-"
    const out = uniqueSlug(base, (s) => s === base)
    assert.ok(isValidSlug(out), out)
  })

  test('an empty base falls back to "product"', () => {
    assert.strictEqual(uniqueSlug('', () => false), 'product')
    assert.strictEqual(uniqueSlug('', (s) => s === 'product'), 'product-2')
  })

  test('normalises the base through slugify', () => {
    assert.strictEqual(uniqueSlug('Silk Dress', () => false), 'silk-dress')
  })
})

describe('planSlugChange (slug redirects without loops)', () => {
  const base = { productId: 7, currentSlug: 'old-name', liveOwnerId: null, redirectOwnerId: null }

  test('a new slug records the current slug as a redirect to this product', () => {
    assert.deepStrictEqual(planSlugChange({ ...base, newSlug: 'new-name' }), {
      ok: true,
      changed: true,
      slug: 'new-name',
      addRedirect: 'old-name',
      removeRedirect: null,
    })
  })

  test('setting the same slug again is a no-op', () => {
    assert.deepStrictEqual(planSlugChange({ ...base, newSlug: 'old-name', liveOwnerId: 7 }), {
      ok: true,
      changed: false,
      slug: 'old-name',
      addRedirect: null,
      removeRedirect: null,
    })
  })

  test('the first slug for a product adds no redirect', () => {
    const plan = planSlugChange({ ...base, currentSlug: null, newSlug: 'first' })
    assert.deepStrictEqual(plan, { ok: true, changed: true, slug: 'first', addRedirect: null, removeRedirect: null })
  })

  test("going back to one of the product's own old slugs removes that redirect (no self-loop)", () => {
    const plan = planSlugChange({ ...base, newSlug: 'older-name', redirectOwnerId: 7 })
    assert.deepStrictEqual(plan, {
      ok: true,
      changed: true,
      slug: 'older-name',
      addRedirect: 'old-name',
      removeRedirect: 'older-name',
    })
  })

  test('a slug that another product uses is refused', () => {
    const plan = planSlugChange({ ...base, newSlug: 'taken', liveOwnerId: 9 })
    assert.strictEqual(plan.ok, false)
    if (!plan.ok) assert.match(plan.error, /already used/i)
  })

  test("a slug that redirects to another product is refused (it would break that product's old links)", () => {
    const plan = planSlugChange({ ...base, newSlug: 'their-old', redirectOwnerId: 9 })
    assert.strictEqual(plan.ok, false)
    if (!plan.ok) assert.match(plan.error, /another product/i)
  })

  test('an input that is not a valid slug is normalised; one with nothing usable is refused', () => {
    const plan = planSlugChange({ ...base, newSlug: 'New Name!' })
    assert.ok(plan.ok && plan.slug === 'new-name')
    const bad = planSlugChange({ ...base, newSlug: '!!!' })
    assert.strictEqual(bad.ok, false)
  })
})

describe('getAvailability', () => {
  test('0 or less is SOLD_OUT', () => {
    assert.strictEqual(getAvailability(0), 'SOLD_OUT')
    assert.strictEqual(getAvailability(-2), 'SOLD_OUT')
  })
  test('1..threshold (default 3) is FEW_LEFT', () => {
    assert.strictEqual(getAvailability(1), 'FEW_LEFT')
    assert.strictEqual(getAvailability(3), 'FEW_LEFT')
  })
  test('above the threshold is IN_STOCK', () => {
    assert.strictEqual(getAvailability(4), 'IN_STOCK')
    assert.strictEqual(getAvailability(500), 'IN_STOCK')
  })
  test('the threshold can be changed', () => {
    assert.strictEqual(getAvailability(5, 5), 'FEW_LEFT')
    assert.strictEqual(getAvailability(6, 5), 'IN_STOCK')
    assert.strictEqual(getAvailability(1, 0), 'IN_STOCK')
  })
  test('missing or non-finite quantity is treated as sold out', () => {
    assert.strictEqual(getAvailability(null as unknown as number), 'SOLD_OUT')
    assert.strictEqual(getAvailability(NaN), 'SOLD_OUT')
  })
})

describe('getPublishReadiness', () => {
  const ready = {
    productName: 'Silk dress',
    publicName: null,
    images: [{ imageKey: 'products/0123456789abcdef0123456789abcdef.webp' }],
    category: { id: 1 },
  }

  test('a product with a name, an image and a category is ready', () => {
    assert.deepStrictEqual(getPublishReadiness(ready), { ready: true, missing: [] })
  })

  test('publicName alone is enough for the display name', () => {
    assert.deepStrictEqual(getPublishReadiness({ ...ready, productName: '  ', publicName: 'Silk dress' }), {
      ready: true,
      missing: [],
    })
  })

  test('lists every missing piece in a stable order', () => {
    assert.deepStrictEqual(getPublishReadiness({ productName: ' ', publicName: '', images: [], category: null }), {
      ready: false,
      missing: ['display name', 'image', 'category'],
    })
  })

  test('missing images or category relations count as missing', () => {
    assert.deepStrictEqual(getPublishReadiness({ productName: 'x' }), {
      ready: false,
      missing: ['image', 'category'],
    })
  })
})

describe('display helpers', () => {
  test('displayName prefers publicName and falls back to productName', () => {
    assert.strictEqual(displayName({ productName: 'ITEM 12', publicName: ' Silk dress ' }), 'Silk dress')
    assert.strictEqual(displayName({ productName: ' ITEM 12 ', publicName: '  ' }), 'ITEM 12')
    assert.strictEqual(displayName({ productName: 'ITEM 12', publicName: null }), 'ITEM 12')
  })

  test('publicPriceUsd is the selling price only with SHOW_PRICE and a price above 0', () => {
    assert.strictEqual(publicPriceUsd({ priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 25 }), 25)
    assert.strictEqual(publicPriceUsd({ priceDisplay: 'ASK_FOR_PRICE', sellingPriceUsd: 25 }), null)
    assert.strictEqual(publicPriceUsd({ priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 0 }), null)
  })

  test(`isNewArrival: published within the last ${NEW_ARRIVAL_DAYS} days`, () => {
    const now = new Date('2026-11-01T12:00:00Z')
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)
    assert.strictEqual(isNewArrival({ published: true, publishedAt: daysAgo(1) }, now), true)
    assert.strictEqual(isNewArrival({ published: true, publishedAt: daysAgo(NEW_ARRIVAL_DAYS) }, now), true)
    assert.strictEqual(isNewArrival({ published: true, publishedAt: daysAgo(NEW_ARRIVAL_DAYS + 0.01) }, now), false)
    assert.strictEqual(isNewArrival({ published: true, publishedAt: null }, now), false)
    assert.strictEqual(isNewArrival({ published: false, publishedAt: daysAgo(1) }, now), false)
    assert.strictEqual(isNewArrival({ published: true, publishedAt: daysAgo(10) }, now, 7), false)
  })

  test('nextPublishState sets publishedAt the first time only', () => {
    const now = new Date('2026-11-01T00:00:00Z')
    const earlier = new Date('2026-10-01T00:00:00Z')
    assert.deepStrictEqual(nextPublishState({ published: false, publishedAt: null }, true, now), {
      published: true,
      publishedAt: now,
    })
    // unpublishing keeps the date; republishing does not make it "new" again
    assert.deepStrictEqual(nextPublishState({ published: true, publishedAt: earlier }, false, now), {
      published: false,
      publishedAt: earlier,
    })
    assert.deepStrictEqual(nextPublishState({ published: false, publishedAt: earlier }, true, now), {
      published: true,
      publishedAt: earlier,
    })
  })
})

describe('image helpers', () => {
  const HASH = '0123456789abcdef0123456789abcdef'

  test('imageKeyFromImageUrl maps /api/images/<32 hex>.webp to the storage key', () => {
    assert.strictEqual(imageKeyFromImageUrl(`/api/images/${HASH}.webp`), `products/${HASH}.webp`)
  })

  test('imageKeyFromImageUrl returns null for anything else', () => {
    for (const bad of [null, '', 'https://x.test/a.webp', `/api/images/${HASH}.png`, `/api/images/../${HASH}.webp`, '/uploads/a.jpg']) {
      assert.strictEqual(imageKeyFromImageUrl(bad), null, String(bad))
    }
  })

  test('planPrimaryImage keeps a single existing primary', () => {
    const images = [
      { id: 1, sortOrder: 0, isPrimary: false },
      { id: 2, sortOrder: 1, isPrimary: true },
    ]
    assert.deepStrictEqual(planPrimaryImage(images), { primaryId: 2, demoteIds: [] })
  })

  test('planPrimaryImage picks the first by sortOrder, then id, when there is none', () => {
    const images = [
      { id: 5, sortOrder: 2, isPrimary: false },
      { id: 4, sortOrder: 1, isPrimary: false },
      { id: 3, sortOrder: 1, isPrimary: false },
    ]
    assert.deepStrictEqual(planPrimaryImage(images), { primaryId: 3, demoteIds: [] })
  })

  test('planPrimaryImage keeps the first of several primaries and demotes the rest', () => {
    const images = [
      { id: 8, sortOrder: 3, isPrimary: true },
      { id: 9, sortOrder: 1, isPrimary: true },
    ]
    assert.deepStrictEqual(planPrimaryImage(images), { primaryId: 9, demoteIds: [8] })
  })

  test('planPrimaryImage with no images has no primary', () => {
    assert.deepStrictEqual(planPrimaryImage([]), { primaryId: null, demoteIds: [] })
  })
})
