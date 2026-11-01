/**
 * ZP-493: first-party analytics, pure parts.
 * - The event allow-list and per-type prop schemas (src/lib/analytics/events.ts).
 * - Batch limits, id formats, timestamps.
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
} from '../src/lib/analytics/events'
import { isAutomatedClient, isBotRequest, isOptedOutClient, isOptedOutRequest } from '../src/lib/analytics/privacy'
import { campaignFromSearch, deviceClass, normalizePage, visitSource } from '../src/lib/analytics/context'
import { decideHostRouting } from '../src/lib/host-routing'

const VISIT = '0b6f3c1e-8a3d-4f7e-9a51-2c1d4e5f6a7b'
const DEVICE = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const NOW = new Date('2026-11-01T10:00:00Z')
const AT = NOW.getTime() - 5_000

function batch(events: unknown[], extra: Record<string, unknown> = {}) {
  return { v: 1, visit: VISIT, device: DEVICE, events, ...extra }
}
function ev(type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { type, at: AT, page: '/', props, ...extra }
}
function ok(input: unknown) {
  const r = validateBatch(input, NOW)
  assert.ok(r.ok, `expected ok, got ${r.ok ? '' : r.error}`)
  return r
}
function bad(input: unknown, pattern?: RegExp) {
  const r = validateBatch(input, NOW)
  assert.strictEqual(r.ok, false, 'expected the batch to be rejected')
  if (pattern && !r.ok) assert.match(r.error, pattern)
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
      'action_failed',
    ]
    assert.deepStrictEqual([...ANALYTICS_EVENT_TYPES].sort(), [...expected].sort())
    for (const t of expected) assert.ok(EVENT_SPECS[t as keyof typeof EVENT_SPECS], t)
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
    const [start, view, dwell] = r.events
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
      load_error: [{ what: 'image' }],
      slow_load: [{ lcp: 5200 }],
      action_failed: [{ action: 'feed_load' }],
    }
    assert.deepStrictEqual(Object.keys(minimal).sort(), [...ANALYTICS_EVENT_TYPES].sort())
    for (const [type, [props, extra]] of Object.entries(minimal)) {
      const r = validateBatch(batch([ev(type, props, extra)]), NOW)
      assert.ok(r.ok, `${type}: ${r.ok ? '' : r.error}`)
    }
  })
})

describe('validateBatch: rejected', () => {
  test('not an object / wrong version / no events', () => {
    bad(null)
    bad('x')
    bad([])
    bad(batch([ev('guide_shown')], { v: 2 }), /version/)
    bad(batch([]), /events/)
    bad({ v: 1, visit: VISIT, device: DEVICE }, /events/)
  })

  test('unknown top-level fields', () => {
    bad(batch([ev('guide_shown')], { ip: '1.2.3.4' }), /unknown/i)
  })

  test(`more than ${MAX_BATCH_EVENTS} events`, () => {
    ok(batch(Array.from({ length: MAX_BATCH_EVENTS }, () => ev('guide_shown'))))
    bad(batch(Array.from({ length: MAX_BATCH_EVENTS + 1 }, () => ev('guide_shown'))), /50/)
  })

  test('visit and device ids must be v4 UUIDs', () => {
    bad(batch([ev('guide_shown')], { visit: 'abc' }), /visit/)
    bad(batch([ev('guide_shown')], { visit: VISIT.toUpperCase() }), /visit/)
    bad(batch([ev('guide_shown')], { device: 'phone-of-tendai' }), /device/)
    bad(batch([ev('guide_shown')], { device: 7 }), /device/)
  })

  test('unknown event types', () => {
    bad(batch([ev('page_view')]), /type/)
    bad(batch([ev('__proto__')]), /type/)
    bad(batch([{ ...ev('guide_shown'), type: 3 }]), /type/)
  })

  test('unknown event fields and unknown props', () => {
    bad(batch([{ ...ev('guide_shown'), phone: '+263771234567' }]), /unknown/i)
    bad(batch([ev('look_view', { position: 1, name: 'Tendai' }, { slug: 'a' })]), /name/)
    bad(batch([ev('guide_step', { step: 1, extra: 1 })]), /extra/)
  })

  test('props must be a plain object', () => {
    bad(batch([{ ...ev('guide_shown'), props: [] }]))
    bad(batch([{ ...ev('guide_shown'), props: 'x' }]))
  })

  test('missing required props and wrong types', () => {
    bad(batch([ev('look_dwell', {}, { slug: 'a' })]), /seconds/)
    bad(batch([ev('look_dwell', { seconds: '4' }, { slug: 'a' })]), /seconds/)
    bad(batch([ev('look_dwell', { seconds: Number.NaN }, { slug: 'a' })]), /seconds/)
    bad(batch([ev('guide_step', { step: 1.5 })]), /step/)
    bad(batch([ev('visit_start', { ...VISIT_START, returning: 'yes' })]), /returning/)
  })

  test('numbers out of range (dwell rules: 0.5 s to 60 s)', () => {
    bad(batch([ev('look_dwell', { seconds: 0.4 }, { slug: 'a' })]), /seconds/)
    bad(batch([ev('look_dwell', { seconds: 61 }, { slug: 'a' })]), /seconds/)
    bad(batch([ev('photo_view', { index: 0, of: 3 }, { slug: 'a' })]), /index/)
    bad(batch([ev('photo_view', { index: 4, of: 3 }, { slug: 'a' })]), /index/)
    bad(batch([ev('video_progress', { pct: 30 }, { slug: 'a' })]), /pct/)
  })

  test('enums', () => {
    bad(batch([ev('visit_start', { ...VISIT_START, ref: 'twitter' })]), /ref/)
    bad(batch([ev('visit_start', { ...VISIT_START, device: 'tv' })]), /device/)
    bad(batch([ev('share', { method: 'sms' })]), /method/)
    bad(batch([ev('visit_end', { duration: 1, looks: 1, last: 'nope' })]), /last/)
  })

  test('string lengths and characters', () => {
    bad(batch([ev('size_select', { size: 'x'.repeat(25) }, { slug: 'a' })]), /size/)
    bad(batch([ev('size_select', { size: '' }, { slug: 'a' })]), /size/)
    bad(batch([ev('size_select', { size: 'M\u0000' }, { slug: 'a' })]), /size/)
    bad(batch([ev('visit_start', { ...VISIT_START, campaign: 'Has Spaces' })]), /campaign/)
    bad(batch([ev('visit_start', { ...VISIT_START, refDomain: 'evil.com/path' })]), /refDomain/)
    bad(batch([ev('visit_start', { ...VISIT_START, lang: 'english please' })]), /lang/)
    bad(batch([ev('photo_view', { index: 1, of: 1, image: '../x.webp' }, { slug: 'a' })]), /image/)
  })

  test('pages are paths without query or fragment', () => {
    bad(batch([ev('guide_shown', {}, { page: 'https://evil.example/' })]), /page/)
    bad(batch([ev('guide_shown', {}, { page: '/p/a?preview=secret' })]), /page/)
    bad(batch([ev('guide_shown', {}, { page: `/${'a'.repeat(200)}` })]), /page/)
    bad(batch([ev('visit_start', { ...VISIT_START, landing: '/?src=x' })]), /landing/)
  })

  test('slug rules per type', () => {
    bad(batch([ev('look_view', {})]), /slug/)
    bad(batch([ev('guide_shown', {}, { slug: 'a' })]), /slug/)
    bad(batch([ev('look_view', {}, { slug: 'Not A Slug' })]), /slug/)
    bad(batch([ev('look_view', {}, { slug: 'a', collection: 'Bad Tab' })]), /collection/)
  })

  test('timestamps must be numbers', () => {
    bad(batch([{ ...ev('guide_shown'), at: '2026-11-01' }]), /at/)
    bad(batch([{ type: 'guide_shown', page: '/', props: {} }]), /at/)
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

  test('real browsers pass', () => {
    for (const ua of [PHONE, ANDROID, IG]) assert.strictEqual(isBotRequest(h(ua)), false, ua)
  })

  test('crawlers, tools and headless browsers are dropped', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0',
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

  test('campaign tag: ?src=, else utm_campaign, else utm_source; normalised', () => {
    assert.strictEqual(campaignFromSearch(''), undefined)
    assert.strictEqual(campaignFromSearch('?src=Nov-Launch'), 'nov-launch')
    assert.strictEqual(campaignFromSearch('?utm_source=ig&utm_campaign=Black Friday!'), 'black-friday')
    assert.strictEqual(campaignFromSearch('?utm_source=instagram'), 'instagram')
    assert.strictEqual(campaignFromSearch(`?src=${'x'.repeat(100)}`)?.length, 64)
    assert.strictEqual(campaignFromSearch('?src=%%%'), undefined)
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
