// ZP-1200: consent rules, phone numbers, the unsubscribe token and the broadcast status machine. No database, no network.
import { describe, test } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import { addressFor, consentSummary, isOptedIn, latestConsent, normalizeEmail, normalizePhone, parseConsentCell } from '../src/lib/marketing/consent'
import { parseCsv } from '../src/lib/marketing/contacts'
import { signUnsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from '../src/lib/marketing/unsubscribe'
import { transitionBroadcast, type BroadcastActor, type StateBroadcast } from '../src/lib/marketing/broadcast-state'
import { allBlockers, harareDayStart, sendRatePerSecond, tagLinks } from '../src/lib/marketing/broadcasts'
import { codeProblem } from '../src/lib/marketing/partners'
import { WebsiteError } from '../src/lib/website/http'

const row = (id: number, channel: string, status: string, at: string) => ({ id, channel, status, recordedAt: new Date(at) })

describe('consent: the latest row for that exact channel wins', () => {
  test('no rows is not opted in', () => assert.strictEqual(isOptedIn([], 'SMS'), false))

  test('the latest row wins, in either order of arrival', () => {
    const rows = [row(1, 'SMS', 'OPTED_IN', '2026-11-01T10:00:00Z'), row(2, 'SMS', 'OPTED_OUT', '2026-11-05T10:00:00Z')]
    assert.strictEqual(isOptedIn(rows, 'SMS'), false)
    assert.strictEqual(isOptedIn([...rows].reverse(), 'SMS'), false)
    const back = [...rows, row(3, 'SMS', 'OPTED_IN', '2026-11-09T10:00:00Z')]
    assert.strictEqual(isOptedIn(back, 'SMS'), true)
  })

  test('the same time: the higher id wins (an opt-out recorded after an opt-in blocks)', () => {
    const t = '2026-11-01T10:00:00Z'
    assert.strictEqual(latestConsent([row(5, 'EMAIL', 'OPTED_IN', t), row(6, 'EMAIL', 'OPTED_OUT', t)], 'EMAIL')?.id, 6)
    assert.strictEqual(isOptedIn([row(6, 'EMAIL', 'OPTED_OUT', t), row(5, 'EMAIL', 'OPTED_IN', t)], 'EMAIL'), false)
  })

  test('consent for one channel never counts for another', () => {
    const rows = [row(1, 'WHATSAPP', 'OPTED_IN', '2026-11-01T10:00:00Z')]
    assert.strictEqual(isOptedIn(rows, 'WHATSAPP'), true)
    assert.strictEqual(isOptedIn(rows, 'SMS'), false)
    assert.strictEqual(isOptedIn(rows, 'EMAIL'), false)
    assert.deepStrictEqual(consentSummary(rows), { WHATSAPP: 'OPTED_IN', SMS: 'NONE', EMAIL: 'NONE' })
  })

  test('addressFor: email needs an email, the others need a phone', () => {
    const c = { phone: '+263771234567', email: null }
    assert.strictEqual(addressFor('SMS', c), '+263771234567')
    assert.strictEqual(addressFor('WHATSAPP_CLOUD', c), '+263771234567')
    assert.strictEqual(addressFor('EMAIL', c), null)
  })

  test('CSV consent cells: only clear yes/no words count', () => {
    assert.strictEqual(parseConsentCell('Yes'), 'OPTED_IN')
    assert.strictEqual(parseConsentCell('opted_out'), 'OPTED_OUT')
    for (const v of ['', ' ', 'maybe', 'ok', undefined]) assert.strictEqual(parseConsentCell(v), null)
  })
})

describe('Zimbabwe phone numbers', () => {
  test('the usual ways of writing a number become +263', () => {
    for (const v of ['+263 77 123 4567', '0771234567', '077 123 4567', '263771234567', '00263771234567', '771234567', '(077) 123-4567']) {
      assert.strictEqual(normalizePhone(v), '+263771234567', v)
    }
  })
  test('other countries need their + and junk is refused', () => {
    assert.strictEqual(normalizePhone('+27 82 123 4567'), '+27821234567')
    for (const v of ['', 'abc', '12345', '+263 77 123', '+0123456789', '07712345678', null, 42]) assert.strictEqual(normalizePhone(v as never), null, String(v))
  })
  test('email is lower-cased and checked', () => {
    assert.strictEqual(normalizeEmail('  Tendai@Example.COM '), 'tendai@example.com')
    for (const v of ['nope', 'a@b', 'a b@c.com', 'a@b.com, c@d.com']) assert.strictEqual(normalizeEmail(v), null, v)
  })
})

describe('unsubscribe token', () => {
  test('round trips', () => {
    const t = signUnsubscribeToken(42, 'EMAIL')
    assert.deepStrictEqual(verifyUnsubscribeToken(t), { contactId: 42, channel: 'EMAIL' })
  })
  test('tampering is refused: other contact, other channel, bad signature, truncation, junk', () => {
    const t = signUnsubscribeToken(42, 'EMAIL')
    const [, , sig] = t.split('.')
    for (const bad of [`43.EMAIL.${sig}`, `42.SMS.${sig}`, `42.EMAIL.${sig.slice(0, -1)}x`, `42.EMAIL.${sig.slice(1)}`, `42.EMAIL.`, '42.EMAIL', '', 'x.y.z', `${t}.extra`, `042.EMAIL.${sig}`]) {
      assert.strictEqual(verifyUnsubscribeToken(bad), null, bad)
    }
    for (const bad of [null, undefined, 5, {}, 'a'.repeat(500)]) assert.strictEqual(verifyUnsubscribeToken(bad), null)
  })
  test('a token made with another key is refused', () => {
    const t = signUnsubscribeToken(7, 'SMS')
    const saved = process.env.JWT_SECRET
    process.env.JWT_SECRET = 'a-completely-different-secret-0123456789'
    try { assert.strictEqual(verifyUnsubscribeToken(t), null) } finally { process.env.JWT_SECRET = saved }
  })
  test('the link points at the public route with the token', () => {
    const u = unsubscribeUrl('https://vyra.example/', 9, 'EMAIL')
    assert.match(u, /^https:\/\/vyra\.example\/api\/public\/marketing\/unsubscribe\?t=9\.EMAIL\./)
  })
})

describe('broadcast status machine', () => {
  const owner: BroadcastActor = { username: 'o', role: 'OWNER' }
  const staff: BroadcastActor = { username: 's', role: 'STAFF' }
  const sys: BroadcastActor = { username: 'system', role: 'SYSTEM' }
  const b = (status: string, approved = false): StateBroadcast => ({ status, approvedBy: approved ? 'o' : null, approvedAt: approved ? new Date() : null })
  const refuses = (fn: () => unknown, re?: RegExp) => assert.throws(fn, (e: unknown) => e instanceof WebsiteError && e.status === 409 && (!re || re.test(e.message)))

  test('the happy path', () => {
    assert.strictEqual(transitionBroadcast(b('DRAFT'), 'submit', staff).status, 'PENDING_APPROVAL')
    const a = transitionBroadcast(b('PENDING_APPROVAL'), 'approve', owner)
    assert.strictEqual(a.status, 'APPROVED'); assert.strictEqual(a.approvedBy, 'o'); assert.ok(a.approvedAt)
    assert.strictEqual(transitionBroadcast(b('APPROVED', true), 'send', owner).status, 'SENDING')
    assert.strictEqual(transitionBroadcast(b('SENDING', true), 'finish', sys).status, 'SENT')
    assert.strictEqual(transitionBroadcast(b('SENDING', true), 'finish', sys, { failed: true }).status, 'FAILED')
    assert.strictEqual(transitionBroadcast(b('FAILED', true), 'retry', owner).status, 'SENDING')
  })
  test('only the owner approves, sends, retries, rejects or cancels', () => {
    refuses(() => transitionBroadcast(b('PENDING_APPROVAL'), 'approve', staff), /owner/)
    refuses(() => transitionBroadcast(b('APPROVED', true), 'send', staff), /owner/)
    refuses(() => transitionBroadcast(b('FAILED', true), 'retry', sys), /owner/)
    refuses(() => transitionBroadcast(b('PENDING_APPROVAL'), 'reject', staff), /owner/)
    refuses(() => transitionBroadcast(b('DRAFT'), 'cancel', staff), /owner/)
  })
  test('sending needs an approval on record, even from an APPROVED status', () => {
    refuses(() => transitionBroadcast(b('APPROVED', false), 'send', owner), /approved/)
    refuses(() => transitionBroadcast(b('FAILED', false), 'retry', owner), /approved/)
  })
  test('no shortcuts: a draft cannot be sent, a sent message cannot be sent again', () => {
    for (const s of ['DRAFT', 'PENDING_APPROVAL', 'SENT', 'SENDING', 'CANCELLED', 'REJECTED', 'FAILED']) refuses(() => transitionBroadcast(b(s, true), 'send', owner))
    refuses(() => transitionBroadcast(b('SENT', true), 'retry', owner))
    refuses(() => transitionBroadcast(b('DRAFT'), 'approve', owner))
    refuses(() => transitionBroadcast(b('SENT', true), 'cancel', owner))
    refuses(() => transitionBroadcast(b('SENDING', true), 'edit', owner))
  })
  test('editing after approval sends it back to a draft and clears the approval', () => {
    const t = transitionBroadcast(b('APPROVED', true), 'edit', owner)
    assert.deepStrictEqual(t, { status: 'DRAFT', approvedBy: null, approvedAt: null })
    assert.strictEqual(transitionBroadcast(b('REJECTED'), 'edit', owner).status, 'DRAFT')
  })
  test('a send in progress can be stopped', () => assert.strictEqual(transitionBroadcast(b('SENDING', true), 'cancel', owner).status, 'CANCELLED'))
})

describe('helpers', () => {
  test('tagLinks adds ?src= to our own links only, and keeps trailing punctuation', () => {
    const out = tagLinks('See https://vyra.example/p/dress. Or https://other.example/x and https://vyra.example/p/a?src=keep', 'mkabc', ['vyra.example'])
    assert.match(out, /https:\/\/vyra\.example\/p\/dress\?src=mkabc\./)
    assert.match(out, /https:\/\/other\.example\/x(?! ?\?)/)
    assert.match(out, /https:\/\/vyra\.example\/p\/a\?src=keep/)
  })
  test('send rate defaults to 1 a second and can be configured', () => {
    assert.strictEqual(sendRatePerSecond({}), 1)
    assert.strictEqual(sendRatePerSecond({ GRACE_MARKETING_SEND_PER_SECOND: '0.5' }), 0.5)
    assert.strictEqual(sendRatePerSecond({ GRACE_MARKETING_SEND_PER_SECOND: 'x' }), 1)
    assert.strictEqual(sendRatePerSecond({ GRACE_MARKETING_SEND_PER_SECOND: '999' }), 10)
  })
  test('the Harare day starts at 22:00 UTC the evening before', () => {
    assert.strictEqual(harareDayStart(new Date('2026-11-27T10:00:00Z')).toISOString(), '2026-11-26T22:00:00.000Z')
    assert.strictEqual(harareDayStart(new Date('2026-11-26T23:00:00Z')).toISOString(), '2026-11-26T22:00:00.000Z')
  })
  test('allBlockers lists every missing condition', () => {
    const r = allBlockers({ settings: { liveEnabled: false }, channel: null, post: { approvedBy: null, approvedAt: null }, env: {} })
    assert.strictEqual(r.length, 4)
    assert.deepStrictEqual(allBlockers({ settings: { liveEnabled: true }, channel: { status: 'CONNECTED', credentialsEnc: 'x' }, post: { approvedBy: 'o', approvedAt: new Date() }, env: { GRACE_MARKETING_LIVE: 'true' } }), [])
  })
  test('partner codes survive the analytics tag cleaning', () => {
    for (const ok of ['tendai-23', 'zim-reseller', 'abc']) assert.strictEqual(codeProblem(ok), null, ok)
    for (const bad of ['ab', 'Tendai', 'a_b', '-abc', 'abc-', 'a--b', 'a b', 'x'.repeat(33), 'mk0123456789ab']) assert.ok(codeProblem(bad), bad)
  })
  test('csv reader handles quotes, semicolons, CRLF and a BOM', () => {
    assert.deepStrictEqual(parseCsv('﻿name,phone\r\n"Smith, A","077 1"\r\n\r\nB,"say ""hi"""\r\n'), [['name', 'phone'], ['Smith, A', '077 1'], ['B', 'say "hi"']])
    assert.deepStrictEqual(parseCsv('name;phone\nA;1'), [['name', 'phone'], ['A', '1']])
  })
})

describe('MM-12: one writer for consent', () => {
  test('no file under src writes MarketingConsent except consent-records.ts', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const files: string[] = []
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p) } }
    walk(join(process.cwd(), 'src'))
    const writes = /marketingConsent\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|consents:\s*\{\s*(create|createMany|connectOrCreate|upsert|update|updateMany|delete|deleteMany)\b|INSERT INTO\s+"MarketingConsent"|UPDATE\s+"MarketingConsent"/
    const offenders = files.filter((f) => !f.endsWith(join('marketing', 'consent-records.ts')) && writes.test(readFileSync(f, 'utf8')))
    assert.deepStrictEqual(offenders, [])
    assert.ok(files.length > 100, 'the walk found the source files')
  })
})
