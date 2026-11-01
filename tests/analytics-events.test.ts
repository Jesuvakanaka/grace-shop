/**
 * ZP-493: first-party analytics, pure parts.
 * - The event allow-list and per-type prop schemas (src/lib/analytics/events.ts).
 * - validateEvent (shared by client and server) vs validateBatch (envelope:
 *   400; invalid events are dropped one by one, the rest kept).
 * - Batch limits, id formats, timestamps, zero-width characters.
 * - Bot / headless filter and GPC / DNT opt-out (src/lib/analytics/privacy.ts).
 * - Visit context: referrer bucket, campaign, device class, page (src/lib/analytics/context.ts).
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  ANALYTICS_EVENT_TYPES,
  EVENT_SPECS,
  MAX_BATCH_EVENTS,
  analyticsDay,
  validateBatch,
  validateEvent,
} from '../src/lib/analytics/events'
import { isAutomatedClient, isBotRequest, isOptedOutClient, isOptedOutRequest } from '../src/lib/analytics/privacy'
import { campaignFromSearch, deviceClass, normalizePage, visitSource } from '../src/lib/analytics/context'
import { decideHostRouting } from '../src/lib/host-routing'

const VISIT = '0b6f3c1e-8a3d-4f7e-9a51-2c1d4e5f6a7b'
const DEVICE = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const NOW = new Date('2026-11-01T10:00:00Z')
const AT = NOW.getTime() - 5_000
let idSeq = 0
const nextId = () => `e0e0e0e0-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`

function batch(events: unknown[], extra: Record<string, unknown> = {}) {
  return { v: 1, visit: VISIT, device: DEVICE, events, ...extra }
}
function ev(type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { id: nextId(), type, at: AT, page: '/', props, ...extra }
}
function ok(input: unknown) {
  const r = validateBatch(input, NOW)
  assert.ok(r.ok, `expected ok, got ${r.ok ? '' : r.error}`)
  return r
}
/** Envelope errors reject the whole batch. */
function badBatch(input: unknown, pattern?: RegExp) {
  const r = validateBatch(input, NOW)
  assert.strictEqual(r.ok, false, 'expected the batch to be rejected')
  if (pattern && !r.ok) assert.match(r.error, pattern)
}
/** Event errors: validateEvent returns the reason; in a batch the event is dropped. */
function badEvent(event: unknown, pattern?: RegExp) {
  const r = validateEvent(event, NOW)
  assert.strictEqual(typeof r, 'string', `expected ${JSON.stringify(event)} to be refused`)
  if (pattern) assert.match(r as string, pattern)
  const b = validateBatch(batch([event, ev('guide_shown')]), NOW)
  assert.ok(b.ok, 'one bad event does not reject the batch')
  assert.strictEqual(b.events.length, 1)
  assert.strictEqual(b.dropped, 1)
}

const VISIT_START = {
  ref: 'instagram',
  refDomain: 'l.instagram.com',
  campaign: 'nov-launch',
  device: 'phone',
  vw: 390,
  vh: 844,
  lang: 'en-ZW',
  landing: '/',
  returning: false,
}

describe('event catalogue', () => {
  test('lists every ZP-493 event, each with a spec', () => {
    const expected = [
      'visit_start', 'visit_end', 'look_view', 'look_dwell', 'photo_view', 'photo_dwell', 'video_start',
      'video_progress', 'video_replay', 'video_seconds', 'details_show', 'details_hide', 'collection_switch',
      'feed_load_more', 'feed_end_reached', 'product_open', 'size_select', 'colour_select', 'whatsapp_enquire',
      'restock_request', 'call', 'share', 'directions', 'visit_us', 'gallery_zoom', 'guide_shown', 'guide_step',
      'guide_skipped', 'guide_completed', 'guide_replayed', 'love_on', 'love_off', 'load_error', 'slow_load',
      'action_failed', 'details_sheet_open', 'details_sheet_close',
    ]
    assert.deepStrictEqual([...ANALYTICS_EVENT_TYPES].sort(), [...expected].sort())
    for (const t of expected) assert.ok(EVENT_SPECS[t as keyof typeof EVENT_SPECS], t)
  })

  test('at most 20 events per batch', () => {
    assert.strictEqual(MAX_BATCH_EVENTS, 20)
  })
})

