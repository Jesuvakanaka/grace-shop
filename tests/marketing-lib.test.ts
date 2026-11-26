// ZP-1200: pure marketing hub logic: flags, go-live gate, secrets, state machine, tracking, registry.
import { describe, test } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import { hubEnabled, liveAllowedByEnv, assertCanGoLive, checkCanGoLive } from '../src/lib/marketing/flags'
import { encryptSecret, decryptSecret, tokenHint, encryptJson, decryptJson } from '../src/lib/marketing/secrets'
import { CHANNELS, CHANNEL_KINDS, getChannel } from '../src/lib/marketing/channels'
import { transition, POST_STATUSES, MAX_ATTEMPTS, type Actor, type StatePost } from '../src/lib/marketing/state'
import { buildTrackedLink, generateTrackingTag, TRACKING_TAG } from '../src/lib/marketing/tracking'
import { campaignFromSearch, CAMPAIGN_MAX_LENGTH } from '../src/lib/analytics/context'
import { WebsiteError } from '../src/lib/website/http'

const owner: Actor = { username: 'mike', role: 'OWNER' }
const staff: Actor = { username: 'sam', role: 'STAFF' }
const system: Actor = { username: 'runner', role: 'SYSTEM' }
const NOW = new Date('2026-12-01T10:00:00Z')
const FUTURE = new Date('2026-12-05T10:00:00Z')

const post = (over: Partial<StatePost> = {}): StatePost => ({
  status: 'DRAFT', channelKind: 'FACEBOOK_PAGE', scheduledFor: null, approvedBy: null, approvedAt: null, attempts: 0, ...over,
})
const approved = (over: Partial<StatePost> = {}) => post({ status: 'APPROVED', approvedBy: 'mike', approvedAt: NOW, ...over })
const throws409 = (fn: () => unknown, re?: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof WebsiteError && e.status === 409 && (!re || re.test(e.message)))

describe('flags', () => {
  test('hub is on unless GRACE_MARKETING_HUB is exactly "false"', () => {
    assert.strictEqual(hubEnabled({}), true)
    assert.strictEqual(hubEnabled({ GRACE_MARKETING_HUB: 'true' }), true)
    assert.strictEqual(hubEnabled({ GRACE_MARKETING_HUB: 'false' }), false)
  })
  test('live is off unless GRACE_MARKETING_LIVE is exactly "true"', () => {
    assert.strictEqual(liveAllowedByEnv({}), false)
    assert.strictEqual(liveAllowedByEnv({ GRACE_MARKETING_LIVE: '1' }), false)
    assert.strictEqual(liveAllowedByEnv({ GRACE_MARKETING_LIVE: 'true' }), true)
  })

  const ok = () => ({
    env: { GRACE_MARKETING_LIVE: 'true' },
    settings: { liveEnabled: true },
    channel: { status: 'CONNECTED', credentialsEnc: 'v1:x:y:z' },
    post: { approvedBy: 'mike', approvedAt: NOW },
  })
  test('everything in place passes', () => {
    assert.doesNotThrow(() => assertCanGoLive(ok()))
    assert.deepStrictEqual(checkCanGoLive(ok()), { ok: true })
  })
  test('each condition blocks on its own', () => {
    const cases: [string, (i: ReturnType<typeof ok>) => unknown, RegExp][] = [
      ['env off', (i) => { i.env = {} as never }, /server/],
      ['settings off', (i) => { i.settings.liveEnabled = false }, /settings/],
      ['no settings', (i) => { (i as { settings: unknown }).settings = null }, /settings/],
      ['channel missing', (i) => { (i as { channel: unknown }).channel = null }, /not connected/],
      ['channel not connected', (i) => { i.channel.status = 'NOT_CONNECTED' }, /not connected/],
      ['channel in error', (i) => { i.channel.status = 'ERROR' }, /not connected/],
      ['no credentials', (i) => { (i.channel as { credentialsEnc: string | null }).credentialsEnc = null }, /credentials/],
      ['not approved by', (i) => { (i.post as { approvedBy: string | null }).approvedBy = null }, /approved/],
      ['not approved at', (i) => { (i.post as { approvedAt: Date | null }).approvedAt = null }, /approved/],
      ['no post', (i) => { (i as { post: unknown }).post = null }, /approved/],
    ]
    for (const [name, mutate, re] of cases) {
      const i = ok()
      mutate(i)
      throws409(() => assertCanGoLive(i as never), re)
      assert.strictEqual(checkCanGoLive(i as never).ok, false, name)
    }
  })
})

