// ZP-1200: the ad spend cap maths (Harare months) and the ad status machine. Pure: no database, no network.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  adCommitmentCents, assertWithinCap, computeCommittedCents, harareMonthDays, monthDateBounds, monthsToCheck, remainingDaysInMonth,
} from '../src/lib/marketing/budget'
import { transitionAd, type StateAd } from '../src/lib/marketing/ad-state'
import { WebsiteError } from '../src/lib/website/http'

const utc = (s: string) => new Date(s)
const owner = { username: 'o', role: 'OWNER' as const }
const staff = { username: 's', role: 'STAFF' as const }
const system = { username: 'system', role: 'SYSTEM' as const }

describe('remainingDaysInMonth (Harare, UTC+2)', () => {
  const noon = utc('2026-11-26T10:00:00Z') // 12:00 Harare on 26 Nov
  test('open-ended ad: today to the last day of the month, today counted', () => {
    assert.strictEqual(remainingDaysInMonth({ startsAt: utc('2026-11-01T00:00:00Z'), endsAt: null }, noon), 5)
  })
  test('ends mid-month', () => {
    assert.strictEqual(remainingDaysInMonth({ startsAt: utc('2026-11-01T00:00:00Z'), endsAt: utc('2026-11-28T10:00:00Z') }, noon), 3)
  })
  test('an end at exactly midnight Harare does not include that day', () => {
    assert.strictEqual(remainingDaysInMonth({ startsAt: utc('2026-11-01T00:00:00Z'), endsAt: utc('2026-11-27T22:00:00Z') }, noon), 2)
  })
  test('starts later in the month', () => {
    assert.strictEqual(remainingDaysInMonth({ startsAt: utc('2026-11-29T05:00:00Z'), endsAt: null }, noon), 2)
  })
  test('starts next month: nothing this month, a full month next', () => {
    const ad = { startsAt: utc('2026-12-05T08:00:00Z'), endsAt: null }
    assert.strictEqual(remainingDaysInMonth(ad, noon), 0)
    assert.strictEqual(remainingDaysInMonth(ad, noon, utc('2026-12-15T10:00:00Z')), 27)
  })
  test('already ended', () => {
    assert.strictEqual(remainingDaysInMonth({ startsAt: utc('2026-11-01T00:00:00Z'), endsAt: utc('2026-11-20T10:00:00Z') }, noon), 0)
  })
  test('22:30 UTC on 30 Nov is already 1 December in Harare', () => {
    const now = utc('2026-11-30T22:30:00Z')
    assert.strictEqual(harareMonthDays(now).label, '2026-12')
    assert.strictEqual(remainingDaysInMonth({ startsAt: utc('2026-11-01T00:00:00Z'), endsAt: null }, now), 31)
  })
  test('21:59 UTC on 30 Nov is still 30 November (last day)', () => {
    const now = utc('2026-11-30T21:59:00Z')
    assert.strictEqual(harareMonthDays(now).label, '2026-11')
    assert.strictEqual(remainingDaysInMonth({ startsAt: utc('2026-11-01T00:00:00Z'), endsAt: null }, now), 1)
  })
  test('February in a non-leap year', () => {
    assert.strictEqual(remainingDaysInMonth({ startsAt: utc('2027-02-01T00:00:00Z'), endsAt: null }, utc('2027-02-10T10:00:00Z')), 19)
  })
  test('month bounds are UTC midnights for @db.Date', () => {
    const b = monthDateBounds(utc('2026-11-26T10:00:00Z'))
    assert.strictEqual(b.start.toISOString(), '2026-11-01T00:00:00.000Z')
    assert.strictEqual(b.end.toISOString(), '2026-12-01T00:00:00.000Z')
  })
})