describe('validateBatch: accepted', () => {
  test('a typical batch is normalised', () => {
    const r = ok(
      batch([
        ev('visit_start', VISIT_START),
        ev('look_view', { position: 0 }, { slug: 'linen-dress', collection: 'new' }),
        ev('look_dwell', { seconds: 4.234 }, { slug: 'linen-dress', collection: 'new' }),
        ev('photo_dwell', { index: 2, of: 3, image: `${'a'.repeat(32)}.webp`, seconds: 1.5 }, { slug: 'linen-dress' }),
        ev('video_progress', { pct: 50 }, { slug: 'linen-dress' }),
        ev('collection_switch', { from: 'new', to: 'dresses' }),
        ev('whatsapp_enquire', { size: 'UK 10', screen: 'product' }, { slug: 'linen-dress', page: '/p/linen-dress' }),
        ev('visit_end', { duration: 63.2, looks: 4, last: 'look_dwell' }, { slug: 'linen-dress' }),
      ]),
    )
    assert.strictEqual(r.visitId, VISIT)
    assert.strictEqual(r.deviceId, DEVICE)
    assert.strictEqual(r.events.length, 8)
    assert.strictEqual(r.dropped, 0)
    const [start, view, dwell] = r.events
    assert.match(start.id, /^e0e0e0e0-/)
    assert.strictEqual(start.type, 'visit_start')
    assert.strictEqual(start.slug, null)
    assert.deepStrictEqual(start.props, VISIT_START)
    assert.strictEqual(view.slug, 'linen-dress')
    assert.strictEqual(view.collection, 'new')
    assert.strictEqual(view.page, '/')
    assert.strictEqual(dwell.props.seconds, 4.23, 'seconds rounded to 2 decimals')
    assert.strictEqual(start.occurredAt.getTime(), AT)
  })

  test('device id is optional (storage blocked)', () => {
    const r = ok({ v: 1, visit: VISIT, events: [ev('guide_shown')] })
    assert.strictEqual(r.deviceId, null)
  })

  test('a client clock far off is replaced by the server time', () => {
    const r = ok(batch([{ ...ev('guide_shown'), at: AT - 3 * 86_400_000 }, { ...ev('guide_shown'), at: AT + 3_600_000 }]))
    for (const e of r.events) assert.strictEqual(e.occurredAt.getTime(), NOW.getTime())
  })

  test('zero-width characters are stripped before validating text', () => {
    const r = validateEvent(ev('size_select', { size: '​M‍﻿' }, { slug: 'a' }), NOW)
    assert.notStrictEqual(typeof r, 'string')
    assert.strictEqual((r as { props: Record<string, unknown> }).props.size, 'M')
    badEvent(ev('size_select', { size: '​⁠' }, { slug: 'a' }), /size/)
  })

  test('every type accepts its minimal props', () => {
    const minimal: Record<string, [Record<string, unknown>, Record<string, unknown>?]> = {
      visit_start: [VISIT_START],
      visit_end: [{ duration: 0, looks: 0 }],
      look_view: [{}, { slug: 'a' }],
      look_dwell: [{ seconds: 0.5 }, { slug: 'a' }],
      photo_view: [{ index: 1, of: 1 }, { slug: 'a' }],
      photo_dwell: [{ index: 1, of: 1, seconds: 60 }, { slug: 'a' }],
      video_start: [{}, { slug: 'a' }],
      video_progress: [{ pct: 100 }, { slug: 'a' }],
      video_replay: [{}, { slug: 'a' }],
      video_seconds: [{ seconds: 12 }, { slug: 'a' }],
      details_show: [{}, { slug: 'a' }],
      details_hide: [{}, { slug: 'a' }],
      collection_switch: [{ from: 'new', to: 'co-ord-sets' }],
      feed_load_more: [{}],
      feed_end_reached: [{}],
      product_open: [{ from: 'shared' }, { slug: 'a' }],
      size_select: [{ size: 'M' }, { slug: 'a' }],
      colour_select: [{ colour: 'Olive green' }, { slug: 'a' }],
      whatsapp_enquire: [{ screen: 'menu' }],
      restock_request: [{}, { slug: 'a' }],
      call: [{}],
      share: [{ method: 'native' }],
      directions: [{}],
      visit_us: [{}],
      gallery_zoom: [{}, { slug: 'a' }],
      guide_shown: [{}],
      guide_step: [{ step: 2 }],
      guide_skipped: [{}],
      guide_completed: [{}],
      guide_replayed: [{}],
      love_on: [{}, { slug: 'a' }],
      love_off: [{}, { slug: 'a' }],
      details_sheet_open: [{}, { slug: 'a' }],
      details_sheet_close: [{ reason: 'swipe' }, { slug: 'a' }],
      load_error: [{ what: 'image' }],
      slow_load: [{ lcp: 5200 }],
      action_failed: [{ action: 'feed_load' }],
    }
    assert.deepStrictEqual(Object.keys(minimal).sort(), [...ANALYTICS_EVENT_TYPES].sort())
    for (const [type, [props, extra]] of Object.entries(minimal)) {
      const r = validateEvent(ev(type, props, extra), NOW)
      assert.notStrictEqual(typeof r, 'string', `${type}: ${r}`)
    }
  })
})