describe('secrets', () => {
  test('round trips and hides the plain text', () => {
    const enc = encryptSecret('EAAB-secret-token-1234')
    assert.match(enc, /^v1:[^:]+:[^:]+:[^:]+$/)
    assert.ok(!enc.includes('secret-token'))
    assert.strictEqual(decryptSecret(enc), 'EAAB-secret-token-1234')
    assert.deepStrictEqual(decryptJson(encryptJson({ a: 'b' })), { a: 'b' })
  })
  test('each encryption uses a fresh iv', () => {
    assert.notStrictEqual(encryptSecret('x'), encryptSecret('x'))
  })
  test('tampering and malformed values are rejected', () => {
    const [v, iv, tag, data] = encryptSecret('hello').split(':')
    const flipped = Buffer.from(data, 'base64')
    flipped[0] ^= 1
    assert.throws(() => decryptSecret([v, iv, tag, flipped.toString('base64')].join(':')), /decrypt/)
    assert.throws(() => decryptSecret([v, iv, Buffer.alloc(16).toString('base64'), data].join(':')), /decrypt/)
    assert.throws(() => decryptSecret('nonsense'), /Unreadable/)
    assert.throws(() => decryptSecret(`v2:${iv}:${tag}:${data}`), /Unreadable/)
  })
  test('a different key cannot read it; no key at all is a clear error', () => {
    const env = process.env as Record<string, string | undefined>
    const saved = { m: env.MARKETING_TOKEN_KEY, j: env.JWT_SECRET }
    try {
      const enc = encryptSecret('hello')
      env.MARKETING_TOKEN_KEY = 'another-key-another-key-another-key'
      assert.throws(() => decryptSecret(enc), /decrypt/)
      delete env.MARKETING_TOKEN_KEY
      delete env.JWT_SECRET
      assert.throws(() => encryptSecret('x'), /MARKETING_TOKEN_KEY/)
    } finally {
      for (const [k, v] of [['MARKETING_TOKEN_KEY', saved.m], ['JWT_SECRET', saved.j]] as const) {
        if (v === undefined) delete env[k]
        else env[k] = v
      }
    }
  })
  test('tokenHint is the last 4 characters only', () => {
    assert.strictEqual(tokenHint('abcdefgh1234'), '1234')
    assert.strictEqual(tokenHint(' abcd '), 'abcd')
  })
})

