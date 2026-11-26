import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  attemptsLeft, canRewrite, connectFormError, connectedAsText, costText, draftSummary, groupPlanByDay,
  newContentHref, planApplyBody, planResultText, productIdFromQuery, viewOnlineLabel, type PlanItemDto,
} from '../src/lib/marketing/ui'

const item = (postId: number, channelKind: string, when: string, mode: 'api' | 'manual' = 'api'): PlanItemDto => ({
  postId, channelKind, mode, scheduledFor: mode === 'api' ? when : null, suggestedFor: mode === 'api' ? null : when, day: null,
})

describe('marketing ui: AI, plan and connect helpers', () => {
  it('costText', () => {
    assert.equal(costText(2), 'AI cost: 2¢')
    assert.equal(costText(0), 'AI cost: less than 1¢')
    assert.equal(costText(120), 'AI cost: $1.20')
    assert.equal(costText(null), null)
    assert.equal(costText(-1), null)
  })
  it('draftSummary lists failures with channel names', () => {
    const s = draftSummary({ posts: [{ id: 1 }, { id: 2 }], failed: [{ channel: 'INSTAGRAM', reason: 'Too long.' }], costCents: 3 })
    assert.match(s.message, /wrote 2 posts/)
    assert.deepEqual(s.failures, ['Instagram: Too long.'])
    assert.equal(s.cost, 'AI cost: 3¢')
    assert.match(draftSummary({ posts: [], failed: [], costCents: 0 }).message, /did not write/)
  })
  it('canRewrite only for draft and rejected', () => {
    assert.ok(canRewrite('DRAFT') && canRewrite('REJECTED'))
    assert.ok(!canRewrite('APPROVED') && !canRewrite('PUBLISHED'))
  })
  it('groupPlanByDay groups and sorts; planApplyBody skips unticked', () => {
    const items = [item(3, 'INSTAGRAM', '2026-11-28T10:00:00'), item(1, 'FACEBOOK_PAGE', '2026-11-27T19:00:00'), item(2, 'WHATSAPP_STATUS', '2026-11-27T09:00:00', 'manual')]
    const g = groupPlanByDay(items)
    assert.equal(g.length, 2)
    assert.deepEqual(g[0].items.map((i) => i.postId), [2, 1])
    const body = planApplyBody(items, new Set([3]))
    assert.deepEqual(body.map((b) => b.postId).sort(), [1, 2])
    assert.deepEqual(planApplyBody(items, new Set([1, 2, 3])), [])
  })
  it('planResultText', () => {
    assert.equal(planResultText({ postId: 1, result: 'scheduled' }), 'Scheduled')
    assert.match(planResultText({ postId: 1, result: 'suggested' }), /by hand/)
    assert.equal(planResultText({ postId: 1, result: 'failed', error: 'Nope.' }), 'Not scheduled: Nope.')
  })
  it('product query param', () => {
    assert.equal(newContentHref(7), '/marketing/content/new?productId=7')
    assert.equal(productIdFromQuery('?productId=7'), 7)
    assert.equal(productIdFromQuery('?productId=abc'), null)
    assert.equal(productIdFromQuery('?productId=-1'), null)
    assert.equal(productIdFromQuery(''), null)
  })
  it('connectedAsText never shows more than the hint', () => {
    const t = connectedAsText({ name: 'VYRA', tokenHint: '1234', connectedAt: '2026-11-03T10:00:00Z', connectedBy: 'owner' })
    assert.equal(t, 'Connected as VYRA, token ends ...1234, connected on 3 Nov 2026 by owner')
    assert.equal(connectedAsText({ name: 'VYRA', tokenHint: null, connectedAt: null }), 'Connected as VYRA')
  })
  it('connectFormError', () => {
    assert.match(connectFormError('abc', 'tok')!, /Page ID/)
    assert.match(connectFormError('12345', '')!, /token/)
    assert.match(connectFormError('12345', 'a b')!, /spaces/)
    assert.equal(connectFormError('12345', 'EAAB'), null)
  })
  it('attempts and labels', () => {
    assert.equal(attemptsLeft(1), 2)
    assert.equal(attemptsLeft(5), 0)
    assert.equal(attemptsLeft(undefined), 3)
    assert.equal(viewOnlineLabel('INSTAGRAM'), 'View on Instagram')
    assert.equal(viewOnlineLabel('FACEBOOK_PAGE'), 'View on Facebook')
  })
})