describe('validateBatch: envelope errors reject the batch (400)', () => {
  test('not an object / wrong version / no events', () => {
    badBatch(null)
    badBatch('x')
    badBatch([])
    badBatch(batch([ev('guide_shown')], { v: 2 }), /version/)
    badBatch(batch([]), /events/)
    badBatch({ v: 1, visit: VISIT, device: DEVICE }, /events/)
  })

  test('unknown top-level fields', () => {
    badBatch(batch([ev('guide_shown')], { ip: '1.2.3.4' }), /unknown/i)
  })

  test(`more than ${MAX_BATCH_EVENTS} events`, () => {
    ok(batch(Array.from({ length: MAX_BATCH_EVENTS }, () => ev('guide_shown'))))
    badBatch(batch(Array.from({ length: MAX_BATCH_EVENTS + 1 }, () => ev('guide_shown'))), /20/)
  })

  test('visit and device ids must be v4 UUIDs', () => {
    badBatch(batch([ev('guide_shown')], { visit: 'abc' }), /visit/)
    badBatch(batch([ev('guide_shown')], { visit: VISIT.toUpperCase() }), /visit/)
    badBatch(batch([ev('guide_shown')], { device: 'phone-of-tendai' }), /device/)
    badBatch(batch([ev('guide_shown')], { device: 7 }), /device/)
  })

  test('a batch whose events are all invalid is ok but empty', () => {
    const r = ok(batch([ev('page_view'), ev('look_view')]))
    assert.strictEqual(r.events.length, 0)
    assert.strictEqual(r.dropped, 2)
  })
})

