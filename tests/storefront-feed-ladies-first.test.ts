/**
 * ZP-1019: ladies' pieces first. A category can be set to "Show after ladies'
 * pieces in the feed" (Category.showLastInFeed). The main feed is then:
 * available pieces of the other categories, then available pieces of the
 * flagged categories, then sold-out pieces, each group in today's order
 * (a stable partition after the ranking / newest order).
 * - partitionShowLast / showLastCategorySlugs (src/lib/storefront/feed.ts)
 * - feedProducts in NEWEST and AUTO modes, collection tabs unchanged
 * - the category API validation (parseCategoryInput) and the public category DTO
 * - the migration (column NOT NULL DEFAULT false)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  feedProducts,
  filterFeed,
  partitionShowLast,
  showLastCategorySlugs,
} from '../src/lib/storefront/feed'
import { toPublicCategory, type PublicImage, type PublicProduct } from '../src/lib/storefront/dto'
import { parseCategoryInput } from '../src/lib/website/validation'

const ROOT = path.join(__dirname, '..')
const HEX = 'a'.repeat(32)

function image(): PublicImage {
  return { url: `/api/images/public/${HEX}.webp`, srcSet: `/api/images/public/${HEX}.webp?w=320 320w`, alt: 'photo', width: null, height: null }
}

function piece(slug: string, category: string, overrides: Partial<PublicProduct> = {}): PublicProduct {
  return {
    slug,
    name: slug,
    description: null,
    category: { slug: category, name: category },
    colours: null,
    sizes: null,
    availability: 'IN_STOCK',
    images: [image()],
    isNew: false,
    featured: false,
    priceUsd: null,
    ref: `V-${slug}`,
    ...overrides,
  }
}

const slugs = (items: readonly { slug: string }[]) => items.map((p) => p.slug)
const MEN_GIRLS = new Set(['men', 'girls'])

describe('partitionShowLast', () => {
  test('no flagged category: the order is unchanged', () => {
    const input = [piece('a', 'dresses'), piece('b', 'men'), piece('c', 'tops'), piece('s', 'girls', { availability: 'SOLD_OUT' })]
    assert.deepStrictEqual(slugs(partitionShowLast(input, new Set())), ['a', 'b', 'c', 's'])
  })

  test('every category flagged: the order is unchanged', () => {
    const input = [piece('a', 'men'), piece('b', 'girls'), piece('c', 'men', { availability: 'FEW_LEFT' }), piece('s', 'girls', { availability: 'SOLD_OUT' })]
    assert.deepStrictEqual(slugs(partitionShowLast(input, MEN_GIRLS)), ['a', 'b', 'c', 's'])
  })

  test('mixed with sold-out: ladies, then Men and Girls, then sold-out (not split by the flag)', () => {
    const input = [
      piece('girls-new', 'girls'),
      piece('men-new', 'men'),
      piece('dress-1', 'dresses'),
      piece('men-few', 'men', { availability: 'FEW_LEFT' }),
      piece('top-few', 'tops', { availability: 'FEW_LEFT' }),
      piece('sold-men', 'men', { availability: 'SOLD_OUT' }),
      piece('sold-dress', 'dresses', { availability: 'SOLD_OUT' }),
    ]
    assert.deepStrictEqual(slugs(partitionShowLast(input, MEN_GIRLS)), [
      'dress-1',
      'top-few',
      'girls-new',
      'men-new',
      'men-few',
      'sold-men',
      'sold-dress',
    ])
  })

  test('keeps the order inside each group (stable), also when sold-out pieces are interleaved', () => {
    const input = [
      piece('m1', 'men'),
      piece('l1', 'dresses'),
      piece('s1', 'dresses', { availability: 'SOLD_OUT' }),
      piece('g1', 'girls'),
      piece('l2', 'tops'),
      piece('s2', 'men', { availability: 'SOLD_OUT' }),
      piece('m2', 'men'),
      piece('l3', 'dresses'),
    ]
    assert.deepStrictEqual(slugs(partitionShowLast(input, MEN_GIRLS)), ['l1', 'l2', 'l3', 'm1', 'g1', 'm2', 's1', 's2'])
  })

  test('returns a new array and does not change its input; accepts any iterable of slugs', () => {
    const input = [piece('m', 'men'), piece('l', 'dresses')]
    const out = partitionShowLast(input, ['men'])
    assert.notStrictEqual(out, input)
    assert.deepStrictEqual(slugs(input), ['m', 'l'])
    assert.deepStrictEqual(slugs(out), ['l', 'm'])
    assert.deepStrictEqual(partitionShowLast([], MEN_GIRLS), [])
  })
})

describe('showLastCategorySlugs', () => {
  test('the slugs of the categories with the flag; a missing flag is false', () => {
    const set = showLastCategorySlugs([
      { slug: 'dresses', showLastInFeed: false },
      { slug: 'men', showLastInFeed: true },
      { slug: 'tops' },
      { slug: 'girls', showLastInFeed: true },
    ])
    assert.deepStrictEqual([...set].sort(), ['girls', 'men'])
  })
})

describe('feedProducts with flagged categories', () => {
  // Newest published first; Men and Girls were just published (no rank yet).
  const newestFirst = [
    piece('girls-new', 'girls'),
    piece('men-new', 'men'),
    piece('dress-a', 'dresses'),
    piece('dress-b', 'dresses'),
    piece('men-old', 'men'),
    piece('no-photo', 'dresses', { images: [] }),
    piece('top-sold', 'tops', { availability: 'SOLD_OUT' }),
    piece('men-sold', 'men', { availability: 'SOLD_OUT' }),
  ]

  test('NEWEST: ladies newest first, then Men/Girls newest first, then sold-out', () => {
    const out = feedProducts(newestFirst, { mode: 'NEWEST', ranks: {} }, MEN_GIRLS)
    assert.deepStrictEqual(slugs(out), ['dress-a', 'dress-b', 'girls-new', 'men-new', 'men-old', 'top-sold', 'men-sold'])
  })

  test('AUTO: cold start and ranks keep their relative order inside each group', () => {
    const ranks = { 'V-dress-b': 1, 'V-men-old': 2, 'V-dress-a': 3, 'V-men-sold': 4, 'V-top-sold': 5 }
    const today = feedProducts(newestFirst, { mode: 'AUTO', ranks })
    assert.deepStrictEqual(slugs(today), ['girls-new', 'men-new', 'dress-b', 'men-old', 'dress-a', 'men-sold', 'top-sold'])
    const out = feedProducts(newestFirst, { mode: 'AUTO', ranks }, MEN_GIRLS)
    assert.deepStrictEqual(slugs(out), ['dress-b', 'dress-a', 'girls-new', 'men-new', 'men-old', 'men-sold', 'top-sold'])
  })

  test('AUTO: an unranked ladies piece (cold start) still comes before ranked ladies pieces', () => {
    const input = [piece('men-new', 'men'), piece('dress-new', 'dresses'), piece('dress-old', 'dresses')]
    const out = feedProducts(input, { mode: 'AUTO', ranks: { 'V-dress-old': 1 } }, MEN_GIRLS)
    assert.deepStrictEqual(slugs(out), ['dress-new', 'dress-old', 'men-new'])
  })

  test('without flags (or without the argument) the order is today\'s', () => {
    const ranking = { mode: 'AUTO' as const, ranks: { 'V-dress-b': 1 } }
    assert.deepStrictEqual(slugs(feedProducts(newestFirst, ranking, new Set())), slugs(feedProducts(newestFirst, ranking)))
  })

  test('collection feeds (?c=<slug>) are unchanged: one category keeps today\'s order', () => {
    const ranking = { mode: 'AUTO' as const, ranks: { 'V-men-old': 1, 'V-men-sold': 2 } }
    const today = feedProducts(newestFirst, ranking)
    const flagged = feedProducts(newestFirst, ranking, MEN_GIRLS)
    for (const tab of ['men', 'girls', 'dresses', 'tops']) {
      assert.deepStrictEqual(slugs(filterFeed(flagged, tab)), slugs(filterFeed(today, tab)), tab)
    }
  })
})

describe('category API validation: showLastInFeed', () => {
  test('true / false accepted on create and update', () => {
    assert.deepStrictEqual(parseCategoryInput({ name: 'Men', showLastInFeed: true }, { create: true }), {
      ok: true,
      data: { name: 'Men', showLastInFeed: true },
    })
    assert.deepStrictEqual(parseCategoryInput({ showLastInFeed: false }, { create: false }), {
      ok: true,
      data: { showLastInFeed: false },
    })
  })

  test('absent: not set (the column default, false, applies on create)', () => {
    const r = parseCategoryInput({ name: 'Dresses' }, { create: true })
    assert.ok(r.ok)
    if (r.ok) assert.ok(!('showLastInFeed' in r.data))
  })

  test('anything but a boolean is refused, with the field', () => {
    for (const bad of ['true', 1, 0, null, {}, []]) {
      const r = parseCategoryInput({ showLastInFeed: bad }, { create: false })
      assert.strictEqual(r.ok, false, JSON.stringify(bad))
      if (!r.ok) assert.strictEqual(r.field, 'showLastInFeed')
    }
  })
})

describe('public category DTO', () => {
  test('carries showLastInFeed (false when missing)', () => {
    const base = { slug: 'men', name: 'Men', description: null, heroImageKey: null }
    assert.strictEqual(toPublicCategory({ ...base, showLastInFeed: true }).showLastInFeed, true)
    assert.strictEqual(toPublicCategory({ ...base, showLastInFeed: false }).showLastInFeed, false)
    assert.strictEqual(toPublicCategory(base).showLastInFeed, false)
  })

  test('the storefront selects the column', () => {
    const queries = readFileSync(path.join(ROOT, 'src/lib/storefront/queries.ts'), 'utf8')
    assert.match(queries, /const CATEGORY_SELECT = \{[^}]*showLastInFeed: true/)
  })
})

describe('migration: category_show_last_in_feed', () => {
  test('one column, NOT NULL DEFAULT false, nothing else; schema in step', () => {
    const sql = readFileSync(path.join(ROOT, 'prisma/migrations/20261121090000_category_show_last_in_feed/migration.sql'), 'utf8')
    assert.match(sql, /ALTER TABLE "Category" ADD COLUMN\s+"showLastInFeed" BOOLEAN NOT NULL DEFAULT false;/)
    const statements = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
    assert.strictEqual(statements.length, 1)
    const schema = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8')
    assert.match(schema, /model Category \{[^}]*showLastInFeed\s+Boolean\s+@default\(false\)/)
  })
})
