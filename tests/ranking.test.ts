// ZP-506: popularity score and feed ranking, pure parts (no database).
// - Score maths: attention / curiosity / intent indices, weights, 100 = average.
// - Bayesian smoothing toward the catalogue mean, exponential decay, the window.
// - Fallback when there is too little data.
// - Cold-start boost, exploration slots (deterministic per day), sold-out last.
// - Featured = top N by score (available, with a photo).
// - The storefront feed order from the stored ranks, and the "Newest first" switch.
// - The admin Featured policy (read-only while ranking is automatic).
// - "Use as first photo" gallery order.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  AUTO_FEATURED_COUNT,
  COLD_START_BOOST,
  COLD_START_DAYS,
  CURIOSITY_WEIGHTS,
  INTENT_WEIGHTS,
  RANKING_HALF_LIFE_DAYS,
  RANKING_MIN_TOTAL_VIEWS,
  RANKING_MIN_VIEWS,
  RANKING_WINDOW_DAYS,
  SCORE_WEIGHTS,
  SIGNAL_INDEX_CAP,
  computeScores,
  decayWeight,
  rankingWindow,
  type PieceDayRow,
} from '../src/lib/ranking/score'
import { coldStartBoost, explorationSlot, rankForDay, seededRandom, type RankCandidate } from '../src/lib/ranking/order'
import { orderFeedByRanking, type FeedRanking } from '../src/lib/ranking/feed-order'
import { coverFirstOrder, featuredPatchCheck } from '../src/lib/ranking/featured'
import { feedProducts } from '../src/lib/storefront/feed'
import type { PublicProduct } from '../src/lib/storefront/dto'

const TODAY = '2035-03-29'
const YESTERDAY = '2035-03-28'
const NOW = new Date('2035-03-29T08:00:00Z')

