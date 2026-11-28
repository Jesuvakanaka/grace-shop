// ZP-1124 (MM-04-AC3/AC4, MM-09-AC1 to AC3): pure rules. Campaign dates in shop time, the
// UNCERTAIN status and its owner actions, the buttons, and connector failures marked uncertain.
import { describe, test } from 'node:test'
import assert from 'node:assert'

import { campaignBlockReason, campaignHasEnded, shopDay, type WindowCampaign } from '../src/lib/marketing/campaign-window'
import { transition, POST_STATUSES, OWNER_ACTIONS, SYSTEM_ACTIONS, type Actor, type StatePost } from '../src/lib/marketing/state'
import { availableActions, STATUS_LABELS, STATUS_CLASSES } from '../src/lib/marketing/ui'
import { networkFailure } from '../src/lib/marketing/connectors/common'
import { failureOf, MetaGraphError } from '../src/lib/marketing/connectors/meta-graph'
import { failureOfGoogle, GoogleApiError } from '../src/lib/marketing/connectors/google-oauth'
import { WebsiteError } from '../src/lib/website/http'

const owner: Actor = { username: 'mike', role: 'OWNER' }
const staff: Actor = { username: 'sam', role: 'STAFF' }
const system: Actor = { username: 'runner', role: 'SYSTEM' }

const throws409 = (fn: () => unknown, re?: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof WebsiteError && e.status === 409 && (!re || re.test(e.message)))

// The campaign page stores a chosen day as UTC midnight ("2026-12-05" -> 2026-12-05T00:00:00Z).
const campaign = (over: Partial<WindowCampaign> = {}): WindowCampaign => ({
  id: 1, name: 'Party edit', status: 'ACTIVE',
  startsAt: new Date('2026-12-01T00:00:00Z'), endsAt: new Date('2026-12-05T00:00:00Z'), ...over,
})

describe('campaign window (shop time, Africa/Harare = UTC+2, both days inclusive)', () => {
  test('shopDay uses the shop time zone', () => {
    assert.strictEqual(shopDay(new Date('2026-12-05T21:59:00Z')), '2026-12-05') // 23:59 in Harare
    assert.strictEqual(shopDay(new Date('2026-12-05T22:00:00Z')), '2026-12-06') // midnight in Harare
    assert.strictEqual(shopDay(new Date('2026-12-05T00:00:00Z')), '2026-12-05')
  })

  test('the whole last day is allowed; one minute after midnight it is not', () => {
    const c = campaign()
    assert.strictEqual(campaignBlockReason(c, new Date('2026-12-05T21:59:00Z')), null)
    assert.strictEqual(campaignHasEnded(c, new Date('2026-12-05T21:59:00Z')), false)
    assert.match(campaignBlockReason(c, new Date('2026-12-05T22:01:00Z')) ?? '', /ended on 5 Dec 2026/)
    assert.strictEqual(campaignHasEnded(c, new Date('2026-12-05T22:01:00Z')), true)
  })

  test('approving on the final day never extends the campaign (the next morning is refused)', () => {
    const c = campaign()
    // Approved late on the last day, due the next morning.
    assert.match(campaignBlockReason(c, new Date('2026-12-06T06:00:00Z')) ?? '', /Nothing goes out after its last day/)
  })

  test('nothing before the first day', () => {
    const c = campaign()
    assert.match(campaignBlockReason(c, new Date('2026-11-30T21:59:00Z')) ?? '', /starts on 1 Dec 2026/)
    assert.strictEqual(campaignBlockReason(c, new Date('2026-11-30T22:00:00Z')), null) // midnight on 1 Dec in Harare
  })

  test('paused, ended and archived campaigns block, whatever the dates', () => {
    const inside = new Date('2026-12-03T10:00:00Z')
    assert.match(campaignBlockReason(campaign({ status: 'PAUSED' }), inside) ?? '', /paused/)
    assert.match(campaignBlockReason(campaign({ status: 'ENDED' }), inside) ?? '', /has ended/)
    assert.match(campaignBlockReason(campaign({ status: 'ARCHIVED' }), inside) ?? '', /archived/)
    assert.strictEqual(campaignBlockReason(campaign({ status: 'DRAFT' }), inside), null)
  })

  test('no campaign, or no dates, means no date limit', () => {
    assert.strictEqual(campaignBlockReason(null, new Date()), null)
    assert.strictEqual(campaignBlockReason(campaign({ startsAt: null, endsAt: null }), new Date('2030-01-01T00:00:00Z')), null)
    assert.strictEqual(campaignHasEnded({ endsAt: null }, new Date('2030-01-01T00:00:00Z')), false)
  })
})

