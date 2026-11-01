/**
 * ZP-493: the browser tracker (src/lib/analytics/client-core.ts) with a fake
 * browser environment: batching (10 s / 20 events / page hide), sendBeacon
 * with fetch keepalive fallback, visit id (sessionStorage, 30 min idle),
 * device id (localStorage, returning visitors), visit context, GPC / DNT /
 * automation opt-out, storage failures, and the no-op outside a browser.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  ANALYTICS_ENDPOINT,
  DEVICE_STORAGE_KEY,
  FLUSH_AT_EVENTS,
  FLUSH_INTERVAL_MS,
  VISIT_IDLE_MS,
  VISIT_STORAGE_KEY,
  createAnalyticsClient,
  type AnalyticsEnv,
} from '../src/lib/analytics/client-core'
import { validateBatch } from '../src/lib/analytics/events'
import * as browserClient from '../src/lib/analytics/client'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'

class MemoryStorage {
  map = new Map<string, string>()
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v))
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
}
const throwing = {
  getItem(): string | null {
    throw new Error('SecurityError')
  },
  setItem() {
    throw new Error('QuotaExceededError')
  },
  removeItem() {
    throw new Error('SecurityError')
  },
}

type Sent = { via: 'beacon' | 'fetch'; url: string; body: { v: number; visit: string; device?: string; events: Array<{ id: string; type: string; slug?: string; page?: string; props: Record<string, unknown> }> }; init?: RequestInit }

function fakeEnv(overrides: Partial<AnalyticsEnv> & { beaconOk?: boolean } = {}) {
  let t = Date.parse('2026-11-01T10:00:00Z')
  let timers: Array<{ id: number; at: number; fn: () => void }> = []
  let nextId = 1
  let visible = true
  const visListeners = new Set<(v: boolean) => void>()
  const hideListeners: Array<() => void> = []
  const sent: Sent[] = []
  const warnings: string[] = []
  let microtasks: Array<() => void> = []
  const runMicrotasks = () => {
    while (microtasks.length) {
      const queued = microtasks
      microtasks = []
      for (const fn of queued) fn()
    }
  }
  let ids = 0
  const session = new MemoryStorage()
  const local = new MemoryStorage()
  const env: AnalyticsEnv = {
    endpoint: ANALYTICS_ENDPOINT,
    now: () => t,
    setTimer(fn, ms) {
      const id = nextId++
      timers.push({ id, at: t + ms, fn })
      return id
    },
    clearTimer(id) {
      timers = timers.filter((x) => x.id !== id)
    },
    session,
    local,
    sendBeacon(url, body) {
      if (overrides.beaconOk === false) return false
      sent.push({ via: 'beacon', url, body: JSON.parse(body) })
      return true
    },
    fetch: async (url, init) => {
      sent.push({ via: 'fetch', url: String(url), body: JSON.parse(String(init?.body)), init })
      return undefined
    },
    randomId: () => {
      ids += 1
      return `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`
    },
    location: { pathname: '/site', search: '?src=Nov-Launch', host: 'localhost:3454' },
    referrer: 'https://l.instagram.com/',
    navigator: { userAgent: IPHONE, language: 'en-ZW', maxTouchPoints: 5 },
    windowDoNotTrack: null,
    viewport: () => ({ width: 390, height: 844 }),
    visibility: {
      isVisible: () => visible,
      subscribe(fn) {
        visListeners.add(fn)
        return () => visListeners.delete(fn)
      },
    },
    onPageHide(fn) {
      hideListeners.push(fn)
    },
    defer(fn) {
      microtasks.push(fn)
    },
    warn(message) {
      warnings.push(message)
    },
    ...overrides,
  }
  return {
    env,
    sent,
    warnings,
    runMicrotasks,
    session,
    local,
    advance(ms: number) {
      const end = t + ms
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        t = due.at
        timers = timers.filter((x) => x !== due)
        due.fn()
      }
      t = end
    },
    setVisible(v: boolean) {
      // Like the browser: one native event notifies every subscriber, then the microtask checkpoint.
      visible = v
      for (const fn of [...visListeners]) fn(v)
      runMicrotasks()
    },
    pageHide() {
      for (const fn of hideListeners) {
        fn()
        runMicrotasks()
      }
    },
    get pendingTimers() {
      return timers.length
    },
    events() {
      return sent.flatMap((s) => s.body.events)
    },
  }
}

describe('analytics client', () => {
  test('constants follow the spec', () => {
    assert.strictEqual(FLUSH_INTERVAL_MS, 10_000)
    assert.strictEqual(FLUSH_AT_EVENTS, 20)
    assert.strictEqual(VISIT_IDLE_MS, 30 * 60_000)
    assert.strictEqual(ANALYTICS_ENDPOINT, '/api/public/events')
  })

  test('a new visit sends visit_start with the visit context, batched every 10 s', () => {
    const f = fakeEnv()
    const client = createAnalyticsClient(f.env)
    assert.strictEqual(client.enabled, true)
    assert.strictEqual(f.sent.length, 0, 'nothing sent immediately')
    f.advance(FLUSH_INTERVAL_MS - 1)
    assert.strictEqual(f.sent.length, 0)
    f.advance(1)
    assert.strictEqual(f.sent.length, 1)
    const [{ via, url, body }] = f.sent
    assert.strictEqual(via, 'beacon')
    assert.strictEqual(url, '/api/public/events')
    assert.strictEqual(body.v, 1)
    assert.match(body.visit, UUID)
    assert.match(body.device!, UUID)
    assert.strictEqual(body.events.length, 1)
    const start = body.events[0]
    assert.strictEqual(start.type, 'visit_start')
    assert.strictEqual(start.page, '/')
    assert.deepStrictEqual(start.props, {
      ref: 'instagram',
      refDomain: 'l.instagram.com',
      campaign: 'nov-launch',
      device: 'phone',
      vw: 390,
      vh: 844,
      lang: 'en-ZW',
      landing: '/',
      returning: false,
    })
    // What the client sends passes the server's validation.
    const r = validateBatch(body, new Date(f.env.now()))
    assert.ok(r.ok, r.ok ? '' : r.error)
  })

  test('track: slug and collection go on the event, the rest in props; 20 events flush at once', () => {
    const f = fakeEnv()
    const client = createAnalyticsClient(f.env)
    client.track('look_view', { slug: 'linen-dress', collection: 'new', position: 0 })
    const ev = client.pending().find((e) => e.type === 'look_view')!
    assert.strictEqual(ev.slug, 'linen-dress')
    assert.strictEqual(ev.collection, 'new')
    assert.deepStrictEqual(ev.props, { position: 0 })
    for (let i = 1; i < FLUSH_AT_EVENTS - 1; i += 1) client.track('look_view', { slug: 'linen-dress', position: i })
    assert.strictEqual(f.sent.length, 1, 'visit_start + 19 looks = 20 events')
    assert.strictEqual(f.sent[0].body.events.length, 20)
    const r = validateBatch(f.sent[0].body, new Date(f.env.now()))
    assert.ok(r.ok, r.ok ? '' : r.error)
  })

  test('page hidden: visit_end (visible time only, looks, last event) and an immediate flush', () => {
    const f = fakeEnv()
    const client = createAnalyticsClient(f.env)
    client.track('look_view', { slug: 'a', position: 0 })
    f.advance(3_000)
    client.track('look_view', { slug: 'b', position: 1 })
    f.advance(2_000)
    client.track('details_show', { slug: 'b' })
    f.setVisible(false)
    const ends = f.events().filter((e) => e.type === 'visit_end')
    assert.strictEqual(ends.length, 1)
    assert.deepStrictEqual(ends[0].props, { duration: 5, looks: 2, last: 'details_show' })
    assert.strictEqual(ends[0].slug, 'b', 'the last look seen')
    // pagehide right after visibilitychange hidden: no second visit_end.
    f.pageHide()
    assert.strictEqual(f.events().filter((e) => e.type === 'visit_end').length, 1)
    // Locked for a minute, then back: time while hidden is not counted.
    f.advance(60_000)
    f.setVisible(true)
    f.advance(4_000)
    f.pageHide()
    const ends2 = f.events().filter((e) => e.type === 'visit_end')
    assert.strictEqual(ends2.length, 2)
    assert.strictEqual(ends2[1].props.duration, 9)
    for (const s of f.sent) {
      const r = validateBatch(s.body, new Date(f.env.now()))
      assert.ok(r.ok, r.ok ? '' : r.error)
    }
  })

  test('events tracked while the page is hidden are sent straight away', () => {
    const f = fakeEnv()
    const client = createAnalyticsClient(f.env)
    f.setVisible(false)
    const before = f.sent.length
    client.track('look_dwell', { slug: 'a', seconds: 3 })
    client.track('photo_dwell', { slug: 'a', index: 1, of: 2, seconds: 2 })
    assert.strictEqual(f.sent.length, before, 'coalesced: not yet')
    f.runMicrotasks()
    assert.strictEqual(f.sent.length, before + 1, 'one beacon for both')
    assert.strictEqual(f.sent.at(-1)!.body.events.length, 2)
  })

  test('page hides: visit_end and the dwell events emitted by the same hide go in ONE beacon', () => {
    const f = fakeEnv()
    const client = createAnalyticsClient(f.env)
    client.track('look_view', { slug: 'a', position: 0 })
    // A dwell tracker subscribed after the client (as the feed's slides are) emits on hide.
    f.env.visibility.subscribe((visible) => {
      if (!visible) client.track('look_dwell', { slug: 'a', seconds: 2.5 })
    })
    f.advance(3_000)
    const before = f.sent.length
    f.setVisible(false)
    assert.strictEqual(f.sent.length, before + 1)
    const types = f.sent.at(-1)!.body.events.map((e) => e.type)
    assert.deepStrictEqual(types, ['visit_start', 'look_view', 'visit_end', 'look_dwell'])
  })

  test('pagehide (unload) still sends synchronously', () => {
    // The client's pagehide handler, called without a microtask checkpoint afterwards.
    let handler: (() => void) | null = null
    const g = fakeEnv({ onPageHide: (fn) => void (handler = fn) })
    const client = createAnalyticsClient(g.env)
    client.track('look_view', { slug: 'b' })
    handler!()
    assert.ok(g.events().some((e) => e.type === 'visit_end'))
  })

  test('every event carries its own random event id (server dedupe)', () => {
    const f = fakeEnv()
    const client = createAnalyticsClient(f.env)
    client.track('look_view', { slug: 'a' })
    client.track('look_view', { slug: 'a' })
    client.flush()
    const ids = f.events().map((e) => e.id)
    assert.strictEqual(ids.length, 3)
    for (const id of ids) assert.match(id, UUID)
    assert.strictEqual(new Set(ids).size, 3)
  })

  test('invalid events are dropped before queueing (shared validator), with a dev warning', () => {
    const f = fakeEnv()
    const client = createAnalyticsClient(f.env)
    client.track('look_dwell', { slug: 'a', seconds: 0.2 }) // flick: below 0.5 s
    client.track('look_view', {}) // no slug
    client.track('guide_step', { step: 1, name: 'Tendai' } as never) // unknown prop
    client.track('look_view', { slug: 'a', position: 0 })
    assert.deepStrictEqual(
      client.pending().map((e) => e.type),
      ['visit_start', 'look_view'],
    )
    assert.strictEqual(f.warnings.length, 3)
    assert.match(f.warnings[0], /look_dwell/)
  })

  test('no warn function (production): invalid events are dropped silently', () => {
    const f = fakeEnv({ warn: undefined })
    const client = createAnalyticsClient(f.env)
    client.track('look_view', {})
    assert.deepStrictEqual(client.pending().map((e) => e.type), ['visit_start'])
  })

  test('sendBeacon refused: fetch with keepalive, same-origin credentials (so staff sessions are recognised)', () => {
    const f = fakeEnv({ beaconOk: false })
    createAnalyticsClient(f.env)
    f.advance(FLUSH_INTERVAL_MS)
    assert.strictEqual(f.sent.length, 1)
    assert.strictEqual(f.sent[0].via, 'fetch')
    assert.strictEqual(f.sent[0].init?.keepalive, true)
    assert.strictEqual(f.sent[0].init?.method, 'POST')
    assert.strictEqual(f.sent[0].init?.credentials, 'same-origin')
  })

  test('the visit continues across a reload; a returning device is marked', () => {
    const f = fakeEnv()
    const first = createAnalyticsClient(f.env)
    first.track('look_view', { slug: 'a' })
    f.pageHide() // persists the visit
    const visit = f.sent[0].body.visit
    const device = f.sent[0].body.device
    const sentBefore = f.events().length

    f.advance(60_000)
    const second = createAnalyticsClient(f.env) // reload, same tab
    second.track('look_view', { slug: 'b' })
    second.flush()
    const newEvents = f.events().slice(sentBefore)
    assert.ok(!newEvents.some((e) => e.type === 'visit_start'), 'same visit')
    assert.strictEqual(f.sent.at(-1)!.body.visit, visit)
    assert.strictEqual(f.sent.at(-1)!.body.device, device)

    // New tab next day: new visit, same device, returning.
    f.session.map.clear()
    f.advance(24 * 3_600_000)
    const third = createAnalyticsClient(f.env)
    third.flush()
    const start = f.events().filter((e) => e.type === 'visit_start').at(-1)!
    assert.strictEqual(start.props.returning, true)
    assert.notStrictEqual(f.sent.at(-1)!.body.visit, visit)
    assert.strictEqual(f.sent.at(-1)!.body.device, device)
    assert.ok(f.local.getItem(DEVICE_STORAGE_KEY))
    assert.ok(f.session.getItem(VISIT_STORAGE_KEY))
  })

  test('after 30 min idle the next event starts a new visit', () => {
    const f = fakeEnv()
    const client = createAnalyticsClient(f.env)
    client.flush()
    const visit = f.sent[0].body.visit
    f.advance(VISIT_IDLE_MS + 1)
    client.track('look_view', { slug: 'a' })
    client.flush()
    const last = f.sent.at(-1)!.body
    assert.notStrictEqual(last.visit, visit)
    assert.deepStrictEqual(
      last.events.map((e) => e.type),
      ['visit_start', 'look_view'],
    )
  })

  test('GPC, DNT and automated browsers: nothing collected, nothing stored', () => {
    for (const navigator of [
      { userAgent: IPHONE, globalPrivacyControl: true },
      { userAgent: IPHONE, doNotTrack: '1' },
      { userAgent: IPHONE, webdriver: true },
      { userAgent: 'Mozilla/5.0 HeadlessChrome/130.0.0.0' },
    ]) {
      const f = fakeEnv({ navigator })
      const client = createAnalyticsClient(f.env)
      assert.strictEqual(client.enabled, false)
      client.track('look_view', { slug: 'a' })
      f.advance(FLUSH_INTERVAL_MS * 3)
      f.setVisible(false)
      f.pageHide()
      assert.strictEqual(f.sent.length, 0)
      assert.strictEqual(f.session.map.size + f.local.map.size, 0, 'no storage writes')
      assert.strictEqual(f.pendingTimers, 0)
    }
    const f = fakeEnv({ windowDoNotTrack: '1' })
    assert.strictEqual(createAnalyticsClient(f.env).enabled, false)
  })

  test('preview pages are never collected', () => {
    for (const location of [
      { pathname: '/site/p/linen-dress', search: '?preview=abc', host: 'x' },
      { pathname: '/site/preview/abc', search: '', host: 'x' },
    ]) {
      const f = fakeEnv({ location })
      assert.strictEqual(createAnalyticsClient(f.env).enabled, false)
    }
  })

  test('storage blocked: still collects, without a device id', () => {
    const f = fakeEnv({ session: throwing, local: throwing })
    const client = createAnalyticsClient(f.env)
    client.track('look_view', { slug: 'a' })
    client.flush()
    assert.strictEqual(f.sent.length, 1)
    assert.match(f.sent[0].body.visit, UUID)
    assert.strictEqual(f.sent[0].body.device, undefined)
    const r = validateBatch(f.sent[0].body, new Date(f.env.now()))
    assert.ok(r.ok, r.ok ? '' : r.error)
  })

  test('storage unavailable (null): same', () => {
    const f = fakeEnv({ session: null, local: null })
    createAnalyticsClient(f.env).flush()
    assert.strictEqual(f.sent.length, 1)
  })

  test('the queue is bounded if sending keeps failing', () => {
    const f = fakeEnv({ sendBeacon: null, fetch: null })
    const client = createAnalyticsClient(f.env)
    for (let i = 0; i < 1_000; i += 1) client.track('guide_step', { step: 1 })
    assert.ok(client.pending().length <= 200)
  })

  test('outside a browser the exported track() is a no-op', () => {
    assert.strictEqual(typeof window, 'undefined')
    browserClient.track('look_view', { slug: 'a', position: 0 })
    browserClient.flushAnalytics()
    assert.strictEqual(browserClient.initAnalytics().enabled, false)
  })
})
