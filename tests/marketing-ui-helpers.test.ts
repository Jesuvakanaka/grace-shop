// ZP-1200: pure helpers behind the Marketing screens.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  availableActions, centsToUsd, charCount, dayKey, fromLocalInput, groupByFamily, isEditable, liveBlockers, publishedThisWeek,
  shareBundlesReady, shareCaption, toLocalInput, usdToCents, weekBuckets,
} from '../src/lib/marketing/ui'
import { CHANNELS } from '../src/lib/marketing/channels'

const names = (p: { status: string; channelKind: string; attempts?: number }) => availableActions(p).map((a) => a.action)

describe('availableActions', () => {
  test('draft, pending, rejected', () => {
    assert.deepStrictEqual(names({ status: 'DRAFT', channelKind: 'FACEBOOK_PAGE' }), ['submit', 'cancel'])
    assert.deepStrictEqual(names({ status: 'PENDING_APPROVAL', channelKind: 'FACEBOOK_PAGE' }), ['approve', 'reject'])
    assert.deepStrictEqual(names({ status: 'REJECTED', channelKind: 'FACEBOOK_PAGE' }), [])
  })
  test('approved automatic channel can publish and schedule; manual can only be marked shared', () => {
    assert.deepStrictEqual(names({ status: 'APPROVED', channelKind: 'FACEBOOK_PAGE' }), ['publish', 'schedule', 'cancel'])
    assert.deepStrictEqual(names({ status: 'APPROVED', channelKind: 'WHATSAPP_STATUS' }), ['share', 'cancel'])
    assert.ok(availableActions({ status: 'APPROVED', channelKind: 'FACEBOOK_PAGE' }).find((a) => a.action === 'schedule')?.needsDate)
  })
  test('a channel that cannot schedule has no schedule button', () => {
    const noSchedule = CHANNELS.find((c) => c.mode === 'api' && c.capabilities.publish && !c.capabilities.schedule)!
    assert.ok(!names({ status: 'APPROVED', channelKind: noSchedule.kind }).includes('schedule'))
  })
  test('scheduled and failed', () => {
    assert.deepStrictEqual(names({ status: 'SCHEDULED', channelKind: 'FACEBOOK_PAGE' }), ['unschedule', 'cancel'])
    assert.deepStrictEqual(names({ status: 'FAILED', channelKind: 'FACEBOOK_PAGE', attempts: 1 }), ['retry', 'cancel'])
    assert.deepStrictEqual(names({ status: 'FAILED', channelKind: 'FACEBOOK_PAGE', attempts: 3 }), ['cancel'])
    assert.deepStrictEqual(names({ status: 'PUBLISHED', channelKind: 'FACEBOOK_PAGE' }), [])
  })
  test('isEditable', () => {
    assert.ok(isEditable('APPROVED') && isEditable('DRAFT'))
    assert.ok(!isEditable('PUBLISHED') && !isEditable('PUBLISHING') && !isEditable('CANCELLED'))
  })
})

describe('text and captions', () => {
  test('charCount', () => {
    assert.deepStrictEqual(charCount('abc', 100), { count: 3, max: 100, left: 97, over: false, near: false })
    assert.strictEqual(charCount('x'.repeat(95), 100).near, true)
    assert.strictEqual(charCount('x'.repeat(11), 10).over, true)
  })
  test('shareCaption adds the link once', () => {
    assert.strictEqual(shareCaption({ text: ' Hello ', link: 'https://x.test/p?src=mk1' }), 'Hello\n\nhttps://x.test/p?src=mk1')
    assert.strictEqual(shareCaption({ text: 'Hi https://x.test/p?src=mk1', link: 'https://x.test/p?src=mk1' }), 'Hi https://x.test/p?src=mk1')
    assert.strictEqual(shareCaption({ text: 'Hi', link: null }), 'Hi')
  })
})

