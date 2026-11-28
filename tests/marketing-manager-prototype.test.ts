// AI Marketing Manager prototype: the pure demo engine. No browser, no network, no database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { reducer, shownState, totals, type Action } from '../src/components/prototype/marketing-manager/engine'
import { planCosts, planSteps, recipientsFor, reshapePlan, buildPlan } from '../src/components/prototype/marketing-manager/plan'
import { EXAMPLE_BUSINESS, seedState } from '../src/components/prototype/marketing-manager/seed'
import { addDays } from '../src/components/prototype/marketing-manager/dates'
import type { DemoState } from '../src/components/prototype/marketing-manager/types'

const TODAY = '2026-11-28'
const run = (s: DemoState, ...actions: Action[]) => actions.reduce(reducer, s)

/** Skip onboarding, plan "Promote a new collection" for 2 weeks at $150, accept it. */
function accepted(): DemoState {
  return run(seedState(TODAY),
    { type: 'onboarding/skip' },
    { type: 'draft/start', input: { goal: 'collection', weeks: 2, budget: 150 } },
    { type: 'draft/plan', variant: 0 },
    { type: 'draft/accept' })
}

const active = (s: DemoState) => s.campaigns.find((c) => c.status === 'active')!

describe('plan', () => {
  test('stays within budget and the schedule fits the period', () => {
    const s = seedState(TODAY)
    for (const goal of ['reach', 'convert', 'collection', 'repeat'] as const) {
      for (const weeks of [1, 2, 4] as const) {
        for (const variant of [0, 1]) {
          const plan = buildPlan({ goal, weeks, budget: 150 }, EXAMPLE_BUSINESS, TODAY, variant, recipientsFor(s.customers))
          const c = planCosts(plan, recipientsFor(s.customers))
          assert.ok(c.total <= plan.budget, `${goal}/${weeks}/${variant} costs ${c.total} > ${plan.budget}`)
          assert.equal(c.ads, plan.adDaily * c.adDays)
          const end = addDays(plan.startDate, plan.days - 1)
          for (const step of planSteps(plan)) assert.ok(step.date >= plan.startDate && step.date <= end)
          assert.ok(planSteps(plan).every((st) => st.formats.length > 0))
        }
      }
    }
  })

  test('a tiny budget drops ads rather than pretending', () => {
    const plan = buildPlan({ goal: 'collection', weeks: 2, budget: 10 }, EXAMPLE_BUSINESS, TODAY, 0, 39)
    assert.ok(!plan.channels.some((c) => c.id === 'meta_ads'))
    assert.equal(plan.adDaily, 0)
  })

  test('editing the period keeps ad spend within budget', () => {
    const plan = buildPlan({ goal: 'collection', weeks: 1, budget: 150 }, EXAMPLE_BUSINESS, TODAY, 0, 39)
    const longer = reshapePlan(plan, { days: 28 }, 39, 'Harare')
    assert.ok(planCosts(longer, 39).total <= longer.budget)
  })
})

describe('approvals', () => {
  test('approval covers only the version shown, and editing needs approval again', () => {
    let s = accepted()
    const m = s.materials.find((x) => x.campaignId === active(s).id)!
    // A stale approval (version 2 when version 1 is shown) is ignored.
    s = reducer(s, { type: 'material/approve', id: m.id, version: 2 })
    assert.equal(s.materials.find((x) => x.id === m.id)!.status, 'awaiting')
    s = reducer(s, { type: 'material/approve', id: m.id, version: 1 })
    assert.equal(s.materials.find((x) => x.id === m.id)!.approvedVersion, 1)
    s = reducer(s, { type: 'material/caption', id: m.id, caption: 'New words', why: 'edit' })
    const after = s.materials.find((x) => x.id === m.id)!
    assert.equal(after.status, 'awaiting')
    assert.equal(after.reapproval, true)
    assert.equal(after.versions.length, 2)
  })

  test('nothing unapproved is ever shown as scheduled or goes out', () => {
    let s = accepted()
    const c = active(s)
    s = run(s, { type: 'campaign/schedule', id: c.id }, { type: 'day/advance' }, { type: 'day/advance' })
    for (const p of s.placements.filter((x) => x.campaignId === c.id)) {
      assert.equal(shownState(s, p), 'awaiting')
      assert.notEqual(p.state, 'published')
    }
  })
})

