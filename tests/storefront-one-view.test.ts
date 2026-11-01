/**
 * ZP-514: one view. The old pages fold into the flip feed and keep their
 * addresses (src/lib/storefront/one-view.ts):
 * - route -> feed state (collection tab, overlay: collections sheet / menu on About or Visit us);
 * - the history written when such an address lands (feed URL behind, the
 *   overlay entry `?o=<overlay>` on top, like the details sheet's `?d=`);
 * - the feed frame comes from the page (the feed marks itself), not the route;
 * - Visit us keeps its LocalBusiness JSON-LD.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  FEED_OVERLAYS,
  isOwnOverlayEntry,
  localBusinessJsonLd,
  OVERLAY_PARAM,
  overlayClose,
  overlayFromSearch,
  overlayHistoryState,
  oneViewHistory,
  routeLanding,
  withoutOverlay,
} from '../src/lib/storefront/one-view'
import { FEED_PAGE_ATTR, isFeedFrame } from '../src/lib/storefront/product-landing'

describe('route -> feed state', () => {
  test('/shop and /new: the feed on New in, no overlay', () => {
    assert.deepStrictEqual(routeLanding({ route: 'shop' }), { tab: 'new', overlay: null })
    assert.deepStrictEqual(routeLanding({ route: 'new' }), { tab: 'new', overlay: null })
  })
  test('/collections: New in with the collections sheet open', () => {
    assert.deepStrictEqual(routeLanding({ route: 'collections' }), { tab: 'new', overlay: 'collections' })
  })
  test('/collections/<slug>: that collection (?c= behaviour)', () => {
    assert.deepStrictEqual(routeLanding({ route: 'collection', slug: 'dresses' }), { tab: 'dresses', overlay: null })
  })
  test('/about and /visit: the menu open on that section', () => {
    assert.deepStrictEqual(routeLanding({ route: 'about' }), { tab: 'new', overlay: 'about' })
    assert.deepStrictEqual(routeLanding({ route: 'visit' }), { tab: 'new', overlay: 'visit' })
  })
})

describe('overlay URL (?o=)', () => {
  test('the parameter and its values', () => {
    assert.strictEqual(OVERLAY_PARAM, 'o')
    assert.deepStrictEqual([...FEED_OVERLAYS], ['collections', 'about', 'visit'])
  })
  test('overlayFromSearch: a known value, else null', () => {
    assert.strictEqual(overlayFromSearch('?o=about'), 'about')
    assert.strictEqual(overlayFromSearch('c=dresses&o=collections'), 'collections')
    assert.strictEqual(overlayFromSearch('?o=admin'), null)
    assert.strictEqual(overlayFromSearch(''), null)
  })
  test('our own overlay entry is recognised by its marker', () => {
    assert.deepStrictEqual(overlayHistoryState('visit'), { vyraOverlay: 'visit' })
    assert.strictEqual(isOwnOverlayEntry({ __NA: true, vyraOverlay: 'visit' }, 'visit'), true)
    assert.strictEqual(isOwnOverlayEntry({ vyraOverlay: 'about' }, 'visit'), false)
    assert.strictEqual(isOwnOverlayEntry(null, 'visit'), false)
  })
})

describe('review F1: closing an overlay', () => {
  test('withoutOverlay drops o and keeps everything else', () => {
    assert.strictEqual(withoutOverlay('/site', '?o=visit', ''), '/site')
    assert.strictEqual(withoutOverlay('/', '?c=dresses&o=about', '#look-a'), '/?c=dresses#look-a')
  })
  test('overlayClose: a followed link replaces (its own push must win); a close control pops our entry, else replaces', () => {
    assert.strictEqual(overlayClose({ cause: 'link', entryBehind: true }), 'replace')
    assert.strictEqual(overlayClose({ cause: 'link', entryBehind: false }), 'replace')
    assert.strictEqual(overlayClose({ cause: 'control', entryBehind: true }), 'back')
    assert.strictEqual(overlayClose({ cause: 'control', entryBehind: false }), 'replace')
  })
  test('review F3: the guide (?guide=1) wins over an overlay', () => {
    assert.strictEqual(overlayFromSearch('?o=about&guide=1'), null)
    assert.strictEqual(overlayFromSearch('?guide=1&o=collections'), null)
  })
})

describe('oneViewHistory: what a folded address becomes after hydration', () => {
  test('/shop -> the feed URL (replace only)', () => {
    assert.deepStrictEqual(oneViewHistory({ homePath: '/site', search: '', tab: 'new', overlay: null }), { replace: '/site', push: null })
  })
  test('/collections/dresses -> /?c=dresses', () => {
    assert.deepStrictEqual(oneViewHistory({ homePath: '/', search: '', tab: 'dresses', overlay: null }), { replace: '/?c=dresses', push: null })
  })
  test('/about -> feed behind, ?o=about on top (back closes the menu, not the site)', () => {
    assert.deepStrictEqual(oneViewHistory({ homePath: '/site', search: '', tab: 'new', overlay: 'about' }), {
      replace: '/site',
      push: '/site?o=about',
    })
  })
  test('campaign parameters kept; old c / d / o / preview / sort / page dropped', () => {
    assert.deepStrictEqual(
      oneViewHistory({ homePath: '/', search: '?utm_source=ig&sort=price&page=2&c=x&d=y&o=visit&preview=t', tab: 'new', overlay: 'collections' }),
      { replace: '/?utm_source=ig', push: '/?utm_source=ig&o=collections' },
    )
  })
})

describe('feed frame: decided by the page (the feed marks itself), never by the route segment', () => {
  test('home from the first render; folded routes through the feed marker only', () => {
    assert.strictEqual(isFeedFrame({ segment: null, pathname: '/' }), true)
    for (const segment of ['p', 'shop', 'new', 'collections', 'about', 'visit', 'privacy', 'review']) {
      assert.strictEqual(isFeedFrame({ segment, pathname: '/site' }), false, segment)
    }
    // A /collections/<unknown> 404 renders no feed, so it keeps the page frame with the top bar.
    assert.strictEqual(FEED_PAGE_ATTR, 'data-feed-page')
  })
})

describe('Visit us LocalBusiness JSON-LD', () => {
  const visit = {
    address: '12 Samora Machel Ave\nHarare',
    hours: {
      mon: { closed: false, open: '09:00', close: '17:30' },
      tue: { closed: false, open: '09:00', close: '17:30' },
      wed: { closed: false, open: '09:00', close: '17:30' },
      thu: { closed: false, open: '09:00', close: '17:30' },
      fri: { closed: false, open: '09:00', close: '17:30' },
      sat: { closed: false, open: '09:00', close: '14:00' },
      sun: { closed: true },
    } as const,
    latitude: -17.83,
    longitude: 31.05,
  }
  test('name, url, address, phone, geo, opening hours (open days only)', () => {
    const ld = localBusinessJsonLd({ url: 'https://vyra.example/visit', phone: '+263 77 123 4567', visit })
    assert.deepStrictEqual(ld, {
      '@context': 'https://schema.org',
      '@type': 'ClothingStore',
      name: 'VYRA',
      url: 'https://vyra.example/visit',
      telephone: '+263 77 123 4567',
      address: { '@type': 'PostalAddress', streetAddress: '12 Samora Machel Ave, Harare' },
      geo: { '@type': 'GeoCoordinates', latitude: -17.83, longitude: 31.05 },
      openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '17:30' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Saturday'], opens: '09:00', closes: '14:00' },
      ],
    })
  })
  test('review F4: a placeholder phone ("TBC") never reaches the JSON-LD', () => {
    const ld = localBusinessJsonLd({ url: null, phone: 'TBC', visit: { address: '12 Main St', hours: null, latitude: null, longitude: null } })
    assert.ok(ld && !('telephone' in ld))
  })
  test('missing parts are left out; nothing at all -> null', () => {
    const ld = localBusinessJsonLd({ url: null, phone: null, visit: { address: '12 Main St', hours: null, latitude: null, longitude: null } })
    assert.deepStrictEqual(ld, {
      '@context': 'https://schema.org',
      '@type': 'ClothingStore',
      name: 'VYRA',
      address: { '@type': 'PostalAddress', streetAddress: '12 Main St' },
    })
    assert.strictEqual(localBusinessJsonLd({ url: null, phone: null, visit: { address: null, hours: null, latitude: null, longitude: null } }), null)
  })
})