describe('validateEvent: invalid events are dropped one by one', () => {
  test('event ids must be v4 UUIDs', () => {
    badEvent({ ...ev('guide_shown'), id: 'x' }, /id/)
    const { id: _id, ...noId } = ev('guide_shown')
    void _id
    badEvent(noId, /id/)
  })

  test('unknown event types', () => {
    badEvent(ev('page_view'), /type/)
    badEvent(ev('__proto__'), /type/)
    badEvent({ ...ev('guide_shown'), type: 3 }, /type/)
  })

  test('unknown event fields and unknown props', () => {
    badEvent({ ...ev('guide_shown'), phone: '+263771234567' }, /unknown/i)
    badEvent(ev('look_view', { position: 1, name: 'Tendai' }, { slug: 'a' }), /name/)
    badEvent(ev('guide_step', { step: 1, extra: 1 }), /extra/)
  })

  test('props must be a plain object', () => {
    badEvent({ ...ev('guide_shown'), props: [] })
    badEvent({ ...ev('guide_shown'), props: 'x' })
  })

  test('missing required props and wrong types', () => {
    badEvent(ev('look_dwell', {}, { slug: 'a' }), /seconds/)
    badEvent(ev('look_dwell', { seconds: '4' }, { slug: 'a' }), /seconds/)
    badEvent(ev('look_dwell', { seconds: Number.NaN }, { slug: 'a' }), /seconds/)
    badEvent(ev('guide_step', { step: 1.5 }), /step/)
    badEvent(ev('visit_start', { ...VISIT_START, returning: 'yes' }), /returning/)
  })

  test('numbers out of range (dwell rules: 0.5 s to 60 s)', () => {
    badEvent(ev('look_dwell', { seconds: 0.4 }, { slug: 'a' }), /seconds/)
    badEvent(ev('look_dwell', { seconds: 61 }, { slug: 'a' }), /seconds/)
    badEvent(ev('photo_view', { index: 0, of: 3 }, { slug: 'a' }), /index/)
    badEvent(ev('photo_view', { index: 4, of: 3 }, { slug: 'a' }), /index/)
    badEvent(ev('video_progress', { pct: 30 }, { slug: 'a' }), /pct/)
  })

  test('enums', () => {
    badEvent(ev('visit_start', { ...VISIT_START, ref: 'twitter' }), /ref/)
    badEvent(ev('visit_start', { ...VISIT_START, device: 'tv' }), /device/)
    badEvent(ev('share', { method: 'sms' }), /method/)
    badEvent(ev('visit_end', { duration: 1, looks: 1, last: 'nope' }), /last/)
  })

  test('string lengths and characters', () => {
    badEvent(ev('size_select', { size: 'x'.repeat(25) }, { slug: 'a' }), /size/)
    badEvent(ev('size_select', { size: '' }, { slug: 'a' }), /size/)
    badEvent(ev('size_select', { size: 'M\u0000' }, { slug: 'a' }), /size/)
    badEvent(ev('visit_start', { ...VISIT_START, campaign: 'Has Spaces' }), /campaign/)
    badEvent(ev('visit_start', { ...VISIT_START, campaign: 'has.dot' }), /campaign/)
    badEvent(ev('visit_start', { ...VISIT_START, campaign: 'x'.repeat(41) }), /campaign/)
    badEvent(ev('visit_start', { ...VISIT_START, refDomain: 'evil.com/path' }), /refDomain/)
    badEvent(ev('visit_start', { ...VISIT_START, lang: 'english please' }), /lang/)
    badEvent(ev('photo_view', { index: 1, of: 1, image: '../x.webp' }, { slug: 'a' }), /image/)
  })

  test('pages are paths without query or fragment', () => {
    badEvent(ev('guide_shown', {}, { page: 'https://evil.example/' }), /page/)
    badEvent(ev('guide_shown', {}, { page: '/p/a?preview=secret' }), /page/)
    badEvent(ev('guide_shown', {}, { page: `/${'a'.repeat(200)}` }), /page/)
    badEvent(ev('visit_start', { ...VISIT_START, landing: '/?src=x' }), /landing/)
  })

  test('slug rules per type', () => {
    badEvent(ev('look_view', {}), /slug/)
    badEvent(ev('guide_shown', {}, { slug: 'a' }), /slug/)
    badEvent(ev('look_view', {}, { slug: 'Not A Slug' }), /slug/)
    badEvent(ev('look_view', {}, { slug: 'a', collection: 'Bad Tab' }), /collection/)
  })

  test('timestamps must be numbers', () => {
    badEvent({ ...ev('guide_shown'), at: '2026-11-01' }, /at/)
    const { at: _at, ...noAt } = ev('guide_shown')
    void _at
    badEvent(noAt, /at/)
  })
})

describe('analyticsDay', () => {
  test('is the date in Harare (UTC+2)', () => {
    assert.strictEqual(analyticsDay(new Date('2026-11-01T21:59:59Z')), '2026-11-01')
    assert.strictEqual(analyticsDay(new Date('2026-11-01T22:00:00Z')), '2026-11-02')
  })
})

describe('bots and headless browsers', () => {
  const h = (ua: string | null, extra: Record<string, string> = {}) => {
    const headers = new Headers(extra)
    if (ua !== null) headers.set('user-agent', ua)
    return headers
  }
  const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
  const IG = `${PHONE} Instagram 352.0.0.0`

  test('real browsers pass, including Telegram / Discord in-app browsers and CUBOT phones', () => {
    for (const ua of [
      PHONE,
      ANDROID,
      IG,
      `${ANDROID} Telegram-Android/11.2.2 (Samsung SM-A145F; Android 14; SDK 34; AVERAGE)`,
      `${PHONE} Discord/250.0`,
      'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    ]) {
      assert.strictEqual(isBotRequest(h(ua)), false, ua)
    }
  })

  test('crawlers, previews, tools and headless browsers are dropped', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
      'curl/8.4.0',
      'python-requests/2.31.0',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'node-fetch/1.0',
      '',
    ]) {
      assert.strictEqual(isBotRequest(h(ua)), true, ua)
    }
    assert.strictEqual(isBotRequest(h(null)), true, 'no user agent')
    assert.strictEqual(isBotRequest(h(ANDROID, { 'sec-ch-ua': '"HeadlessChrome";v="130"' })), true, 'client hint')
  })

  test('client side: webdriver / headless / bot UA', () => {
    assert.strictEqual(isAutomatedClient({ userAgent: PHONE }), false)
    assert.strictEqual(isAutomatedClient({ userAgent: PHONE, webdriver: true }), true)
    assert.strictEqual(isAutomatedClient({ userAgent: 'HeadlessChrome/130' }), true)
  })
})