describe('committed spend and the cap', () => {
  const now = utc('2026-11-26T10:00:00Z')
  const ad = (status: string, dailyBudgetCents: number, extra = {}) => ({ status, dailyBudgetCents, startsAt: utc('2026-11-01T00:00:00Z'), endsAt: null, ...extra })

  test('only ACTIVE, PAUSED_ON_PLATFORM, APPROVED and CREATING ads commit money', () => {
    const ads = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'FAILED', 'CANCELLED', 'COMPLETED'].map((s) => ad(s, 1000))
    assert.strictEqual(computeCommittedCents({ ads, recordedSpendCents: 0, now }), 0)
    const live = ['ACTIVE', 'PAUSED_ON_PLATFORM', 'APPROVED', 'CREATING'].map((s) => ad(s, 1000))
    assert.strictEqual(computeCommittedCents({ ads: live, recordedSpendCents: 0, now }), 4 * 1000 * 5)
  })
  test('adds spend already recorded this month', () => {
    assert.strictEqual(computeCommittedCents({ ads: [ad('ACTIVE', 500)], recordedSpendCents: 1234, now }), 2500 + 1234)
  })
  test('a zero or negative budget commits nothing', () => {
    assert.strictEqual(adCommitmentCents(ad('ACTIVE', 0), now), 0)
    assert.strictEqual(adCommitmentCents(ad('ACTIVE', -5), now), 0)
  })

  const proposal = { dailyBudgetCents: 200, startsAt: utc('2026-11-26T00:00:00Z'), endsAt: null } // 5 days = 1000
  test('cap 0 means no spend is possible', () => {
    assert.throws(() => assertWithinCap({ monthlySpendCapCents: 0 }, proposal, 0, now), (e: unknown) => e instanceof WebsiteError && e.status === 409)
    assert.throws(() => assertWithinCap(null, proposal, 0, now), WebsiteError)
  })
  test('exactly the cap passes, one cent over is a 409', () => {
    assert.doesNotThrow(() => assertWithinCap({ monthlySpendCapCents: 1000 }, proposal, 0, now))
    assert.throws(() => assertWithinCap({ monthlySpendCapCents: 999 }, proposal, 0, now), /monthly cap/)
    assert.doesNotThrow(() => assertWithinCap({ monthlySpendCapCents: 1500 }, proposal, 500, now))
    assert.throws(() => assertWithinCap({ monthlySpendCapCents: 1500 }, proposal, 501, now), WebsiteError)
  })
  test('a raise is checked against everything else committed (the changed ad is excluded by the caller)', () => {
    assert.throws(() => assertWithinCap({ monthlySpendCapCents: 3000 }, { ...proposal, dailyBudgetCents: 1000 }, 0, now), WebsiteError)
  })
  test('a zero-budget change spends nothing and passes even with cap 0', () => {
    assert.doesNotThrow(() => assertWithinCap({ monthlySpendCapCents: 0 }, { ...proposal, dailyBudgetCents: 0 }, 0, now))
  })
  test('an ad that starts next month is checked against next month (cap 0 still blocks it)', () => {
    const next = { dailyBudgetCents: 100, startsAt: utc('2026-12-10T08:00:00Z'), endsAt: null }
    assert.strictEqual(adCommitmentCents(next, now), 0)
    assert.throws(() => assertWithinCap({ monthlySpendCapCents: 0 }, next, 0, now), WebsiteError)
    const dec = utc('2026-12-15T10:00:00Z')
    assert.throws(() => assertWithinCap({ monthlySpendCapCents: 1000 }, next, 0, now, dec), WebsiteError) // 22 days x 100
  })
  test('months to check: this month through the end month', () => {
    const labels = (a: { startsAt: Date; endsAt: Date | null }) => monthsToCheck(a, now).map((m) => harareMonthDays(m).label)
    assert.deepStrictEqual(labels({ startsAt: utc('2026-11-26T00:00:00Z'), endsAt: utc('2026-11-28T00:00:00Z') }), ['2026-11'])
    assert.deepStrictEqual(labels({ startsAt: utc('2026-11-26T00:00:00Z'), endsAt: utc('2027-01-15T00:00:00Z') }), ['2026-11', '2026-12', '2027-01'])
    assert.deepStrictEqual(labels({ startsAt: utc('2026-11-26T00:00:00Z'), endsAt: null }), ['2026-11', '2026-12'])
  })
})

