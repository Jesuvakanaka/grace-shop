/**
 * ZP-510: the feed's details bottom sheet, pure parts (src/lib/storefront/feed-sheet.ts).
 * - URL / history rules: ?d=<slug> while open, pushed on open, back closes,
 *   a landing ?d= gets an entry behind it, close reasons.
 * - Sheet mechanics: max height (visible viewport), drag-to-close, "More" pill, plain clicks.
 * - The content model (rating line, primary button, reviews links) and the
 *   lazily loaded extras DTO (public fields only, top 2 reviews without photos).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  buildSheetExtras,
  isOwnSheetEntry,
  isPlainClick,
  landingSheetHistory,
  sheetHistoryState,
  SHEET_CLOSE_REASONS,
  SHEET_DRAG_CLOSE_PX,
  SHEET_PARAM,
  sheetCloseMethod,
  sheetCloseReason,
  sheetDragCloses,
  sheetDragOffset,
  sheetHasMore,
  sheetLocation,
  sheetMaxHeight,
  sheetModel,
  sheetScrollStep,
  sheetSlugFromSearch,
  type SheetExtras,
} from '../src/lib/storefront/feed-sheet'
import type { FeedItem } from '../src/lib/storefront/feed'
import { telHref } from '../src/lib/storefront/product-enquiry'
import type { PublicProduct } from '../src/lib/storefront/dto'

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  slug: 'linen-dress',
  name: 'Linen Dress',
  category: 'Dresses',
  price: '$65',
  badge: null,
  soldOut: false,
  images: [{ src: '/i/a.webp', srcSet: '', alt: 'A' }],
  video: null,
  href: '/site/p/linen-dress',
  shareUrl: 'https://vyra.example/p/linen-dress',
  enquireHref: 'https://wa.me/263771234567?text=hi',
  loves: 4,
  ...over,
})

const product = (over: Partial<PublicProduct> = {}): PublicProduct => ({
  slug: 'linen-dress',
  name: 'Linen Dress',
  description: 'Soft linen.\nMidi length.',
  category: { slug: 'dresses', name: 'Dresses' },
  colours: 'Olive, Cream',
  sizes: 'S, M, L',
  availability: 'IN_STOCK',
  images: [],
  video: null,
  isNew: false,
  featured: false,
  priceUsd: 65,
  itemNumber: 'SECRET-1',
  ref: 'V-0042',
  loves: 4,
  ...over,
})

const contacts = { whatsappNumber: '+263 77 123 4567', enquiryTemplate: 'Hi, {product} ({url})', generalEnquiryMessage: 'Hi' }
const review = (i: number, photo = false) => ({
  stars: 5 - (i % 2),
  comment: `Comment ${i}`,
  name: `Name ${i}`,
  date: `2026-10-${String(20 - i).padStart(2, '0')}T10:00:00.000Z`,
  reply: i === 0 ? 'Thank you' : null,
  photo: photo ? { url: '/i/r.webp', srcSet: '', alt: 'r' } : null,
})

// ------------------------------------------------------------------ URL

describe('sheet URL (?d=<slug>)', () => {
  test('the parameter is "d"', () => {
    assert.strictEqual(SHEET_PARAM, 'd')
  })

  test('sheetSlugFromSearch: a valid slug, else null', () => {
    assert.strictEqual(sheetSlugFromSearch('?d=linen-dress'), 'linen-dress')
    assert.strictEqual(sheetSlugFromSearch('c=dresses&d=linen-dress'), 'linen-dress')
    assert.strictEqual(sheetSlugFromSearch(''), null)
    assert.strictEqual(sheetSlugFromSearch('?d='), null)
    assert.strictEqual(sheetSlugFromSearch('?d=Not%20A%20Slug'), null)
    assert.strictEqual(sheetSlugFromSearch('?d=../admin'), null)
  })

  test('sheetLocation adds / removes d and keeps the other parameters and the hash', () => {
    assert.strictEqual(sheetLocation('/', '', '', 'linen-dress'), '/?d=linen-dress')
    assert.strictEqual(sheetLocation('/site', '?c=dresses', '#look-linen-dress', 'linen-dress'), '/site?c=dresses&d=linen-dress#look-linen-dress')
    assert.strictEqual(sheetLocation('/site', '?c=dresses&d=linen-dress', '#look-linen-dress', null), '/site?c=dresses#look-linen-dress')
    assert.strictEqual(sheetLocation('/', '?d=linen-dress', '', null), '/')
    assert.strictEqual(sheetLocation('/', '?d=old', '', 'new-one'), '/?d=new-one')
  })

  test('landingSheetHistory: a page opened with ?d= gets the feed entry behind the sheet entry', () => {
    assert.deepStrictEqual(landingSheetHistory('/site', '?c=dresses&d=linen-dress', '#look-linen-dress'), {
      slug: 'linen-dress',
      replace: '/site?c=dresses#look-linen-dress',
      push: '/site?c=dresses&d=linen-dress#look-linen-dress',
    })
    assert.strictEqual(landingSheetHistory('/', '?c=dresses', ''), null)
    assert.strictEqual(landingSheetHistory('/', '?d=%2F%2Fevil', ''), null)
  })

  test('our own sheet entry (back from the full page) is recognised by its history state marker', () => {
    assert.deepStrictEqual(sheetHistoryState('linen-dress'), { vyraSheet: 'linen-dress' })
    assert.strictEqual(isOwnSheetEntry({ __NA: true, vyraSheet: 'linen-dress' }, 'linen-dress'), true)
    assert.strictEqual(isOwnSheetEntry({ vyraSheet: 'other' }, 'linen-dress'), false)
    assert.strictEqual(isOwnSheetEntry(null, 'linen-dress'), false)
    assert.strictEqual(isOwnSheetEntry('x', 'linen-dress'), false)
  })

  test('closing goes back through history when there is a feed entry behind, else replaces', () => {
    assert.strictEqual(sheetCloseMethod(true), 'back')
    assert.strictEqual(sheetCloseMethod(false), 'replace')
  })

  test('close reasons: the UI reason when one is pending, else the browser back button', () => {
    assert.deepStrictEqual([...SHEET_CLOSE_REASONS], ['swipe', 'backdrop', 'button', 'back', 'escape'])
    assert.strictEqual(sheetCloseReason(null), 'back')
    assert.strictEqual(sheetCloseReason('swipe'), 'swipe')
    assert.strictEqual(sheetCloseReason('escape'), 'escape')
  })
})

// ------------------------------------------------------------ mechanics

describe('sheet mechanics', () => {
  test('max height: 62% of the visible viewport (visualViewport unless pinch-zoomed)', () => {
    assert.strictEqual(sheetMaxHeight({ innerHeight: 740, visualHeight: 640, visualScale: 1 }), 397)
    assert.strictEqual(sheetMaxHeight({ innerHeight: 740, visualHeight: null, visualScale: 1 }), 459)
    assert.strictEqual(sheetMaxHeight({ innerHeight: 740, visualHeight: 300, visualScale: 2 }), 459)
    assert.strictEqual(sheetMaxHeight({ innerHeight: 0, visualHeight: null, visualScale: 1 }), null)
  })

  test('drag: only downward counts; past the threshold it closes', () => {
    assert.strictEqual(sheetDragOffset(100, 80), 0)
    assert.strictEqual(sheetDragOffset(100, 150), 50)
    assert.strictEqual(SHEET_DRAG_CLOSE_PX, 90)
    assert.strictEqual(sheetDragCloses(90), false)
    assert.strictEqual(sheetDragCloses(91), true)
    assert.strictEqual(sheetDragCloses(0), false)
  })

  test('"More" pill and fade: while content continues below (24px slack)', () => {
    assert.strictEqual(sheetHasMore({ scrollTop: 0, clientHeight: 300, scrollHeight: 900 }), true)
    assert.strictEqual(sheetHasMore({ scrollTop: 580, clientHeight: 300, scrollHeight: 900 }), false)
    assert.strictEqual(sheetHasMore({ scrollTop: 575, clientHeight: 300, scrollHeight: 900 }), true)
    assert.strictEqual(sheetHasMore({ scrollTop: 0, clientHeight: 300, scrollHeight: 310 }), false)
  })

  test('the pill scrolls about 70% of the visible height', () => {
    assert.strictEqual(sheetScrollStep(300), 210)
    assert.strictEqual(sheetScrollStep(0), 0)
  })

  test('isPlainClick: the main button without modifiers (others open the page in a new tab)', () => {
    const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }
    assert.strictEqual(isPlainClick(base), true)
    assert.strictEqual(isPlainClick({ ...base, button: 1 }), false)
    assert.strictEqual(isPlainClick({ ...base, metaKey: true }), false)
    assert.strictEqual(isPlainClick({ ...base, ctrlKey: true }), false)
    assert.strictEqual(isPlainClick({ ...base, shiftKey: true }), false)
    assert.strictEqual(isPlainClick({ ...base, altKey: true }), false)
  })
})

// ----------------------------------------------------------------- call

describe('Call (tel:) links', () => {
  test('E.164: formatting stripped, a leading + or international 00 kept as +', () => {
    assert.strictEqual(telHref('+263 (77) 123-4567'), 'tel:+263771234567')
    assert.strictEqual(telHref('+971 56 874 3728'), 'tel:+971568743728')
    assert.strictEqual(telHref('00263 77 123 4567'), 'tel:+263771234567')
    assert.strictEqual(telHref('077 123 4567'), 'tel:0771234567')
    assert.strictEqual(telHref(''), null)
    assert.strictEqual(telHref('12'), null)
    assert.strictEqual(telHref(null), null)
  })
})

// -------------------------------------------------------------- extras

describe('buildSheetExtras (the lazily loaded part)', () => {
  const now = new Date('2026-10-21T12:00:00Z')

  test('public fields only: description, options, ref, availability, WhatsApp settings, visit', () => {
    const visit = { hours: null, week: ['Mon–Fri 09:00–17:30'], address: ['12 Main St'], holidayNote: null, directionsHref: null }
    const extras = buildSheetExtras(product(), { contacts: { ...contacts, phone: '+263 4 000' } as never, reviews: null, shop: null, visit, now })
    assert.deepStrictEqual(extras, {
      slug: 'linen-dress',
      description: 'Soft linen.\nMidi length.',
      colours: ['Olive', 'Cream'],
      sizes: ['S', 'M', 'L'],
      ref: 'V-0042',
      availability: 'IN_STOCK',
      contacts,
      reviews: { summary: null, top: [], shop: null },
      visit,
    })
    assert.ok(!JSON.stringify(extras).includes('SECRET-1'), 'never the item number')
    assert.ok(!JSON.stringify(extras).includes('+263 4 000'), 'only the WhatsApp fields of the contacts')
  })

  test('the first two approved reviews, without photos, formatted on the server', () => {
    const reviews = { summary: { average: 4.7, count: 3 }, reviews: [review(0, true), review(1), review(2)] }
    const extras = buildSheetExtras(product(), { contacts, reviews, shop: { average: 4.8, count: 36 }, visit: null, now })
    assert.strictEqual(extras.reviews.top.length, 2)
    assert.deepStrictEqual(extras.reviews.top[0], {
      stars: 5,
      starsText: '★★★★★',
      starsLabel: '5 out of 5 stars',
      comment: 'Comment 0',
      name: 'Name 0',
      date: 'Yesterday',
      dateTime: '2026-10-20T10:00:00.000Z',
      reply: 'Thank you',
    })
    assert.ok(!('photo' in extras.reviews.top[0]))
    assert.deepStrictEqual(extras.reviews.summary, { average: 4.7, count: 3 })
    assert.deepStrictEqual(extras.reviews.shop, { average: 4.8, count: 36 })
  })

  test('missing data is null / empty, never placeholder text', () => {
    const extras = buildSheetExtras(product({ description: '  ', colours: null, sizes: '', ref: undefined }), {
      contacts,
      reviews: null,
      shop: null,
      visit: null,
      now,
    })
    assert.strictEqual(extras.description, null)
    assert.deepStrictEqual(extras.colours, [])
    assert.deepStrictEqual(extras.sizes, [])
    assert.strictEqual(extras.ref, null)
    assert.strictEqual(extras.visit, null)
  })
})

// --------------------------------------------------------------- model

describe('sheetModel', () => {
  const extras = (over: Partial<SheetExtras> = {}): SheetExtras => ({
    slug: 'linen-dress',
    description: 'Soft linen.',
    colours: ['Olive'],
    sizes: ['S', 'M'],
    ref: 'V-0042',
    availability: 'IN_STOCK',
    contacts,
    reviews: { summary: { average: 4.7, count: 3 }, top: [], shop: { average: 4.8, count: 36 } },
    visit: null,
    ...over,
  })

  test('primary button: Enquire on WhatsApp / Ask about restock / Visit us', () => {
    assert.deepStrictEqual(sheetModel(item(), null).primary, { kind: 'enquire', label: 'Enquire on WhatsApp' })
    assert.deepStrictEqual(sheetModel(item({ soldOut: true }), null).primary, { kind: 'restock', label: 'Ask about restock' })
    assert.deepStrictEqual(sheetModel(item({ enquireHref: null }), null).primary, { kind: 'visit', label: 'Visit us' })
    assert.deepStrictEqual(sheetModel(item({ enquireHref: null, soldOut: true }), null).primary, { kind: 'visit', label: 'Visit us' })
  })

  test('rating: from the extras ("4.7 · 3 reviews" with stars), the feed caption until they arrive, else none', () => {
    assert.deepStrictEqual(sheetModel(item(), extras()).rating, {
      stars: '★★★★☆',
      text: '4.7 · 3 reviews',
      label: 'Rated 4.7 out of 5 from 3 reviews',
    })
    assert.deepStrictEqual(sheetModel(item({ rating: { text: '★ 4.7 (3)', label: 'Rated 4.7 out of 5 from 3 reviews' } }), null).rating, {
      stars: null,
      text: '★ 4.7 (3)',
      label: 'Rated 4.7 out of 5 from 3 reviews',
    })
    assert.strictEqual(sheetModel(item(), null).rating, null)
    assert.strictEqual(sheetModel(item(), extras({ reviews: { summary: null, top: [], shop: null } })).rating, null)
  })

  test('links: full page, reviews on the full page; "See all N reviews" only when there are more than shown', () => {
    const m = sheetModel(item(), extras())
    assert.strictEqual(m.fullPageHref, '/site/p/linen-dress')
    assert.deepStrictEqual(m.seeAll, { text: 'See all 3 reviews', href: '/site/p/linen-dress#reviews' })
    const two = sheetModel(item(), extras({ reviews: { summary: { average: 5, count: 2 }, top: [], shop: null } }))
    assert.strictEqual(two.seeAll, null)
  })

  test('shop rating line and whether the reviews block shows', () => {
    const m = sheetModel(item(), extras())
    assert.deepStrictEqual(m.shopRating, { text: 'VYRA shop rating 4.8 ★', label: 'Rated 4.8 out of 5 by 36 verified customers' })
    assert.strictEqual(m.showReviews, true)
    const none = sheetModel(item(), extras({ reviews: { summary: null, top: [], shop: null } }))
    assert.strictEqual(none.shopRating, null)
    assert.strictEqual(none.showReviews, false)
    assert.strictEqual(sheetModel(item(), null).showReviews, false)
  })
})