describe('GPC / DNT', () => {
  test('server headers', () => {
    assert.strictEqual(isOptedOutRequest(new Headers()), false)
    assert.strictEqual(isOptedOutRequest(new Headers({ 'sec-gpc': '1' })), true)
    assert.strictEqual(isOptedOutRequest(new Headers({ dnt: '1' })), true)
    assert.strictEqual(isOptedOutRequest(new Headers({ dnt: '0' })), false)
  })
  test('browser signals', () => {
    assert.strictEqual(isOptedOutClient({}), false)
    assert.strictEqual(isOptedOutClient({ globalPrivacyControl: true }), true)
    assert.strictEqual(isOptedOutClient({ doNotTrack: '1' }), true)
    assert.strictEqual(isOptedOutClient({ doNotTrack: 'yes' }), true)
    assert.strictEqual(isOptedOutClient({ doNotTrack: 'unspecified' }), false)
    assert.strictEqual(isOptedOutClient({}, { doNotTrack: '1' }), true, 'window.doNotTrack (old Safari/Edge)')
  })
})

describe('visit context', () => {
  const OWN = 'vyra.co.zw'
  const src = (referrer: string, search = '') => visitSource(referrer, search, OWN)

  test('referrer buckets', () => {
    assert.deepStrictEqual(src(''), { ref: 'direct' })
    assert.deepStrictEqual(src('https://l.instagram.com/?u=x'), { ref: 'instagram', refDomain: 'l.instagram.com' })
    assert.deepStrictEqual(src('https://www.instagram.com/'), { ref: 'instagram', refDomain: 'instagram.com' })
    assert.strictEqual(src('https://www.tiktok.com/@vyra').ref, 'tiktok')
    assert.strictEqual(src('https://wa.me/').ref, 'whatsapp')
    assert.strictEqual(src('https://web.whatsapp.com/').ref, 'whatsapp')
    assert.strictEqual(src('https://lm.facebook.com/l.php').ref, 'facebook')
    assert.strictEqual(src('https://m.facebook.com/').ref, 'facebook')
    assert.strictEqual(src('https://www.google.co.zw/').ref, 'google')
    assert.strictEqual(src('android-app://com.google.android.gm/').ref, 'other')
    assert.deepStrictEqual(src('https://blog.example.com/post?id=1'), { ref: 'other', refDomain: 'blog.example.com' })
    assert.deepStrictEqual(src('not a url'), { ref: 'other' })
  })

  test('own site is direct (internal navigation, reload)', () => {
    assert.deepStrictEqual(src('https://vyra.co.zw/shop'), { ref: 'direct' })
    assert.deepStrictEqual(src('https://www.vyra.co.zw/shop'), { ref: 'direct' })
  })

  test('in-app browsers without a referrer: ?src= / utm_source decide the bucket', () => {
    assert.strictEqual(src('', '?src=ig').ref, 'instagram')
    assert.strictEqual(src('', '?utm_source=TikTok').ref, 'tiktok')
    assert.strictEqual(src('', '?src=wa-status').ref, 'whatsapp')
    assert.strictEqual(src('', '?src=fb').ref, 'facebook')
    assert.strictEqual(src('', '?src=poster').ref, 'direct')
    // A real referrer wins.
    assert.strictEqual(src('https://www.google.com/', '?src=ig').ref, 'google')
  })

  test('campaign tag: ?src=, else utm_campaign, else utm_source; [a-z0-9_-], at most 40', () => {
    assert.strictEqual(campaignFromSearch(''), undefined)
    assert.strictEqual(campaignFromSearch('?src=Nov-Launch'), 'nov-launch')
    assert.strictEqual(campaignFromSearch('?utm_source=ig&utm_campaign=Black Friday!'), 'black-friday')
    assert.strictEqual(campaignFromSearch('?utm_source=instagram'), 'instagram')
    assert.strictEqual(campaignFromSearch('?src=ig.bio_2026'), 'ig-bio_2026')
    assert.strictEqual(campaignFromSearch(`?src=${'x'.repeat(100)}`)?.length, 40)
    assert.strictEqual(campaignFromSearch('?src=%%%'), undefined)
    assert.strictEqual(campaignFromSearch('?src=%E2%80%8B'), undefined, 'zero-width only')
  })

  test('device class', () => {
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile/15E148'
    const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-A145F) Chrome/130 Mobile Safari/537.36'
    const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 13; SM-X200) Chrome/130 Safari/537.36'
    const IPAD_OS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.1 Safari/605.1.15'
    const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36'
    assert.strictEqual(deviceClass({ userAgent: IPHONE, maxTouchPoints: 5, width: 390 }), 'phone')
    assert.strictEqual(deviceClass({ userAgent: ANDROID_PHONE, maxTouchPoints: 5, width: 360 }), 'phone')
    assert.strictEqual(deviceClass({ userAgent: ANDROID_TAB, maxTouchPoints: 5, width: 800 }), 'tablet')
    assert.strictEqual(deviceClass({ userAgent: IPAD_OS, maxTouchPoints: 5, width: 820 }), 'tablet')
    assert.strictEqual(deviceClass({ userAgent: IPAD_OS, maxTouchPoints: 0, width: 1440 }), 'desktop')
    assert.strictEqual(deviceClass({ userAgent: WIN, maxTouchPoints: 0, width: 1280 }), 'desktop')
  })

  test('page: path only, /site prefix removed, bounded', () => {
    assert.strictEqual(normalizePage('/site'), '/')
    assert.strictEqual(normalizePage('/site/p/linen-dress'), '/p/linen-dress')
    assert.strictEqual(normalizePage('/p/linen-dress/'), '/p/linen-dress')
    assert.strictEqual(normalizePage('/'), '/')
    assert.strictEqual(normalizePage('/sitemap'), '/sitemap')
    assert.strictEqual(normalizePage(`/${'a'.repeat(300)}`).length, 200)
    assert.strictEqual(normalizePage('/a b'), '/a%20b')
  })
})