describe('live status', () => {
  test('lists every reason', () => {
    assert.strictEqual(liveBlockers({ env: false, settings: false, connectedChannels: 0 }).length, 3)
    assert.strictEqual(liveBlockers({ env: true, settings: true, connectedChannels: 2 }).length, 0)
    assert.match(liveBlockers({ env: true, settings: false, connectedChannels: 1 })[0], /Marketing settings/)
  })
})

describe('dates and grouping', () => {
  test('datetime-local round trip', () => {
    const iso = '2026-12-05T10:30:00.000Z'
    assert.strictEqual(fromLocalInput(toLocalInput(iso)), iso)
    assert.strictEqual(toLocalInput(null), '')
    assert.strictEqual(fromLocalInput(''), null)
    assert.strictEqual(fromLocalInput('nonsense'), null)
  })
  test('weekBuckets places scheduled and published posts on their local day', () => {
    const start = new Date(2026, 11, 1)
    const at = (d: number, h: number) => new Date(2026, 11, d, h).toISOString()
    const posts = [
      { id: 1, status: 'SCHEDULED', scheduledFor: at(2, 9), publishedAt: null },
      { id: 2, status: 'PUBLISHED', scheduledFor: at(1, 9), publishedAt: at(3, 15) },
      { id: 3, status: 'SCHEDULED', scheduledFor: at(20, 9), publishedAt: null },
      { id: 4, status: 'DRAFT', scheduledFor: null, publishedAt: null },
    ]
    const b = weekBuckets(posts, start, 7)
    assert.strictEqual(b.length, 7)
    assert.deepStrictEqual(b.find((x) => x.key === dayKey(new Date(2026, 11, 2)))!.posts.map((p) => p.id), [1])
    assert.deepStrictEqual(b.find((x) => x.key === dayKey(new Date(2026, 11, 3)))!.posts.map((p) => p.id), [2])
    assert.strictEqual(b.flatMap((x) => x.posts).length, 2)
  })
  test('publishedThisWeek counts published and shared in the last 7 days', () => {
    const now = new Date('2026-12-10T12:00:00Z')
    const p = (status: string, publishedAt: string | null) => ({ id: 1, status, scheduledFor: null, publishedAt })
    assert.strictEqual(publishedThisWeek([p('PUBLISHED', '2026-12-09T00:00:00Z'), p('SHARED', '2026-12-04T00:00:00Z'), p('PUBLISHED', '2026-12-01T00:00:00Z'), p('SCHEDULED', null)], now), 2)
  })
  test('shareBundlesReady keeps approved manual posts only', () => {
    const r = shareBundlesReady([
      { status: 'APPROVED', channelKind: 'WHATSAPP_STATUS' }, { status: 'APPROVED', channelKind: 'FACEBOOK_PAGE' },
      { status: 'DRAFT', channelKind: 'WHATSAPP_STATUS' }, { status: 'APPROVED', channelKind: 'INFLUENCER' },
    ])
    assert.deepStrictEqual(r.map((x) => x.channelKind), ['WHATSAPP_STATUS', 'INFLUENCER'])
  })
  test('groupByFamily orders families and drops empty ones', () => {
    const g = groupByFamily(CHANNELS)
    assert.strictEqual(g[0].family, 'meta')
    assert.strictEqual(g.reduce((n, x) => n + x.items.length, 0), CHANNELS.length)
    assert.deepStrictEqual(groupByFamily(CHANNELS.filter((c) => c.family === 'offline')).map((x) => x.family), ['offline'])
  })
})

describe('money', () => {
  test('usdToCents', () => {
    assert.strictEqual(usdToCents('12.50'), 1250)
    assert.strictEqual(usdToCents('$1,000'), 100000)
    assert.strictEqual(usdToCents(''), null)
    assert.strictEqual(usdToCents('abc'), undefined)
    assert.strictEqual(usdToCents('-5'), undefined)
    assert.strictEqual(usdToCents('1.234'), undefined)
    assert.strictEqual(centsToUsd(1250), '12.50')
    assert.strictEqual(centsToUsd(null), '')
  })
})
