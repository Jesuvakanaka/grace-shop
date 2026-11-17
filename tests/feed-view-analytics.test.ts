/**
 * ZP-544 / ZP-546: the feed-view A/B test in analytics (pure parts).
 * - visit_start carries an optional `view` (clean | info), only for test visits:
 *   the catalogue accepts it, rejects anything else, and old clients without it stay valid.
 * - testFeedView(dataset): the view only when <html data-feed-view-test="1">.
 * - the tracker adds it to visit_start (and only there).
 * - Insights: the two-proportion z-test and the "not enough data yet" rule.
 * DB parts (rollup per day and view, the Insights section) are in
 * tests/analytics-feed-view-rollup-db.test.ts.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { EVENT_SPECS, FEED_VIEWS, validateEvent } from '../src/lib/analytics/events'
import { testFeedView } from '../src/lib/analytics/context'
import { ANALYTICS_ENDPOINT, createAnalyticsClient, type AnalyticsEnv } from '../src/lib/analytics/client-core'
import {
  FEED_VIEW_MIN_VISITS,
  FEED_VIEW_Z,
  compareFeedViews,
  feedViewVerdict,
  twoProportionZ,
} from '../src/lib/insights/feed-view'
import { reportCsv, INSIGHTS_REPORTS } from '../src/lib/insights/csv'
import { emptyInsights } from '../src/lib/insights/types'

const NOW = new Date('2026-11-17T10:00:00Z')
const VISIT_START = { ref: 'direct', device: 'phone', vw: 390, vh: 844, landing: '/', returning: false }
const start = (props: Record<string, unknown>) => ({
  id: 'e0e0e0e0-0000-4000-8000-000000000001',
  type: 'visit_start',
  at: NOW.getTime(),
  page: '/',
  props,
})

describe('catalogue: visit_start view', () => {
  test('the views are clean and info', () => {
    assert.deepStrictEqual([...FEED_VIEWS], ['clean', 'info'])
    assert.ok(EVENT_SPECS.visit_start.props.view?.optional, 'view is optional')
  })

  test('accepts clean / info, and visit_start without a view (older clients, non-test visits)', () => {
    for (const view of ['clean', 'info']) {
      const r = validateEvent(start({ ...VISIT_START, view }), NOW)
      assert.notStrictEqual(typeof r, 'string', String(r))
      assert.strictEqual((r as { props: Record<string, unknown> }).props.view, view)
    }
    const old = validateEvent(start(VISIT_START), NOW)
    assert.notStrictEqual(typeof old, 'string', String(old))
    assert.ok(!('view' in (old as { props: Record<string, unknown> }).props))
  })

  test('rejects any other view value', () => {
    for (const view of ['CLEAN', 'ab', '', 'grid', 1, true, null]) {
      const r = validateEvent(start({ ...VISIT_START, view }), NOW)
      assert.strictEqual(typeof r, 'string', `view ${JSON.stringify(view)}`)
      assert.match(r as string, /view/)
    }
  })

  test('only visit_start takes a view', () => {
    const r = validateEvent({ ...start({ duration: 1, looks: 1, view: 'info' }), type: 'visit_end' }, NOW)
    assert.match(String(r), /no prop "view"/)
  })
})

describe('testFeedView (DOM-free)', () => {
  test('the view only when the page marks it as a test visit', () => {
    assert.strictEqual(testFeedView({ feedView: 'info', feedViewTest: '1' }), 'info')
    assert.strictEqual(testFeedView({ feedView: 'clean', feedViewTest: '1' }), 'clean')
  })

  test('no test flag (fixed setting, ?view= preview, storage blocked): nothing', () => {
    assert.strictEqual(testFeedView({ feedView: 'info' }), undefined)
    assert.strictEqual(testFeedView({ feedView: 'clean', feedViewTest: '0' }), undefined)
    assert.strictEqual(testFeedView({ feedView: 'info', feedViewTest: 'true' }), undefined)
  })

  test('missing or unknown view, or no dataset at all: nothing', () => {
    assert.strictEqual(testFeedView({ feedViewTest: '1' }), undefined)
    assert.strictEqual(testFeedView({ feedView: 'grid', feedViewTest: '1' }), undefined)
    assert.strictEqual(testFeedView({ feedView: 'INFO', feedViewTest: '1' }), undefined)
    assert.strictEqual(testFeedView({}), undefined)
    assert.strictEqual(testFeedView(null), undefined)
    assert.strictEqual(testFeedView(undefined), undefined)
  })
})

describe('tracker: visit_start carries the test view', () => {
  function env(feedView?: AnalyticsEnv['feedView']) {
    let n = 0
    const sent: Array<{ events: Array<{ type: string; props: Record<string, unknown> }> }> = []
    const store = () => {
      const m = new Map<string, string>()
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    }
    const e: AnalyticsEnv = {
      endpoint: ANALYTICS_ENDPOINT,
      now: () => NOW.getTime(),
      setTimer: () => 1,
      clearTimer: () => {},
      session: store(),
      local: store(),
      sendBeacon: (_url, body) => {
        sent.push(JSON.parse(body))
        return true
      },
      fetch: null,
      randomId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      location: { pathname: '/', search: '', host: 'localhost:3454' },
      referrer: '',
      navigator: { userAgent: 'Mozilla/5.0 (iPhone)', maxTouchPoints: 5 },
      viewport: () => ({ width: 390, height: 844 }),
      visibility: { isVisible: () => true, subscribe: () => () => {} },
      onPageHide: () => {},
      defer: (fn) => fn(),
      ...(feedView ? { feedView } : {}),
    }
    return { e, sent }
  }

  test('a test visit sends view on visit_start, and not on other events', () => {
    const { e } = env(() => 'info')
    const client = createAnalyticsClient(e)
    client.track('look_view', { slug: 'linen-dress', position: 0 })
    const [first, second] = client.pending()
    assert.strictEqual(first.type, 'visit_start')
    assert.strictEqual(first.props.view, 'info')
    assert.ok(!('view' in second.props))
  })

  test('no test view (or no reader): visit_start as before', () => {
    for (const reader of [undefined, () => undefined]) {
      const { e } = env(reader as AnalyticsEnv['feedView'])
      const client = createAnalyticsClient(e)
      const [first] = client.pending()
      assert.strictEqual(first.type, 'visit_start')
      assert.ok(!('view' in first.props))
    }
  })

  test('a reader that throws never breaks the visit', () => {
    const { e } = env(() => {
      throw new Error('no document')
    })
    const client = createAnalyticsClient(e)
    const [first] = client.pending()
    assert.strictEqual(first.type, 'visit_start')
    assert.ok(!('view' in first.props))
  })
})

describe('twoProportionZ', () => {
  test('textbook value (pooled): 60/500 vs 40/500', () => {
    // p1 = .12, p2 = .08, p = .10, se = sqrt(.1 * .9 * (2/500)) = .018974
    const z = twoProportionZ(60, 500, 40, 500)
    assert.ok(z !== null)
    assert.ok(Math.abs(z - 2.1082) < 1e-3, String(z))
    assert.ok(Math.abs((twoProportionZ(40, 500, 60, 500) as number) + 2.1082) < 1e-3, 'sign follows the first group')
  })

  test('equal rates: 0', () => {
    assert.strictEqual(twoProportionZ(10, 100, 20, 200), 0)
  })

  test('undefined cases give null (no visits, or nobody / everybody tapped)', () => {
    assert.strictEqual(twoProportionZ(0, 0, 5, 100), null)
    assert.strictEqual(twoProportionZ(5, 100, 0, 0), null)
    assert.strictEqual(twoProportionZ(0, 300, 0, 300), null)
    assert.strictEqual(twoProportionZ(300, 300, 300, 300), null)
  })

  test('counts outside 0..n are refused', () => {
    assert.strictEqual(twoProportionZ(-1, 100, 5, 100), null)
    assert.strictEqual(twoProportionZ(101, 100, 5, 100), null)
  })
})

describe('feedViewVerdict: the honest rule', () => {
  test('constants', () => {
    assert.strictEqual(FEED_VIEW_MIN_VISITS, 200)
    assert.strictEqual(FEED_VIEW_Z, 1.96)
  })

  const col = (visits: number, taps: number) => ({ visits, whatsappVisits: taps })

  test('both views >= 200 visits and |z| >= 1.96: the view ahead, with both rates', () => {
    const v = feedViewVerdict(col(500, 40), col(500, 60))
    assert.strictEqual(v.kind, 'ahead')
    assert.ok(v.kind === 'ahead')
    assert.strictEqual(v.winner, 'info')
    assert.strictEqual(v.infoRate, 60 / 500)
    assert.strictEqual(v.cleanRate, 40 / 500)
    const w = feedViewVerdict(col(500, 60), col(500, 40))
    assert.ok(w.kind === 'ahead' && w.winner === 'clean')
  })

  test('a big difference but fewer than 200 visits on either side: not enough', () => {
    assert.strictEqual(feedViewVerdict(col(199, 0), col(1000, 300)).kind, 'not-enough')
    assert.strictEqual(feedViewVerdict(col(1000, 0), col(199, 100)).kind, 'not-enough')
  })

  test('enough visits but |z| < 1.96: not enough', () => {
    // 50/500 vs 60/500: z ~ 1.08
    assert.strictEqual(feedViewVerdict(col(500, 50), col(500, 60)).kind, 'not-enough')
  })

  test('exactly at the bar counts (200 visits each, |z| just over 1.96)', () => {
    // 20/200 vs 36/200: p = .14, se = sqrt(.14 * .86 * .01) = .0347, z = .08 / .0347 = 2.305
    const v = feedViewVerdict(col(200, 20), col(200, 36))
    assert.ok(v.kind === 'ahead' && v.winner === 'info')
  })

  test('nobody tapped on either side: not enough (z undefined)', () => {
    assert.strictEqual(feedViewVerdict(col(5000, 0), col(5000, 0)).kind, 'not-enough')
  })
})

describe('compareFeedViews', () => {
  const row = (view: string, visits: number, extra: Partial<Record<'devices' | 'openVisits' | 'enquiringVisits' | 'restockVisits', number>> = {}) => ({
    view,
    visits,
    devices: extra.devices ?? visits,
    openVisits: extra.openVisits ?? 0,
    enquiringVisits: extra.enquiringVisits ?? 0,
    restockVisits: extra.restockVisits ?? 0,
  })

  test('no test visits in the range: null (the section is hidden)', () => {
    assert.strictEqual(compareFeedViews([]), null)
    assert.strictEqual(compareFeedViews([row('clean', 0), row('info', 0)]), null)
  })

  test('one column per view, clean first, with counts and rates of visits', () => {
    const c = compareFeedViews([
      row('info', 10, { devices: 9, openVisits: 5, enquiringVisits: 2, restockVisits: 1 }),
      row('clean', 20, { devices: 18, openVisits: 4, enquiringVisits: 1 }),
    ])
    assert.ok(c)
    assert.deepStrictEqual(
      c.columns.map((x) => x.view),
      ['clean', 'info'],
    )
    const [clean, info] = c.columns
    assert.deepStrictEqual(info, {
      view: 'info',
      visits: 10,
      devices: 9,
      openVisits: 5,
      openRate: 0.5,
      whatsappVisits: 2,
      whatsappRate: 0.2,
      restockVisits: 1,
    })
    assert.strictEqual(clean.openRate, 0.2)
    assert.strictEqual(clean.whatsappRate, 0.05)
    assert.strictEqual(c.verdict.kind, 'not-enough')
    assert.strictEqual(c.minVisits, 200)
  })

  test('only one view has visits: the other column is zeros (rates null), never a winner', () => {
    const c = compareFeedViews([row('info', 900, { enquiringVisits: 90 })])
    assert.ok(c)
    assert.strictEqual(c.columns[0].visits, 0)
    assert.strictEqual(c.columns[0].whatsappRate, null)
    assert.strictEqual(c.verdict.kind, 'not-enough')
    assert.strictEqual(c.z, null)
  })

  test('rows of the same view are summed (days), unknown views ignored', () => {
    const c = compareFeedViews([row('clean', 300, { enquiringVisits: 10 }), row('clean', 300, { enquiringVisits: 14 }), row('info', 600, { enquiringVisits: 48 }), row('grid', 999)])
    assert.ok(c)
    assert.strictEqual(c.columns[0].visits, 600)
    assert.strictEqual(c.columns[0].whatsappVisits, 24)
    // 24/600 = 4% vs 48/600 = 8%: z ~ 2.92
    assert.ok(c.verdict.kind === 'ahead' && c.verdict.winner === 'info')
    assert.ok(c.z !== null && c.z > FEED_VIEW_Z)
  })
})

describe('CSV', () => {
  test('feedviews is a report and exports when empty', () => {
    assert.ok((INSIGHTS_REPORTS as readonly string[]).includes('feedviews'))
    const empty = emptyInsights({ preset: '7d', from: '2026-11-11', to: '2026-11-17', days: 7 })
    const csv = reportCsv(empty, 'feedviews')
    assert.ok(csv.split('\r\n')[0].startsWith('﻿view,'))
  })

  test('feedviews rows: one per view with the verdict', () => {
    const report = {
      ...emptyInsights({ preset: '7d', from: '2026-11-11', to: '2026-11-17', days: 7 }),
      feedViews: compareFeedViews([
        { view: 'clean', visits: 500, devices: 450, openVisits: 100, enquiringVisits: 40, restockVisits: 3 },
        { view: 'info', visits: 500, devices: 460, openVisits: 120, enquiringVisits: 60, restockVisits: 5 },
      ]),
    }
    const lines = reportCsv(report, 'feedviews').trim().split('\r\n')
    assert.strictEqual(lines.length, 3)
    assert.match(lines[1], /^clean,500,450,100,0\.2,40,0\.08,3,/)
    assert.match(lines[2], /^info,500,460,120,0\.24,60,0\.12,5,/)
    assert.match(lines[2], /Info view is ahead/)
  })
})