const post = (over: Partial<StatePost> = {}): StatePost => ({
  status: 'UNCERTAIN', channelKind: 'FACEBOOK_PAGE', scheduledFor: null, approvedBy: 'mike', approvedAt: new Date(), attempts: 1, ...over,
})

describe('UNCERTAIN status (MM-09-AC1 to AC3)', () => {
  test('is a known status with an owner-facing label and colour', () => {
    assert.ok((POST_STATUSES as readonly string[]).includes('UNCERTAIN'))
    assert.strictEqual(STATUS_LABELS.UNCERTAIN, 'Not sure it went out')
    assert.ok(STATUS_CLASSES.UNCERTAIN)
    assert.ok((OWNER_ACTIONS as readonly string[]).includes('confirm_published'))
    assert.ok((SYSTEM_ACTIONS as readonly string[]).includes('uncertain'))
  })

  test('only a PUBLISHING attempt can become uncertain', () => {
    assert.deepStrictEqual(transition(post({ status: 'PUBLISHING' }), 'uncertain', system, { error: 'timeout' }), { status: 'UNCERTAIN', error: 'timeout' })
    for (const s of ['APPROVED', 'SCHEDULED', 'FAILED', 'PUBLISHED']) throws409(() => transition(post({ status: s }), 'uncertain', system))
  })

  test('never retried, published, cancelled or edited until the owner checks', () => {
    for (const a of ['retry', 'publish', 'start', 'cancel', 'edit', 'share', 'schedule'] as const) {
      throws409(() => transition(post(), a, owner, { scheduledFor: new Date(Date.now() + 86_400_000) }))
    }
  })

  test('published requires the platform ID (from PUBLISHING, or from UNCERTAIN when a late answer arrives)', () => {
    throws409(() => transition(post({ status: 'PUBLISHING' }), 'published', system), /returns its ID/)
    throws409(() => transition(post({ status: 'PUBLISHING' }), 'published', system, { externalId: '  ' }), /returns its ID/)
    assert.strictEqual(transition(post({ status: 'PUBLISHING' }), 'published', system, { externalId: 'p1' }).status, 'PUBLISHED')
    assert.strictEqual(transition(post(), 'published', system, { externalId: 'p1' }).status, 'PUBLISHED')
    assert.strictEqual(transition(post(), 'failed', system, { error: 'no' }).status, 'FAILED')
  })

  test('owner confirms it went out with a link, or that it did not (then Try again is possible)', () => {
    const now = new Date('2026-12-03T10:00:00Z')
    throws409(() => transition(post(), 'confirm_published', owner, { now }), /Paste the link/)
    throws409(() => transition(post(), 'confirm_published', owner, { now, externalUrl: 'facebook.com/x' }), /Paste the link/)
    assert.deepStrictEqual(
      transition(post(), 'confirm_published', owner, { now, externalUrl: ' https://www.facebook.com/1_2 ' }),
      { status: 'PUBLISHED', publishedAt: now, externalUrl: 'https://www.facebook.com/1_2', error: null },
    )
    assert.strictEqual(transition(post(), 'confirm_not_published', owner).status, 'FAILED')
    const failed = { ...post(), status: 'FAILED' }
    assert.strictEqual(transition(failed, 'retry', owner).status, 'PUBLISHING')
  })

  test('only the owner can confirm', () => {
    throws409(() => transition(post(), 'confirm_published', staff, { externalUrl: 'https://x.example/1' }), /owner/)
    throws409(() => transition(post(), 'confirm_not_published', system), /owner/)
    for (const s of ['PUBLISHING', 'FAILED', 'PUBLISHED']) throws409(() => transition(post({ status: s }), 'confirm_not_published', owner))
  })

  test('the buttons for an uncertain post: check first, no Try again', () => {
    const b = availableActions({ status: 'UNCERTAIN', channelKind: 'FACEBOOK_PAGE', attempts: 1 })
    assert.deepStrictEqual(b.map((x) => x.action), ['confirm_published', 'confirm_not_published'])
    assert.strictEqual(b[0].needsLink, true)
  })
})

describe('connector failures that may have reached the platform are uncertain', () => {
  test('a broken connection (fetch threw)', () => {
    assert.strictEqual(networkFailure('X', new Error('socket hang up')).uncertain, true)
  })
  test('Meta and Google: no HTTP answer is uncertain, an HTTP error is not', () => {
    assert.strictEqual(failureOf(new MetaGraphError('Could not reach Meta.', null, null, null, 0, null)).uncertain, true)
    assert.strictEqual(failureOf(new MetaGraphError('Bad request', 100, null, null, 400, null)).uncertain, undefined)
    assert.strictEqual(failureOfGoogle(new GoogleApiError('Could not reach Google.', 0, true)).uncertain, true)
    assert.strictEqual(failureOfGoogle(new GoogleApiError('Refused', 403, false)).uncertain, undefined)
  })
})