describe('running the campaign', () => {
  test('connected channels publish, the expired one fails, manual ones wait, and a retry needs a fix', () => {
    let s = accepted()
    const c = active(s)
    s = run(s, { type: 'material/approveAll', campaignId: c.id }, { type: 'campaign/schedule', id: c.id }, { type: 'day/advance' })
    const day0 = s.placements.filter((p) => p.campaignId === c.id && p.date === c.startDate)
    assert.equal(day0.find((p) => p.format === 'ig_post')!.state, 'published')
    const fb = day0.find((p) => p.format === 'fb_post')!
    assert.equal(fb.state, 'failed')
    s = reducer(s, { type: 'placement/retry', id: fb.id })
    assert.equal(s.placements.find((p) => p.id === fb.id)!.state, 'failed', 'retry without reconnecting still fails')
    s = run(s, { type: 'connection/set', channel: 'facebook', status: 'connected' }, { type: 'placement/retry', id: fb.id })
    assert.equal(s.placements.find((p) => p.id === fb.id)!.state, 'published')
  })

  test('paused campaigns publish nothing and the ad stops spending', () => {
    let s = accepted()
    const c = active(s)
    s = run(s, { type: 'material/approveAll', campaignId: c.id }, { type: 'campaign/schedule', id: c.id }, { type: 'day/advance' })
    const spent = totals(s, c.id).costs.ads
    s = run(s, { type: 'campaign/pause', id: c.id }, { type: 'day/advance' }, { type: 'day/advance' }, { type: 'day/advance' })
    assert.equal(totals(s, c.id).costs.ads, spent)
    assert.ok(!s.placements.some((p) => p.campaignId === c.id && p.state === 'scheduled'))
  })

  test('running the whole period spends exactly the planned ad budget', () => {
    let s = accepted()
    const c = active(s)
    s = run(s, { type: 'material/approveAll', campaignId: c.id }, { type: 'campaign/schedule', id: c.id }, { type: 'connection/set', channel: 'facebook', status: 'connected' })
    for (let i = 0; i < c.plan.days + 3; i++) s = reducer(s, { type: 'day/advance' })
    const t = totals(s, c.id)
    const planned = planCosts(c.plan, recipientsFor(s.customers))
    assert.equal(t.costs.ads, planned.ads)
    assert.equal(t.costs.content, planned.content)
    assert.equal(t.costs.messaging, planned.messaging)
  })
})

describe('customers and results', () => {
  test('recording a sale counts once and totals reconcile', () => {
    let s = accepted()
    const before = totals(s, 'all')
    s = run(s,
      { type: 'enquiry/sale', id: 'e-tendai', amount: 85, source: { kind: 'tracked', channel: 'meta_ads' } },
      { type: 'enquiry/sale', id: 'e-tendai', amount: 85, source: { kind: 'tracked', channel: 'meta_ads' } })
    const after = totals(s, 'all')
    assert.equal(after.sales, before.sales + 1)
    assert.equal(after.revenue, before.revenue + 85)
    for (const key of ['reach', 'visits', 'clicks', 'enquiries', 'sales', 'revenue'] as const) {
      assert.equal(after.rows.reduce((sum, r) => sum + r[key], 0), after[key], `rows add up for ${key}`)
    }
    const bySource = after.bySource.tracked.sales + after.bySource.reported.sales + after.bySource.unknown.sales
    assert.equal(bySource, after.sales)
  })

  test('unknown-source sales are never credited to a campaign', () => {
    const s = reducer(accepted(), { type: 'enquiry/sale', id: 'e-rumbi', amount: 65, source: { kind: 'unknown' } })
    const sale = s.sales.find((x) => x.enquiryId === 'e-rumbi')!
    assert.equal(sale.campaignId, null)
  })

  test('an opt-out blocks promotional follow-ups', () => {
    let s = seedState(TODAY)
    assert.equal(s.enquiries.find((e) => e.id === 'e-memory')!.followUp?.kind, 'promo')
    s = reducer(s, { type: 'customer/optOut', id: 'cu-memory', optedOut: true })
    assert.equal(s.enquiries.find((e) => e.id === 'e-memory')!.followUp, undefined)
    s = reducer(s, { type: 'enquiry/followUp', id: 'e-memory', followUp: { date: TODAY, kind: 'promo', note: 'x' } })
    assert.equal(s.enquiries.find((e) => e.id === 'e-memory')!.followUp, undefined)
    s = reducer(s, { type: 'enquiry/followUp', id: 'e-memory', followUp: { date: TODAY, kind: 'service', note: 'x' } })
    assert.equal(s.enquiries.find((e) => e.id === 'e-memory')!.followUp?.kind, 'service')
  })

  test('the seeded policies stay unknown and no caption promises them', () => {
    const s = accepted()
    assert.equal(s.business.delivery, null)
    assert.equal(s.business.returns, null)
    for (const m of s.materials) assert.ok(!/delivery|return/i.test(m.versions[0].caption), m.title)
  })
})
