// AI Marketing Manager prototype: the pure demo engine. No browser, no network, no database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { economics, liveCampaigns, nextStep, reducer, review, shownState, totals, type Action } from '../src/components/prototype/marketing-manager/engine'
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

describe('review revisions', () => {
  test('the manager prepares a recommended plan, and the goal can still be changed', () => {
    const s = reducer(seedState(TODAY), { type: 'onboarding/skip' })
    assert.ok(s.draft?.plan, 'a plan is ready without choosing a goal')
    assert.ok(s.draft?.recommended && s.draft.recommended.length > 20, 'with a reason')
    const step = nextStep(s)
    assert.equal(step.cta, 'Review replies')
    assert.equal(step.also?.cta, 'Review recommended plan')
    assert.match(step.title, /customers need your reply\. I've also prepared your next campaign for review\./)
    const changed = run(s, { type: 'draft/start', input: { goal: 'repeat', weeks: 1, budget: 50 } }, { type: 'draft/plan', variant: 0 })
    assert.equal(changed.draft?.plan?.goal, 'repeat')
    assert.equal(changed.draft?.recommended, undefined)
  })

  test('accepting a new plan keeps the running campaign unless replacing is chosen', () => {
    let s = accepted()
    const first = active(s)
    s = run(s, { type: 'material/approveAll', campaignId: first.id }, { type: 'campaign/schedule', id: first.id }, { type: 'day/advance' })
    const firstPlacements = s.placements.filter((p) => p.campaignId === first.id).length
    const plan2 = (x: DemoState) => run(x, { type: 'draft/start', input: { goal: 'repeat', weeks: 1, budget: 50 } }, { type: 'draft/plan', variant: 0 })
    const kept = reducer(plan2(s), { type: 'draft/accept', mode: 'after' })
    assert.equal(liveCampaigns(kept).length, 2)
    assert.equal(kept.campaigns.find((c) => c.id === first.id)!.status, 'active')
    assert.equal(kept.placements.filter((p) => p.campaignId === first.id).length, firstPlacements, 'nothing withdrawn')
    const second = liveCampaigns(kept)[1]
    assert.equal(second.startDate, addDays(first.endDate, 1))
    assert.ok(kept.materials.filter((m) => m.campaignId === second.id).every((m) => m.date >= second.startDate))
    const replaced = reducer(plan2(s), { type: 'draft/accept', mode: 'replace' })
    assert.equal(replaced.campaigns.find((c) => c.id === first.id)!.status, 'ended')
    assert.equal(liveCampaigns(replaced).length, 1)
  })

  test('each channel format has its own material and approval', () => {
    let s = accepted()
    const c = active(s)
    const discovery = s.materials.filter((m) => m.campaignId === c.id && m.stage === 'discovery')
    assert.ok(discovery.length > 1)
    assert.ok(discovery.every((m) => m.formats.length === 1))
    assert.equal(new Set(discovery.map((m) => m.versions[0].caption)).size, discovery.length, 'words differ per format')
    const [a, b] = discovery
    s = reducer(s, { type: 'material/approve', id: a.id, version: 1 })
    assert.equal(s.materials.find((m) => m.id === a.id)!.status, 'approved')
    assert.equal(s.materials.find((m) => m.id === b.id)!.status, 'awaiting', 'approving one format does not approve another')
    // A batch approval covers only the listed versions; a stale version is skipped.
    s = reducer(s, { type: 'material/caption', id: b.id, caption: 'Changed', why: 'edit' })
    s = reducer(s, { type: 'material/approveMany', items: [{ id: b.id, version: 1 }] })
    assert.equal(s.materials.find((m) => m.id === b.id)!.status, 'awaiting')
    s = reducer(s, { type: 'material/approveMany', items: [{ id: b.id, version: 2 }] })
    assert.equal(s.materials.find((m) => m.id === b.id)!.approvedVersion, 2)
  })

  test('approving the ad content does not start spending', () => {
    let s = accepted()
    const c = active(s)
    const ad = s.materials.find((m) => m.campaignId === c.id && m.formats[0] === 'ad')!
    assert.ok(c.plan.adDaily > 0 && ad)
    s = reducer(s, { type: 'campaign/approveAds', id: c.id, approved: true })
    assert.equal(s.campaigns.find((x) => x.id === c.id)!.adApproved, false, 'spending cannot be approved before the ad itself')
    s = run(s, { type: 'material/approveAll', campaignId: c.id }, { type: 'campaign/schedule', id: c.id }, { type: 'day/advance' }, { type: 'day/advance' })
    const pl = s.placements.find((p) => p.materialId === ad.id)!
    assert.equal(shownState(s, pl), 'spend')
    assert.equal(totals(s, c.id).costs.ads, 0)
    s = run(s, { type: 'campaign/approveAds', id: c.id, approved: true }, { type: 'day/advance' })
    assert.equal(s.placements.find((p) => p.id === pl.id)!.state, 'published')
    assert.equal(totals(s, c.id).costs.ads, c.plan.adDaily)
  })

  test('changing a picture, look or storyboard is a new version that needs approval', () => {
    let s = run(accepted(), { type: 'material/approveAll', campaignId: active(accepted()).id })
    const post = s.materials.find((m) => m.formats[0] === 'ig_post' && m.campaignId === active(s).id)!
    s = reducer(s, { type: 'material/visual', id: post.id, patch: { look: 'warm' }, why: 'look' })
    const p2 = s.materials.find((m) => m.id === post.id)!
    assert.equal(p2.versions.length, 2)
    assert.equal(p2.versions[1].look, 'warm')
    assert.equal(p2.versions[1].caption, p2.versions[0].caption, 'words carried forward')
    assert.equal(p2.reapproval, true)
    const reel = s.materials.find((m) => m.formats[0] === 'ig_reel' && m.campaignId === active(s).id)!
    assert.equal(reel.versions[0].scenes?.length, 3)
    const scenes = reel.versions[0].scenes!.map((x, i) => (i === 0 ? { ...x, secs: 6 } : x))
    s = reducer(s, { type: 'material/visual', id: reel.id, patch: { scenes }, why: 'storyboard' })
    assert.equal(s.materials.find((m) => m.id === reel.id)!.status, 'awaiting')
    // The same patch again changes nothing.
    const again = reducer(s, { type: 'material/visual', id: reel.id, patch: { scenes }, why: 'storyboard' })
    assert.equal(again.materials.find((m) => m.id === reel.id)!.versions.length, 2)
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
    s = run(s, { type: 'material/approveAll', campaignId: c.id }, { type: 'campaign/approveAds', id: c.id, approved: true }, { type: 'campaign/schedule', id: c.id }, { type: 'day/advance' })
    const spent = totals(s, c.id).costs.ads
    assert.ok(spent > 0, 'the approved ad spent on its first day')
    s = run(s, { type: 'campaign/pause', id: c.id }, { type: 'day/advance' }, { type: 'day/advance' }, { type: 'day/advance' })
    assert.equal(totals(s, c.id).costs.ads, spent)
    assert.ok(!s.placements.some((p) => p.campaignId === c.id && p.state === 'scheduled'))
  })

  test('running the whole period spends exactly the planned ad budget', () => {
    let s = accepted()
    const c = active(s)
    s = run(s, { type: 'material/approveAll', campaignId: c.id }, { type: 'campaign/approveAds', id: c.id, approved: true }, { type: 'campaign/schedule', id: c.id }, { type: 'connection/set', channel: 'facebook', status: 'connected' })
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

  test('the review does not call missing conversations a leak, and the money line is plain', () => {
    const s = accepted()
    const t = totals(s, 'c-prev')
    const rv = review(s, t, 'c-prev')
    assert.ok(!rv.dropOff.some((x) => /biggest leak/i.test(x)))
    assert.ok(rv.dropOff.some((x) => x.includes('Check whether enquiries were recorded before changing the campaign.')))
    const line = economics(s, t, 'c-prev')
    assert.match(line, /before product costs|not profit/)
    assert.match(line, /may not have been recorded/)
  })

  test('the seeded policies stay unknown and no caption promises them', () => {
    const s = accepted()
    assert.equal(s.business.delivery, null)
    assert.equal(s.business.returns, null)
    for (const m of s.materials) assert.ok(!/delivery|return/i.test(m.versions[0].caption), m.title)
  })
})

describe('independent review fixes', () => {
  const approveRun = (s: DemoState, id: string) => run(s, { type: 'material/approveAll', campaignId: id }, { type: 'campaign/approveAds', id, approved: true }, { type: 'campaign/schedule', id })

  test('the manager does not recommend the campaign that is already planned or running', () => {
    let s = reducer(seedState(TODAY), { type: 'onboarding/skip' })
    const first = s.draft!.plan!
    s = reducer(s, { type: 'draft/accept' })
    s = reducer(s, { type: 'draft/recommend' })
    if (s.draft?.plan) {
      assert.notEqual(s.draft.plan.goal, first.goal)
      assert.notEqual(s.draft.plan.name, first.name)
      assert.doesNotMatch(s.draft.recommended ?? '', /half of your monthly budget/)
    }
  })

  test('a campaign finishes on its own after its last day, and a next plan is recommended', () => {
    let s = accepted()
    const c = active(s)
    s = run(approveRun(s, c.id), { type: 'connection/set', channel: 'facebook', status: 'connected' })
    for (let i = 0; i < c.plan.days + 1; i++) s = reducer(s, { type: 'day/advance' })
    assert.equal(s.campaigns.find((x) => x.id === c.id)!.status, 'ended')
    assert.equal(liveCampaigns(s).length, 0)
    assert.ok(s.draft?.plan && s.draft.recommended, 'a recommended next plan is ready')
    assert.notEqual(nextStep(s).cta, 'See campaign')
    assert.ok(s.draft.plan.startDate > s.today, 'the next plan starts in the future')
  })

  test('ending a campaign early pulls the queued one forward', () => {
    let s = accepted()
    const first = active(s)
    s = run(approveRun(s, first.id), { type: 'day/advance' })
    s = run(s, { type: 'draft/start', input: { goal: 'repeat', weeks: 1, budget: 50 } }, { type: 'draft/plan', variant: 0 }, { type: 'draft/accept', mode: 'after' })
    const second = liveCampaigns(s).find((x) => x.id !== first.id)!
    assert.equal(second.startDate, addDays(first.endDate, 1))
    s = reducer(s, { type: 'campaign/end', id: first.id })
    const moved = s.campaigns.find((x) => x.id === second.id)!
    assert.equal(moved.startDate, addDays(s.today, 1))
    assert.equal(moved.endDate, addDays(moved.startDate, moved.plan.days - 1))
    assert.ok(s.materials.filter((m) => m.campaignId === second.id).every((m) => m.date >= moved.startDate && m.date <= moved.endDate))
  })

  test('replacing a campaign that has not started cancels it without an end before its start', () => {
    let s = accepted()
    const first = active(s)
    assert.ok(first.startDate > s.today)
    s = run(s, { type: 'draft/start', input: { goal: 'repeat', weeks: 1, budget: 50 } }, { type: 'draft/plan', variant: 0 }, { type: 'draft/accept', mode: 'replace' })
    const old = s.campaigns.find((x) => x.id === first.id)!
    assert.equal(old.status, 'ended')
    assert.equal(old.cancelled, true)
    assert.ok(old.endDate >= old.startDate)
  })

  test('an opt-out replaces a promotional suggested reply, and opting in restores it', () => {
    const s0 = seedState(TODAY)
    const before = s0.enquiries.find((e) => e.id === 'e-memory')!
    assert.ok(before.suggestionPromo)
    const out = reducer(s0, { type: 'customer/optOut', id: before.customerId, optedOut: true })
    const e = out.enquiries.find((x) => x.id === 'e-memory')!
    assert.notEqual(e.suggestedReply, before.suggestedReply)
    assert.doesNotMatch(e.suggestedReply, /Occasion Edit/)
    const back = reducer(out, { type: 'customer/optOut', id: before.customerId, optedOut: false })
    assert.equal(back.enquiries.find((x) => x.id === 'e-memory')!.suggestedReply, before.suggestedReply)
  })

  test('resuming runs the items due today', () => {
    let s = accepted()
    const c = active(s)
    s = run(approveRun(s, c.id), { type: 'campaign/pause', id: c.id }, { type: 'day/advance' })
    assert.equal(s.today, c.startDate)
    const post = () => s.placements.find((p) => p.campaignId === c.id && p.format === 'ig_post' && p.date === c.startDate)!
    assert.notEqual(post().state, 'published')
    s = reducer(s, { type: 'campaign/resume', id: c.id })
    assert.equal(post().state, 'published')
  })

  test('a published ad stops spending when its content is changed or sent back', () => {
    let s = accepted()
    const c = active(s)
    s = run(approveRun(s, c.id), { type: 'day/advance' })
    const spent = totals(s, c.id).costs.ads
    assert.ok(spent > 0)
    const ad = s.materials.find((m) => m.campaignId === c.id && m.formats[0] === 'ad')!
    s = run(s, { type: 'material/caption', id: ad.id, caption: 'Changed words', why: 'edit' }, { type: 'day/advance' }, { type: 'day/advance' })
    assert.equal(totals(s, c.id).costs.ads, spent)
  })

  test('revisions that cannot change anything make no new version', () => {
    let s = accepted()
    const m = s.materials.find((x) => x.campaignId === active(s).id && x.formats[0] === 'ig_post')!
    s = run(s, { type: 'material/revise', id: m.id, style: 'warmer', why: 'w' }, { type: 'material/revise', id: m.id, style: 'warmer', why: 'w' })
    assert.equal(s.materials.find((x) => x.id === m.id)!.versions.length, 2)
    for (let i = 0; i < 4; i++) s = reducer(s, { type: 'material/revise', id: m.id, style: 'shorter', why: 's' })
    const last = s.materials.find((x) => x.id === m.id)!
    assert.ok(last.versions.length < 6, 'shorter stops once nothing is left to remove')
    if (m.versions[0].caption.includes('\n\n#')) assert.match(last.versions.at(-1)!.caption, /#/, 'hashtags kept')
  })
})
