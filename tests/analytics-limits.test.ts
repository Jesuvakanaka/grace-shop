/**
 * ZP-493 (review F1/F3): abuse limits of POST /api/public/events, in memory
 * (src/lib/analytics/limits.ts), with a fake clock.
 * - EventBudget: a token bucket charged per event (not per request).
 * - DailyCounter: events per visit id per analytics day.
 * - NewVisitLimiter: new visit ids per IP per hour.
 * - The default numbers allow ~30 active feed users behind one carrier IP.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  DailyCounter,
  EventBudget,
  IP_EVENT_BUDGET,
  NEW_VISITS_PER_IP_PER_HOUR,
  NewVisitLimiter,
  VISIT_EVENT_BUDGET,
  VISIT_EVENTS_PER_DAY,
} from '../src/lib/analytics/limits'

function clock(start = Date.parse('2026-11-01T08:00:00Z')) {
  let t = start
  return { now: () => t, advance: (ms: number) => void (t += ms) }
}

describe('EventBudget', () => {
  test('charges the cost, refills over time, says when to retry', () => {
    const c = clock()
    const b = new EventBudget({ capacity: 30, refillPerSecond: 10, now: c.now })
    assert.deepStrictEqual(b.take('ip', 20), { ok: true })
    assert.deepStrictEqual(b.take('ip', 10), { ok: true })
    const r = b.take('ip', 5)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(!r.ok && r.retryAfterSeconds, 1)
    c.advance(500) // +5 tokens
    assert.deepStrictEqual(b.take('ip', 5), { ok: true })
    assert.deepStrictEqual(b.take('other', 30), { ok: true }, 'keys are independent')
  })

  test('a refused take does not spend tokens', () => {
    const c = clock()
    const b = new EventBudget({ capacity: 10, refillPerSecond: 0, now: c.now })
    assert.strictEqual(b.take('k', 11).ok, false)
    assert.strictEqual(b.take('k', 10).ok, true)
  })

  test('bounded number of keys (oldest forgotten)', () => {
    const b = new EventBudget({ capacity: 1, refillPerSecond: 0, maxKeys: 2 })
    b.take('a', 1)
    b.take('b', 1)
    b.take('c', 1)
    assert.strictEqual(b.size, 2)
    assert.strictEqual(b.take('a', 1).ok, true, 'a was evicted, so it starts full again')
  })
})

describe('DailyCounter', () => {
  test('caps events per key per day and resets the next day', () => {
    const c = clock()
    const d = new DailyCounter({ limit: 25, now: c.now })
    assert.strictEqual(d.add('v', 20), true)
    assert.strictEqual(d.add('v', 6), false, 'would exceed 25')
    assert.strictEqual(d.add('v', 5), true)
    assert.strictEqual(d.add('v', 1), false)
    c.advance(24 * 3_600_000)
    assert.strictEqual(d.add('v', 20), true)
  })
})

describe('NewVisitLimiter', () => {
  test('caps new visit ids per IP per hour; known ids keep working', () => {
    const c = clock()
    const n = new NewVisitLimiter({ perHour: 2, now: c.now })
    assert.strictEqual(n.allow('ip', 'v1'), true)
    assert.strictEqual(n.allow('ip', 'v2'), true)
    assert.strictEqual(n.allow('ip', 'v1'), true, 'already seen this hour')
    assert.strictEqual(n.allow('ip', 'v3'), false)
    assert.strictEqual(n.allow('ip2', 'v3'), true, 'another address')
    c.advance(3_600_000)
    assert.strictEqual(n.allow('ip', 'v3'), true, 'new hour')
  })
})

describe('default numbers (carrier-grade NAT: ~30 active feed users per IP)', () => {
  test('30 users each sending a full batch at once fit the IP burst', () => {
    assert.ok(IP_EVENT_BUDGET.capacity >= 30 * 21, 'a full 20-event batch costs 21 (request + events)')
  })
  test('30 users at 0.5 events/s each fit the IP sustained rate', () => {
    assert.ok(IP_EVENT_BUDGET.refillPerSecond >= 30 * 0.5)
  })
  test('one visit cannot use more than a small share', () => {
    assert.ok(VISIT_EVENT_BUDGET.capacity <= IP_EVENT_BUDGET.capacity / 2)
    assert.ok(VISIT_EVENTS_PER_DAY >= 1_000 && VISIT_EVENTS_PER_DAY <= 5_000)
    assert.ok(NEW_VISITS_PER_IP_PER_HOUR >= 60)
  })
})