describe('ad status machine', () => {
  const ad = (o: Partial<StateAd> = {}): StateAd => ({ status: 'DRAFT', approvedBy: null, approvedAt: null, externalAdId: null, ...o })
  const approved = ad({ status: 'APPROVED', approvedBy: 'o', approvedAt: new Date() })
  const paused = ad({ status: 'PAUSED_ON_PLATFORM', approvedBy: 'o', approvedAt: new Date(), externalAdId: '9' })
  const conflict = (fn: () => unknown, re?: RegExp) => assert.throws(fn, (e: unknown) => e instanceof WebsiteError && e.status === 409 && (!re || re.test(e.message)))

  test('the happy path', () => {
    assert.strictEqual(transitionAd(ad(), 'submit', staff).status, 'PENDING_APPROVAL')
    const a = transitionAd(ad({ status: 'PENDING_APPROVAL' }), 'approve', owner)
    assert.strictEqual(a.status, 'APPROVED')
    assert.strictEqual(a.approvedBy, 'o')
    assert.strictEqual(transitionAd(approved, 'create_on_platform', owner).status, 'CREATING')
    assert.strictEqual(transitionAd(ad({ status: 'CREATING' }), 'created', system).status, 'PAUSED_ON_PLATFORM')
    const s = transitionAd(paused, 'start', owner)
    assert.strictEqual(s.status, 'ACTIVE')
    assert.strictEqual(s.activatedBy, 'o')
    assert.strictEqual(transitionAd(ad({ status: 'ACTIVE' }), 'pause', owner).status, 'PAUSED_ON_PLATFORM')
    assert.strictEqual(transitionAd(ad({ status: 'ACTIVE' }), 'complete', system).status, 'COMPLETED')
  })
  test('only the owner approves, rejects, creates and starts', () => {
    conflict(() => transitionAd(ad({ status: 'PENDING_APPROVAL' }), 'approve', staff), /owner/)
    conflict(() => transitionAd(ad({ status: 'PENDING_APPROVAL' }), 'reject', staff), /owner/)
    conflict(() => transitionAd(approved, 'create_on_platform', staff), /owner/)
    conflict(() => transitionAd(paused, 'start', staff), /owner/)
  })
  test('cannot skip steps: no start before it is on Meta, no create before approval', () => {
    conflict(() => transitionAd(ad(), 'create_on_platform', owner))
    conflict(() => transitionAd(ad({ status: 'APPROVED' }), 'create_on_platform', owner), /approved/)
    conflict(() => transitionAd(approved, 'start', owner))
    conflict(() => transitionAd(ad({ status: 'PAUSED_ON_PLATFORM', externalAdId: null, approvedBy: 'o', approvedAt: new Date() }), 'start', owner), /not on Meta/)
    conflict(() => transitionAd(ad(), 'approve', owner))
  })
  test('a failed creation can be retried while approved, and editing resets the Meta ids', () => {
    assert.strictEqual(transitionAd(ad({ ...approved, status: 'FAILED' }), 'create_on_platform', owner).status, 'CREATING')
    const e = transitionAd(ad({ status: 'FAILED', approvedBy: 'o', approvedAt: new Date() }), 'edit', staff)
    assert.strictEqual(e.status, 'DRAFT')
    assert.strictEqual(e.approvedAt, null)
    assert.strictEqual(e.externalCampaignId, null)
  })
  test('editing clears approval and returns to DRAFT', () => {
    for (const status of ['PENDING_APPROVAL', 'APPROVED', 'REJECTED']) {
      const r = transitionAd(ad({ status, approvedBy: 'o', approvedAt: new Date() }), 'edit', owner)
      assert.strictEqual(r.status, 'DRAFT')
      assert.strictEqual(r.approvedBy, null)
    }
    conflict(() => transitionAd(ad({ status: 'CREATING' }), 'edit', owner))
    conflict(() => transitionAd(paused, 'edit', owner))
  })
  test('a budget or end-date change on an ad on Meta needs approval again and cannot happen while running', () => {
    const r = transitionAd(paused, 'edit_live', owner)
    assert.strictEqual(r.status, 'PAUSED_ON_PLATFORM')
    assert.strictEqual(r.approvedAt, null)
    conflict(() => transitionAd(ad({ status: 'ACTIVE', externalAdId: '9' }), 'edit_live', owner), /Pause/)
    const unapproved = ad({ ...paused, approvedAt: null, approvedBy: null })
    conflict(() => transitionAd(unapproved, 'start', owner), /approved/)
    const re = transitionAd(unapproved, 'approve', owner)
    assert.strictEqual(re.status, 'PAUSED_ON_PLATFORM')
    assert.ok(re.approvedAt)
  })
  test('cancel: not while running; dead ends stay dead', () => {
    conflict(() => transitionAd(ad({ status: 'ACTIVE' }), 'cancel', owner), /Pause/)
    assert.strictEqual(transitionAd(paused, 'cancel', owner).status, 'CANCELLED')
    conflict(() => transitionAd(ad({ status: 'COMPLETED' }), 'cancel', owner))
    conflict(() => transitionAd(ad({ status: 'CANCELLED' }), 'submit', owner))
    conflict(() => transitionAd(ad({ status: 'ACTIVE' }), 'start', owner))
  })
})