describe('state machine', () => {
  test('submit and cancel from DRAFT', () => {
    assert.strictEqual(transition(post(), 'submit', owner).status, 'PENDING_APPROVAL')
    assert.strictEqual(transition(post(), 'cancel', owner).status, 'CANCELLED')
  })
  test('approve (owner only) records who and when; reject clears', () => {
    const p = post({ status: 'PENDING_APPROVAL' })
    const r = transition(p, 'approve', owner, { now: NOW })
    assert.deepStrictEqual([r.status, r.approvedBy, r.approvedAt], ['APPROVED', 'mike', NOW])
    throws409(() => transition(p, 'approve', staff), /owner/)
    throws409(() => transition(p, 'approve', system), /owner/)
    assert.strictEqual(transition(p, 'reject', owner).status, 'REJECTED')
    throws409(() => transition(p, 'reject', staff), /owner/)
  })
  test('edits reset approval and schedule; REJECTED goes back to DRAFT', () => {
    for (const status of ['PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'REJECTED']) {
      const r = transition(post({ status, approvedBy: 'mike', approvedAt: NOW, scheduledFor: FUTURE }), 'edit', owner)
      assert.strictEqual(r.status, 'DRAFT', status)
      assert.strictEqual(r.approvedBy, null)
      assert.strictEqual(r.approvedAt, null)
      assert.strictEqual(r.scheduledFor, null)
    }
    assert.deepStrictEqual(transition(post(), 'edit', owner), { status: 'DRAFT' })
    for (const status of ['PUBLISHING', 'PUBLISHED', 'SHARED', 'FAILED', 'CANCELLED']) throws409(() => transition(post({ status }), 'edit', owner))
  })
  test('schedule needs approval, an api channel that can schedule, and a future time', () => {
    const r = transition(approved(), 'schedule', owner, { scheduledFor: FUTURE, now: NOW })
    assert.deepStrictEqual([r.status, r.scheduledFor], ['SCHEDULED', FUTURE])
    throws409(() => transition(approved(), 'schedule', owner, { now: NOW }), /date/)
    throws409(() => transition(approved(), 'schedule', owner, { scheduledFor: new Date('2026-11-01'), now: NOW }), /future/)
    throws409(() => transition(post({ status: 'DRAFT' }), 'schedule', owner, { scheduledFor: FUTURE, now: NOW }))
    throws409(() => transition(approved({ channelKind: 'WHATSAPP_STATUS' }), 'schedule', owner, { scheduledFor: FUTURE, now: NOW }), /by hand/)
    throws409(() => transition(approved({ channelKind: 'THREADS' }), 'schedule', owner, { scheduledFor: FUTURE, now: NOW }), /cannot be scheduled/)
  })
  test('unschedule returns to APPROVED', () => {
    const r = transition(post({ status: 'SCHEDULED', scheduledFor: FUTURE }), 'unschedule', owner)
    assert.deepStrictEqual([r.status, r.scheduledFor], ['APPROVED', null])
    throws409(() => transition(approved(), 'unschedule', owner))
  })
  test('publish now goes to PUBLISHING and counts an attempt; manual channels cannot', () => {
    const r = transition(approved(), 'publish', owner)
    assert.deepStrictEqual([r.status, r.attempts], ['PUBLISHING', 1])
    throws409(() => transition(approved({ channelKind: 'FACEBOOK_GROUPS' }), 'publish', owner), /by hand/)
    throws409(() => transition(post(), 'publish', owner))
  })
  test('runner start only when due', () => {
    const due = post({ status: 'SCHEDULED', scheduledFor: new Date('2026-12-01T09:00:00Z') })
    assert.strictEqual(transition(due, 'start', system, { now: NOW }).status, 'PUBLISHING')
    throws409(() => transition(post({ status: 'SCHEDULED', scheduledFor: FUTURE }), 'start', system, { now: NOW }), /not due/)
    throws409(() => transition(post({ status: 'SCHEDULED' }), 'start', system, { now: NOW }), /not due/)
  })
  test('PUBLISHING ends in PUBLISHED or FAILED', () => {
    const p = post({ status: 'PUBLISHING', attempts: 1 })
    const ok = transition(p, 'published', system, { now: NOW, externalId: 'x1', externalUrl: 'https://e/x1' })
    assert.deepStrictEqual([ok.status, ok.publishedAt, ok.externalId], ['PUBLISHED', NOW, 'x1'])
    const bad = transition(p, 'failed', system, { error: 'boom' })
    assert.deepStrictEqual([bad.status, bad.error], ['FAILED', 'boom'])
    throws409(() => transition(post(), 'published', system))
    throws409(() => transition(approved(), 'failed', system))
  })
  test('retry from FAILED up to the attempt limit', () => {
    assert.strictEqual(transition(post({ status: 'FAILED', attempts: 1 }), 'retry', owner).attempts, 2)
    assert.strictEqual(transition(post({ status: 'FAILED', attempts: MAX_ATTEMPTS - 1 }), 'retry', owner).attempts, MAX_ATTEMPTS)
    throws409(() => transition(post({ status: 'FAILED', attempts: MAX_ATTEMPTS }), 'retry', owner), /failed 3 times/)
    assert.strictEqual(transition(post({ status: 'FAILED', attempts: 3 }), 'cancel', owner).status, 'CANCELLED')
  })
  test('share: manual channels only, owner only, from APPROVED', () => {
    const m = approved({ channelKind: 'WHATSAPP_STATUS' })
    const r = transition(m, 'share', owner, { now: NOW })
    assert.deepStrictEqual([r.status, r.publishedAt], ['SHARED', NOW])
    throws409(() => transition(m, 'share', staff), /owner/)
    throws409(() => transition(approved(), 'share', owner), /automatically/)
    throws409(() => transition({ ...m, status: 'DRAFT' }, 'share', owner))
  })
  test('cancel from APPROVED and SCHEDULED, not from final states', () => {
    for (const s of ['APPROVED', 'SCHEDULED']) assert.strictEqual(transition(post({ status: s }), 'cancel', owner).status, 'CANCELLED')
    for (const s of ['PUBLISHING', 'PUBLISHED', 'SHARED', 'CANCELLED', 'REJECTED', 'PENDING_APPROVAL']) {
      throws409(() => transition(post({ status: s }), 'cancel', owner), /Cannot cancel/)
    }
  })
  test('every action from every status is either an allowed edge or a plain 409 (never a crash)', () => {
    const actions = ['submit', 'cancel', 'approve', 'reject', 'schedule', 'unschedule', 'publish', 'retry', 'share', 'start', 'published', 'failed', 'edit'] as const
    for (const status of POST_STATUSES) {
      for (const a of actions) {
        try {
          transition(post({ status, scheduledFor: new Date('2026-12-01T09:00:00Z') }), a, owner, { scheduledFor: FUTURE, now: NOW })
        } catch (e) {
          assert.ok(e instanceof WebsiteError && e.status === 409, `${status}/${a}`)
        }
      }
    }
  })
})

describe('tracking', () => {
  test('tags are mk + hex and survive analytics normalizeTag unchanged', () => {
    for (let i = 0; i < 50; i++) {
      const tag = generateTrackingTag()
      assert.match(tag, TRACKING_TAG)
      assert.ok(tag.length <= CAMPAIGN_MAX_LENGTH)
      assert.strictEqual(campaignFromSearch(`?src=${tag}`), tag)
    }
  })
  test('tags are unique', () => {
    assert.strictEqual(new Set(Array.from({ length: 200 }, generateTrackingTag)).size, 200)
  })
  test('product link on the storefront host carries ?src=', () => {
    const link = buildTrackedLink({ slug: 'pink-dress', trackingTag: 'mkabc123def456', storefrontHosts: ['vyra.example'], host: 'admin.example' })
    assert.strictEqual(link, 'https://vyra.example/p/pink-dress?src=mkabc123def456')
    assert.strictEqual(campaignFromSearch(new URL(link!).search), 'mkabc123def456')
  })
  test('on the admin/UAT host the link goes through /site; no slug links to the home page', () => {
    assert.strictEqual(
      buildTrackedLink({ slug: 'pink-dress', trackingTag: 'mkaaaaaaaaaaaa', storefrontHosts: [], host: 'uat.example' }),
      'https://uat.example/site/p/pink-dress?src=mkaaaaaaaaaaaa',
    )
    assert.strictEqual(
      buildTrackedLink({ slug: null, trackingTag: 'mkaaaaaaaaaaaa', storefrontHosts: ['vyra.example'], host: null }),
      'https://vyra.example/?src=mkaaaaaaaaaaaa',
    )
  })
  test('no usable host gives null', () => {
    assert.strictEqual(buildTrackedLink({ slug: 'x', trackingTag: 'mkaaaaaaaaaaaa', storefrontHosts: [], host: null }), null)
  })
})

describe('channel registry', () => {
  const required = [
    'FACEBOOK_PAGE', 'INSTAGRAM', 'THREADS', 'META_ADS', 'FACEBOOK_GROUPS', 'FACEBOOK_MARKETPLACE', 'WHATSAPP_STATUS', 'WHATSAPP_CHANNEL',
    'WHATSAPP_BROADCAST', 'WHATSAPP_CLOUD', 'GOOGLE_BUSINESS', 'GOOGLE_MERCHANT', 'GOOGLE_ADS', 'YOUTUBE', 'TIKTOK', 'PINTEREST', 'X',
    'TELEGRAM', 'EMAIL', 'SMS', 'INFLUENCER', 'RESELLER', 'CLASSIFIEDS', 'PRINT_QR',
  ]
  test('has every required kind exactly once', () => {
    for (const k of required) assert.ok(getChannel(k), k)
    assert.strictEqual(new Set(CHANNEL_KINDS).size, CHANNELS.length)
  })
  test('each entry is complete: setup steps, api notes, formats, sane limits', () => {
    for (const c of CHANNELS) {
      assert.ok(c.label.length > 0, c.kind)
      assert.ok(c.formats.length > 0, c.kind)
      assert.ok(c.setupSteps.length >= 2 && c.setupSteps.every((s) => s.length > 10), `${c.kind} steps`)
      assert.ok(c.apiNotes.length >= 1, `${c.kind} notes`)
      assert.ok(c.limits.maxText > 0 && c.limits.maxImages >= 0)
      assert.strictEqual(c.connector, false, `${c.kind} has no connector yet`)
    }
  })
  test('manual channels cannot publish, schedule, run ads or message', () => {
    for (const c of CHANNELS.filter((c) => c.mode === 'manual')) {
      assert.deepStrictEqual(Object.values(c.capabilities), [false, false, false, false, false, false], c.kind)
    }
    for (const k of ['FACEBOOK_GROUPS', 'FACEBOOK_MARKETPLACE', 'WHATSAPP_STATUS', 'WHATSAPP_CHANNEL', 'WHATSAPP_BROADCAST', 'INFLUENCER', 'RESELLER', 'CLASSIFIEDS', 'PRINT_QR']) {
      assert.strictEqual(getChannel(k)!.mode, 'manual', k)
    }
  })
  test('verified platform facts are recorded', () => {
    assert.strictEqual(getChannel('INSTAGRAM')!.limits.imageFormat, 'jpeg')
    assert.match(getChannel('INSTAGRAM')!.apiNotes.join(' '), /50 posts in 24 hours/)
    assert.match(getChannel('FACEBOOK_GROUPS')!.apiNotes.join(' '), /April 2024/)
    assert.match(getChannel('WHATSAPP_BROADCAST')!.apiNotes.join(' '), /read-only/)
    assert.match(getChannel('TIKTOK')!.apiNotes.join(' '), /inbox/)
    assert.match(getChannel('X')!.apiNotes.join(' '), /\$0\.015/)
    assert.match(getChannel('YOUTUBE')!.apiNotes.join(' '), /100 uploads/)
    assert.match(getChannel('GOOGLE_MERCHANT')!.apiNotes.join(' '), /18 August 2026/)
    assert.strictEqual(getChannel('X')!.limits.maxText, 280)
  })
})