describe('storefront host', () => {
  test('lets POST /api/public/events through (public API prefix)', () => {
    const config = { storefrontHosts: ['vyra.co.zw'], adminHosts: [] }
    assert.deepStrictEqual(decideHostRouting({ host: 'vyra.co.zw', pathname: '/api/public/events' }, config), {
      action: 'next',
      noindex: false,
    })
  })
})

// ZP-510: the feed's details bottom sheet.
describe('details_sheet_open / details_sheet_close', () => {
  test('open needs the slug and takes no props', () => {
    assert.notStrictEqual(typeof validateEvent(ev('details_sheet_open', {}, { slug: 'linen-dress', collection: 'new' }), NOW), 'string')
    badEvent(ev('details_sheet_open', {}), /slug/)
    badEvent(ev('details_sheet_open', { reason: 'swipe' }, { slug: 'a' }), /reason/)
  })

  test('close needs the slug and one of the five reasons', () => {
    for (const reason of ['swipe', 'backdrop', 'button', 'back', 'escape']) {
      const r = validateEvent(ev('details_sheet_close', { reason }, { slug: 'linen-dress' }), NOW)
      assert.notStrictEqual(typeof r, 'string', `${reason}: ${r}`)
    }
    badEvent(ev('details_sheet_close', { reason: 'swipe' }), /slug/)
    badEvent(ev('details_sheet_close', {}, { slug: 'a' }), /reason/)
    badEvent(ev('details_sheet_close', { reason: 'link' }, { slug: 'a' }), /reason/)
    badEvent(ev('details_sheet_close', { reason: 'swipe', seconds: 3 }, { slug: 'a' }), /seconds/)
  })

  // ZP-512: a landing on /p/<slug> (a shared link) opens the sheet with from: 'shared'.
  test('open: optional from, only "shared"', () => {
    assert.notStrictEqual(typeof validateEvent(ev('details_sheet_open', { from: 'shared' }, { slug: 'a' }), NOW), 'string')
    badEvent(ev('details_sheet_open', { from: 'feed' }, { slug: 'a' }), /from/)
  })
})