function day(offsetFromYesterday: number): string {
  const d = new Date(`${YESTERDAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - offsetFromYesterday)
  return d.toISOString().slice(0, 10)
}

function row(productId: number, data: Partial<PieceDayRow> = {}): PieceDayRow {
  return {
    productId,
    day: YESTERDAY,
    views: 0,
    viewers: 0,
    dwellSeconds: 0,
    dwellCount: 0,
    photoSwipers: 0,
    detailsShows: 0,
    productOpens: 0,
    enquiries: 0,
    restockRequests: 0,
    shares: 0,
    loveOn: 0,
    loveOff: 0,
    ...data,
  }
}

/** A "typical" day for a piece: n views, mean dwell `dwell`, and fixed rates. */
function typical(productId: number, n: number, overrides: Partial<PieceDayRow> = {}): PieceDayRow {
  return row(productId, {
    views: n,
    viewers: n,
    dwellSeconds: n * 5,
    dwellCount: n,
    photoSwipers: Math.round(n * 0.3),
    detailsShows: Math.round(n * 0.2),
    productOpens: Math.round(n * 0.1),
    enquiries: Math.round(n * 0.02),
    restockRequests: 0,
    shares: Math.round(n * 0.01),
    loveOn: Math.round(n * 0.05),
    ...overrides,
  })
}

const byId = (r: ReturnType<typeof computeScores>) => new Map(r.pieces.map((p) => [p.productId, p]))
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

describe('ranking constants', () => {
  test('weights are the documented ones and add up to 1', () => {
    assert.deepStrictEqual(SCORE_WEIGHTS, { attention: 0.4, curiosity: 0.35, intent: 0.25 })
    close(SCORE_WEIGHTS.attention + SCORE_WEIGHTS.curiosity + SCORE_WEIGHTS.intent, 1)
    close(Object.values(CURIOSITY_WEIGHTS).reduce((a, b) => a + b, 0), 1)
    close(Object.values(INTENT_WEIGHTS).reduce((a, b) => a + b, 0), 1)
    assert.ok(INTENT_WEIGHTS.stars <= 0.15, 'review stars are a small quality factor')
    assert.strictEqual(RANKING_WINDOW_DAYS, 28)
    assert.strictEqual(RANKING_HALF_LIFE_DAYS, 14)
    assert.strictEqual(RANKING_MIN_VIEWS, 50)
    assert.strictEqual(RANKING_MIN_TOTAL_VIEWS, 200)
    assert.strictEqual(COLD_START_DAYS, 7)
    assert.strictEqual(AUTO_FEATURED_COUNT, 6)
  })
})

describe('decay and window', () => {
  test('half-life 14 days', () => {
    close(decayWeight(0), 1)
    close(decayWeight(14), 0.5)
    close(decayWeight(28), 0.25)
    close(decayWeight(7), Math.SQRT1_2)
  })
  test('window = the 28 analytics days ending yesterday', () => {
    assert.deepStrictEqual(rankingWindow(TODAY), { first: day(27), last: YESTERDAY })
  })
  test('rows outside the window are ignored (older than 28 days, today, future)', () => {
    const base = [typical(1, 300), typical(2, 300)]
    const withNoise = [
      ...base,
      typical(1, 5000, { day: day(28), dwellSeconds: 5000 * 60 }),
      typical(1, 5000, { day: TODAY, dwellSeconds: 5000 * 60 }),
    ]
    const a = byId(computeScores({ productIds: [1, 2], rows: base, today: TODAY }))
    const b = byId(computeScores({ productIds: [1, 2], rows: withNoise, today: TODAY }))
    close(a.get(1)!.score, b.get(1)!.score)
    assert.strictEqual(b.get(1)!.views, 300)
  })
})

describe('score maths', () => {
  test('identical pieces all score 100 (the catalogue average)', () => {
    const r = computeScores({ productIds: [1, 2, 3], rows: [typical(1, 200), typical(2, 200), typical(3, 200)], today: TODAY })
    for (const p of r.pieces) {
      close(p.score, 100)
      close(p.parts.attention, 1)
      close(p.parts.curiosity, 1)
      close(p.parts.intent, 1)
    }
  })

  test('a piece without views scores exactly 100 (pure prior)', () => {
    const r = byId(computeScores({ productIds: [1, 2, 9], rows: [typical(1, 300), typical(2, 300, { dwellSeconds: 300 * 9 })], today: TODAY }))
    close(r.get(9)!.score, 100)
    assert.strictEqual(r.get(9)!.views, 0)
    close(r.get(9)!.parts.evidence, 0)
  })

  test('attention: mean dwell against the catalogue mean, smoothed, weight 40%', () => {
    const n = 1000
    const rows = [typical(1, n, { dwellSeconds: n * 10 }), typical(2, n, { dwellSeconds: n * 5 })]
    const r = byId(computeScores({ productIds: [1, 2], rows, today: TODAY }))
    const mean = 7.5 // pooled: (10n + 5n) / 2n
    const expectedIndex = (n * 10 + RANKING_MIN_VIEWS * mean) / (n + RANKING_MIN_VIEWS) / mean
    close(r.get(1)!.parts.signals.dwell.index, expectedIndex)
    close(r.get(1)!.parts.attention, expectedIndex)
    close(r.get(1)!.score, 100 * (0.4 * expectedIndex + 0.35 + 0.25))
    assert.ok(r.get(1)!.score > r.get(2)!.score)
    close(r.get(1)!.parts.signals.dwell.raw!, 10)
  })

  test('curiosity: photo-swipe, Show details and open rates, weight 35%', () => {
    const n = 1000
    const rows = [typical(1, n, { detailsShows: 400 }), typical(2, n, { detailsShows: 200 })]
    const r = byId(computeScores({ productIds: [1, 2], rows, today: TODAY }))
    const pooled = 600 / 2000
    const idx = (400 + RANKING_MIN_VIEWS * pooled) / (n + RANKING_MIN_VIEWS) / pooled
    close(r.get(1)!.parts.signals.details.index, idx)
    close(r.get(1)!.parts.curiosity, CURIOSITY_WEIGHTS.photoSwipe + CURIOSITY_WEIGHTS.details * idx + CURIOSITY_WEIGHTS.open)
    close(r.get(1)!.score, 100 * (0.4 + 0.35 * r.get(1)!.parts.curiosity + 0.25))
  })

  test('intent: WhatsApp, restock, shares, loves per view and review stars, weight 25%', () => {
    const n = 1000
    const rows = [typical(1, n, { enquiries: 60 }), typical(2, n, { enquiries: 20 })]
    const r = byId(computeScores({ productIds: [1, 2], rows, today: TODAY }))
    assert.ok(r.get(1)!.parts.intent > 1 && r.get(2)!.parts.intent < 1)
    assert.ok(r.get(1)!.score > r.get(2)!.score)
    close(r.get(1)!.score, 100 * (0.4 + 0.35 + 0.25 * r.get(1)!.parts.intent))
  })

  test('loves count net (on minus off), never below zero', () => {
    const n = 500
    const rows = [typical(1, n, { loveOn: 10, loveOff: 40 }), typical(2, n, { loveOn: 40, loveOff: 0 })]
    const r = byId(computeScores({ productIds: [1, 2], rows, today: TODAY }))
    assert.strictEqual(r.get(1)!.parts.signals.loves.raw, 0)
    assert.ok(r.get(2)!.parts.signals.loves.index > 1)
  })

  test('review stars are a small smoothed quality factor; no reviews anywhere = neutral', () => {
    const rows = [typical(1, 500), typical(2, 500)]
    const none = byId(computeScores({ productIds: [1, 2], rows, today: TODAY }))
    close(none.get(1)!.parts.signals.stars.index, 1)
    const r = byId(
      computeScores({
        productIds: [1, 2],
        rows,
        today: TODAY,
        reviews: [
          { productId: 1, count: 10, starsSum: 50 },
          { productId: 2, count: 10, starsSum: 30 },
        ],
      }),
    )
    assert.ok(r.get(1)!.score > r.get(2)!.score)
    // Small: even 5.0 vs 3.0 stars moves the score by only a few points.
    assert.ok(r.get(1)!.score - r.get(2)!.score < 10)
  })

  test('one extreme signal is capped', () => {
    const rows = [typical(1, 2000, { shares: 2000 }), typical(2, 2000, { shares: 0 }), typical(3, 2000, { shares: 0 })]
    const r = byId(computeScores({ productIds: [1, 2, 3], rows, today: TODAY }))
    assert.ok(r.get(1)!.parts.signals.shares.index <= SIGNAL_INDEX_CAP)
  })

  test('fair to position: rates, not raw views (10x the views at the same rates = the same score)', () => {
    const rows = [typical(1, 2000), typical(2, 200)]
    const r = byId(computeScores({ productIds: [1, 2], rows, today: TODAY }))
    close(r.get(1)!.score, r.get(2)!.score, 0.5)
  })
})

describe('smoothing (no early stars)', () => {
  test('3 lucky views do not top 300 good ones', () => {
    const rows = [
      // 3 views, everything maxed out.
      row(1, { views: 3, viewers: 3, dwellSeconds: 180, dwellCount: 3, photoSwipers: 3, detailsShows: 3, productOpens: 3, enquiries: 3, shares: 3, loveOn: 3 }),
      // 300 views, clearly better than average.
      typical(2, 300, { dwellSeconds: 300 * 9, detailsShows: 120, enquiries: 15 }),
      typical(3, 3000),
    ]
    const r = byId(computeScores({ productIds: [1, 2, 3], rows, today: TODAY }))
    assert.ok(r.get(2)!.score > r.get(1)!.score, `${r.get(2)!.score} vs ${r.get(1)!.score}`)
    assert.ok(r.get(1)!.parts.evidence < 0.1)
  })

  test('evidence = n / (n + 50) of the decayed views', () => {
    const r = byId(computeScores({ productIds: [1, 2], rows: [typical(1, 50), typical(2, 100)], today: TODAY }))
    close(r.get(1)!.parts.evidence, 0.5)
  })
})

describe('decay (recent counts more)', () => {
  test('a piece that is good now beats one that was good four weeks ago', () => {
    const good = (id: number, d: string) => typical(id, 200, { day: d, dwellSeconds: 200 * 10, detailsShows: 80, enquiries: 10 })
    const poor = (id: number, d: string) => typical(id, 200, { day: d, dwellSeconds: 200 * 3, detailsShows: 10, enquiries: 0 })
    const rows = [good(1, day(26)), poor(1, day(0)), poor(2, day(26)), good(2, day(0)), typical(3, 400)]
    const r = byId(computeScores({ productIds: [1, 2, 3], rows, today: TODAY }))
    assert.ok(r.get(2)!.score > r.get(1)!.score)
    // Views are raw (not decayed) counts in the window.
    assert.strictEqual(r.get(1)!.views, 400)
  })
})

describe('fallback (too little data)', () => {
  test(`fewer than ${RANKING_MIN_TOTAL_VIEWS} views in the window is not enough`, () => {
    assert.strictEqual(computeScores({ productIds: [1, 2], rows: [typical(1, 100), typical(2, 99)], today: TODAY }).enough, false)
    const r = computeScores({ productIds: [1, 2], rows: [typical(1, 100), typical(2, 100)], today: TODAY })
    assert.strictEqual(r.enough, true)
    assert.strictEqual(r.totalViews, 200)
  })
  test('views of pieces that are not candidates (unpublished) do not count', () => {
    const r = computeScores({ productIds: [1], rows: [typical(1, 100), typical(7, 500)], today: TODAY })
    assert.strictEqual(r.totalViews, 100)
    assert.deepStrictEqual(r.pieces.map((p) => p.productId), [1])
  })
})

// ------------------------------------------------------------------ order

function cand(productId: number, score: number, extra: Partial<RankCandidate> = {}): RankCandidate {
  return { productId, score, views: 500, publishedAt: new Date('2035-01-01T00:00:00Z'), soldOut: false, hasPhoto: true, newestIndex: productId, ...extra }
}

describe('cold start', () => {
  test('a new piece gets a boost that fades over 7 days, until it has 50 views', () => {
    const oneDay = cand(1, 100, { publishedAt: new Date(NOW.getTime() - 86_400_000), views: 10 })
    close(coldStartBoost(oneDay, NOW), COLD_START_BOOST * (6 / 7))
    close(coldStartBoost({ ...oneDay, publishedAt: NOW }, NOW), COLD_START_BOOST)
    assert.strictEqual(coldStartBoost({ ...oneDay, views: RANKING_MIN_VIEWS }, NOW), 0)
    assert.strictEqual(coldStartBoost({ ...oneDay, publishedAt: new Date(NOW.getTime() - 8 * 86_400_000) }, NOW), 0)
    assert.strictEqual(coldStartBoost({ ...oneDay, publishedAt: null }, NOW), 0)
  })
  test('the boost lifts a new piece above established average ones', () => {
    const cands = [cand(1, 110), cand(2, 100), cand(3, 95), cand(4, 100, { publishedAt: NOW, views: 0, newestIndex: 0 })]
    const { order, coldStart } = rankForDay(cands, { day: TODAY, now: NOW, enough: true })
    assert.deepStrictEqual(order.slice(0, 2), [4, 1])
    assert.deepStrictEqual([...coldStart], [4])
  })
})

describe('exploration slots', () => {
  const many = Array.from({ length: 20 }, (_, i) => cand(i + 1, 200 - i))
  test('every 5th slot is an exploration slot', () => {
    assert.deepStrictEqual(
      Array.from({ length: 11 }, (_, i) => explorationSlot(i)),
      [false, false, false, false, true, false, false, false, false, true, false],
    )
  })
  test('other slots take the best remaining piece; exploration slots promote a lower one', () => {
    const { order } = rankForDay(many, { day: TODAY, now: NOW, enough: true })
    assert.strictEqual(order.length, 20)
    assert.deepStrictEqual(new Set(order).size, 20)
    assert.deepStrictEqual(order.slice(0, 4), [1, 2, 3, 4])
    const placed: number[] = []
    order.forEach((id, i) => {
      const remaining = many.map((c) => c.productId).filter((x) => !placed.includes(x))
      if (!explorationSlot(i)) assert.strictEqual(id, remaining[0], `slot ${i}`)
      else if (remaining.length > 1) assert.notStrictEqual(id, remaining[0], `exploration slot ${i}`)
      placed.push(id)
    })
  })
  test('deterministic per day: the same day gives the same order, other days can differ', () => {
    const a = rankForDay(many, { day: TODAY, now: NOW, enough: true }).order
    const b = rankForDay([...many].reverse(), { day: TODAY, now: NOW, enough: true }).order
    assert.deepStrictEqual(a, b)
    const days = ['2035-03-30', '2035-03-31', '2035-04-01', '2035-04-02', '2035-04-03']
    assert.ok(days.some((d) => rankForDay(many, { day: d, now: NOW, enough: true }).order.join() !== a.join()))
  })
  test('seededRandom is stable and in [0, 1)', () => {
    const r1 = seededRandom('x')
    const r2 = seededRandom('x')
    for (let i = 0; i < 50; i++) {
      const v = r1()
      assert.strictEqual(v, r2())
      assert.ok(v >= 0 && v < 1)
    }
  })
})

describe('order rules', () => {
  test('sold-out pieces go last (by score among themselves)', () => {
    const cands = [cand(1, 300, { soldOut: true }), cand(2, 100), cand(3, 200), cand(4, 250, { soldOut: true })]
    assert.deepStrictEqual(rankForDay(cands, { day: TODAY, now: NOW, enough: true }).order, [3, 2, 1, 4])
  })
  test('not enough data: newest first (sold-out last), no ranks', () => {
    const cands = [cand(1, 300, { newestIndex: 2 }), cand(2, 100, { newestIndex: 0 }), cand(3, 200, { newestIndex: 1, soldOut: true })]
    const r = rankForDay(cands, { day: TODAY, now: NOW, enough: false })
    assert.deepStrictEqual(r.order, [2, 1, 3])
    assert.strictEqual(r.ranked, false)
  })
})

describe('automatic Featured', () => {
  test(`top ${AUTO_FEATURED_COUNT} by score, available pieces with a photo only, no cold-start or exploration effect`, () => {
    const cands = [
      ...Array.from({ length: 9 }, (_, i) => cand(i + 1, 100 + i)),
      cand(20, 999, { soldOut: true }),
      cand(21, 998, { hasPhoto: false }),
      cand(22, 50, { publishedAt: NOW, views: 0 }),
    ]
    const r = rankForDay(cands, { day: TODAY, now: NOW, enough: true })
    assert.deepStrictEqual(r.featured, [9, 8, 7, 6, 5, 4])
  })
  test('not enough data: the newest available pieces', () => {
    const cands = Array.from({ length: 8 }, (_, i) => cand(i + 1, 100 + i, { newestIndex: 10 - i }))
    const r = rankForDay(cands, { day: TODAY, now: NOW, enough: false })
    assert.deepStrictEqual(r.featured, [8, 7, 6, 5, 4, 3])
  })
  test('fewer pieces than N: all eligible', () => {
    assert.deepStrictEqual(rankForDay([cand(1, 1), cand(2, 2)], { day: TODAY, now: NOW, enough: true }).featured, [2, 1])
  })
})

// ------------------------------------------------------------------ storefront order

type P = Pick<PublicProduct, 'slug' | 'featured' | 'availability' | 'images'>
const IMG = { url: '/x.webp', srcSet: '', alt: '', width: null, height: null }
const p = (slug: string, extra: Partial<P> = {}): P => ({ slug, featured: false, availability: 'IN_STOCK', images: [IMG], ...extra })
const slugs = (list: { slug: string }[]) => list.map((x) => x.slug)

describe('feed order from the stored ranking', () => {
  const newest = [p('n1'), p('n2', { featured: true }), p('n3', { availability: 'SOLD_OUT' }), p('n4'), p('n5')]
  test('Newest first (switch): newest first, sold-out last, Featured has no precedence', () => {
    const ranking: FeedRanking = { mode: 'NEWEST', ranks: { n5: 1, n4: 2 } }
    assert.deepStrictEqual(slugs(orderFeedByRanking(newest, ranking)), ['n1', 'n2', 'n4', 'n5', 'n3'])
  })
  test('automatic, but no ranks yet (too little data): newest first', () => {
    assert.deepStrictEqual(slugs(orderFeedByRanking(newest, { mode: 'AUTO', ranks: {} })), ['n1', 'n2', 'n4', 'n5', 'n3'])
  })
  test('automatic: by rank; pieces published since the nightly run (no rank) first; sold-out last', () => {
    const ranking: FeedRanking = { mode: 'AUTO', ranks: { n5: 1, n3: 2, n4: 3, n2: 4 } }
    assert.deepStrictEqual(slugs(orderFeedByRanking(newest, ranking)), ['n1', 'n5', 'n4', 'n2', 'n3'])
  })
  test('feedProducts uses the ranking when given, leaves out pieces without photos', () => {
    const list = [...newest, p('n6', { images: [] })]
    assert.deepStrictEqual(slugs(feedProducts(list, { mode: 'AUTO', ranks: { n6: 1, n5: 2 } })), ['n1', 'n2', 'n4', 'n5', 'n3'])
  })
})

describe('admin Featured policy', () => {
  test('automatic ranking: Featured cannot be changed by hand (the same value is accepted and dropped)', () => {
    const changed = featuredPatchCheck({ featured: true, sizes: 'S' }, { auto: true, current: false })
    assert.strictEqual(changed.ok, false)
    if (!changed.ok) {
      assert.strictEqual(changed.field, 'featured')
      assert.match(changed.error, /automatically by popularity/)
    }
    const same = featuredPatchCheck({ featured: false, sizes: 'S' }, { auto: true, current: false })
    assert.deepStrictEqual(same, { ok: true, data: { sizes: 'S' } })
    assert.deepStrictEqual(featuredPatchCheck({ sizes: 'S' }, { auto: true, current: true }), { ok: true, data: { sizes: 'S' } })
  })
  test('Newest first: Featured is manual again', () => {
    assert.deepStrictEqual(featuredPatchCheck({ featured: true }, { auto: false, current: false }), { ok: true, data: { featured: true } })
  })
})

describe('"Use as first photo"', () => {
  test('moves the photo to the front, keeps the others in order', () => {
    assert.deepStrictEqual(coverFirstOrder([4, 7, 9, 2], 9), [9, 4, 7, 2])
    assert.deepStrictEqual(coverFirstOrder([4, 7], 4), [4, 7])
    assert.strictEqual(coverFirstOrder([4, 7], 5), null)
  })
})
