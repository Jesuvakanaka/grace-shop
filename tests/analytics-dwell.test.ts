/**
 * ZP-493: dwell rules (src/lib/analytics/dwell.ts), with a fake clock, a fake
 * page-visibility source and a fake IntersectionObserver.
 * - Counts only while in view (>= 60% visible) AND the page is visible.
 * - Pauses on screen lock / app switch, emits on leave and on hide.
 * - Ignores views under 0.5 s, caps one dwell at 60 s.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  DWELL_MAX_SECONDS,
  DWELL_MIN_SECONDS,
  DWELL_VISIBLE_RATIO,
  createDwellTimer,
  createDwellTracker,
  type PageVisibilitySource,
} from '../src/lib/analytics/dwell'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => void (t += ms) }
}

function fakeVisibility(initial = true) {
  let visible = initial
  const listeners = new Set<(v: boolean) => void>()
  const source: PageVisibilitySource = {
    isVisible: () => visible,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return {
    source,
    set(v: boolean) {
      visible = v
      for (const fn of [...listeners]) fn(v)
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

function setup() {
  const c = clock()
  const vis = fakeVisibility()
  const dwells: number[] = []
  const timer = createDwellTimer({ onDwell: (s) => dwells.push(s), now: c.now, visibility: vis.source })
  return { c, vis, dwells, timer }
}

describe('createDwellTimer', () => {
  test('constants follow the spec', () => {
    assert.strictEqual(DWELL_MIN_SECONDS, 0.5)
    assert.strictEqual(DWELL_MAX_SECONDS, 60)
    assert.strictEqual(DWELL_VISIBLE_RATIO, 0.6)
  })

  test('emits the seconds in view when the look leaves', () => {
    const { c, dwells, timer } = setup()
    timer.setInView(true)
    c.advance(4_200)
    timer.setInView(false)
    assert.deepStrictEqual(dwells, [4.2])
  })

  test('does not count while not in view', () => {
    const { c, dwells, timer } = setup()
    c.advance(10_000)
    timer.setInView(false)
    timer.flush()
    assert.deepStrictEqual(dwells, [])
  })

  test('ignores flicks under 0.5 s', () => {
    const { c, dwells, timer } = setup()
    timer.setInView(true)
    c.advance(499)
    timer.setInView(false)
    timer.setInView(true)
    c.advance(500)
    timer.setInView(false)
    assert.deepStrictEqual(dwells, [0.5])
  })

  test('caps one dwell at 60 s (phone left on a table)', () => {
    const { c, dwells, timer } = setup()
    timer.setInView(true)
    c.advance(10 * 60_000)
    timer.setInView(false)
    assert.deepStrictEqual(dwells, [60])
  })

  test('page hidden: emits what was counted and pauses; resumes when visible again', () => {
    const { c, vis, dwells, timer } = setup()
    timer.setInView(true)
    c.advance(3_000)
    vis.set(false) // screen lock / app switch
    assert.deepStrictEqual(dwells, [3])
    c.advance(120_000) // locked: not counted
    vis.set(true)
    c.advance(2_000)
    timer.setInView(false)
    assert.deepStrictEqual(dwells, [3, 2])
  })

  test('in view while the page is hidden does not count until it is visible', () => {
    const { c, vis, dwells, timer } = setup()
    vis.set(false)
    timer.setInView(true)
    c.advance(5_000)
    vis.set(true)
    c.advance(1_000)
    timer.setInView(false)
    assert.deepStrictEqual(dwells, [1])
  })

  test('repeated setInView(true) does not restart or double count', () => {
    const { c, dwells, timer } = setup()
    timer.setInView(true)
    c.advance(1_000)
    timer.setInView(true)
    c.advance(1_000)
    timer.setInView(false)
    timer.setInView(false)
    assert.deepStrictEqual(dwells, [2])
  })

  test('flush emits now and keeps counting from zero', () => {
    const { c, dwells, timer } = setup()
    timer.setInView(true)
    c.advance(2_000)
    timer.flush()
    c.advance(1_000)
    timer.setInView(false)
    assert.deepStrictEqual(dwells, [2, 1])
  })

  test('dispose emits the pending dwell, unsubscribes, and ignores later calls', () => {
    const { c, vis, dwells, timer } = setup()
    assert.strictEqual(vis.listenerCount, 1)
    timer.setInView(true)
    c.advance(1_500)
    timer.dispose()
    assert.deepStrictEqual(dwells, [1.5])
    assert.strictEqual(vis.listenerCount, 0)
    timer.setInView(true)
    c.advance(5_000)
    timer.setInView(false)
    assert.deepStrictEqual(dwells, [1.5])
  })

  test('seconds are rounded to 2 decimals', () => {
    const { c, dwells, timer } = setup()
    timer.setInView(true)
    c.advance(1_234.567)
    timer.setInView(false)
    assert.deepStrictEqual(dwells, [1.23])
  })
})

describe('createDwellTracker (IntersectionObserver)', () => {
  type Entry = { isIntersecting: boolean; intersectionRatio: number; target: unknown }
  class FakeObserver {
    static last: FakeObserver | null = null
    callback: (entries: Entry[]) => void
    options: { threshold?: number | number[]; root?: unknown }
    observed: unknown[] = []
    disconnected = false
    constructor(cb: (entries: Entry[]) => void, options: { threshold?: number | number[]; root?: unknown }) {
      this.callback = cb
      this.options = options
      FakeObserver.last = this
    }
    observe(el: unknown) {
      this.observed.push(el)
    }
    disconnect() {
      this.disconnected = true
    }
    fire(ratio: number) {
      this.callback([{ isIntersecting: ratio > 0, intersectionRatio: ratio, target: this.observed[0] }])
    }
  }

  test('in view means at least 60% visible', () => {
    const c = clock()
    const vis = fakeVisibility()
    const dwells: number[] = []
    const el = { id: 'slide' }
    const tracker = createDwellTracker(el as unknown as Element, {
      onDwell: (s) => dwells.push(s),
      now: c.now,
      visibility: vis.source,
      IntersectionObserver: FakeObserver as unknown as typeof IntersectionObserver,
    })
    const io = FakeObserver.last!
    assert.deepStrictEqual(io.observed, [el])
    assert.ok(Array.isArray(io.options.threshold) && (io.options.threshold as number[]).includes(0.6))

    io.fire(0.3) // peeking in
    c.advance(2_000)
    io.fire(0.65)
    c.advance(3_000)
    io.fire(0.59) // scrolled mostly away
    assert.deepStrictEqual(dwells, [3])

    io.fire(1)
    c.advance(1_000)
    tracker.stop()
    assert.deepStrictEqual(dwells, [3, 1])
    assert.strictEqual(io.disconnected, true)
  })

  test('passes a custom root (photo carousel)', () => {
    const root = { id: 'carousel' }
    createDwellTracker({} as Element, {
      onDwell: () => {},
      root: root as unknown as Element,
      visibility: fakeVisibility().source,
      IntersectionObserver: FakeObserver as unknown as typeof IntersectionObserver,
    }).stop()
    assert.strictEqual(FakeObserver.last!.options.root, root)
  })

  test('no IntersectionObserver (old browser / server): a no-op tracker', () => {
    const tracker = createDwellTracker({} as Element, { onDwell: () => assert.fail('no dwell'), IntersectionObserver: null })
    tracker.stop()
  })
})
