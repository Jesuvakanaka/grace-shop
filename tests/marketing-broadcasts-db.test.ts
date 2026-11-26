// ZP-1200: broadcasts against DATABASE_URL with fake providers (no network). Only touches rows it creates
// (contacts created by zp1200-msg, broadcasts it makes, channel rows of SMS/EMAIL/WHATSAPP_CLOUD which it restores).
import { describe, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { broadcastAction, computeAudience, continueSending, createBroadcast, getBroadcastDetail, runDueBroadcasts, updateBroadcast, type BroadcastDeps } from '../src/lib/marketing/broadcasts'
import { createContact, recordConsent } from '../src/lib/marketing/contacts'
import { getConnector } from '../src/lib/marketing/connectors'
import type { Connector, ConnectorMessage, SendResult } from '../src/lib/marketing/connectors/types'
import { encryptJson } from '../src/lib/marketing/secrets'
import { verifyUnsubscribeToken, applyUnsubscribe } from '../src/lib/marketing/unsubscribe'
import { getSettings } from '../src/lib/marketing/settings'
import { WebsiteError } from '../src/lib/website/http'

const owner = { username: 'zp1200-msg', role: 'OWNER' as const }
const staff = { username: 'zp1200-msg-staff', role: 'STAFF' as const }
const savedEnv = { live: process.env.GRACE_MARKETING_LIVE, hosts: process.env.GRACE_STOREFRONT_HOSTS }
let savedSettings: { liveEnabled: boolean; messageDailyCap: number } | null = null
let savedChannels: { id: number; status: string }[] = []
const channelIds: number[] = []
const broadcastIds: number[] = []
const contactIds: number[] = []
const SMS_CREDS = { accountSid: 'AC' + 'a'.repeat(32), authToken: 'TWILIO-SECRET', from: '+12025550123' }

const rejects = async (fn: () => Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))

let phoneSeq = Math.floor(Math.random() * 9_000_000)
const nextPhone = () => `+26377${String(1_000_000 + (phoneSeq++ % 9_000_000)).padStart(7, '0')}`

async function contact(opts: { optIn?: ('WHATSAPP' | 'SMS' | 'EMAIL')[]; optOut?: ('WHATSAPP' | 'SMS' | 'EMAIL')[]; name?: string; withEmail?: boolean } = {}) {
  const email = opts.withEmail ? `zp1200-${phoneSeq}-${Math.random().toString(36).slice(2, 8)}@example.com` : undefined
  const c = await createContact(prisma, { name: opts.name ?? 'Tendai Moyo', phone: nextPhone(), ...(email ? { email } : {}) }, owner.username)
  contactIds.push(c.id)
  for (const ch of opts.optIn ?? []) await recordConsent(prisma, c.id, { channel: ch, status: 'OPTED_IN', method: 'said yes on WhatsApp on 26 Nov' }, owner.username)
  for (const ch of opts.optOut ?? []) await recordConsent(prisma, c.id, { channel: ch, status: 'OPTED_OUT', method: 'said stop' }, owner.username)
  return c
}

/** Provider that records what it was asked to send, with a hook per message. */
function fakeProvider(kind: string, reply: (m: ConnectorMessage, n: number) => SendResult | Promise<SendResult> = (_m, n) => ({ ok: true, externalId: `ext-${n}` })) {
  const sent: ConnectorMessage[] = []
  const connector: Connector = {
    kind, messagesOnly: true,
    verify: async () => ({ ok: true, externalId: null, name: null }),
    publish: async () => ({ ok: false, error: 'no', retryable: false }),
    send: async (m) => { sent.push(m); return reply(m, sent.length) },
  }
  return { connector, sent }
}
const depsFor = (connector: Connector, extra: Partial<BroadcastDeps> = {}): BroadcastDeps & { sleeps: number[] } => {
  const sleeps: number[] = []
  return { fetch: async () => { throw new Error('the fake provider must be used') }, baseUrl: 'https://vyra.example', getConnector: () => connector, sleep: async (ms) => { sleeps.push(ms) }, sleeps, ...extra }
}

async function setLive(on: boolean) {
  process.env.GRACE_MARKETING_LIVE = on ? 'true' : 'false'
  await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: on } })
}

async function approvedBroadcast(ids: number[], o: Record<string, unknown> = {}) {
  const b = await createBroadcast(prisma, { channelKind: 'SMS', name: 'ZP1200 sale', text: 'New dresses in at https://vyra.example/p/pink', audienceFilter: { contactIds: ids }, ...o }, owner.username)
  broadcastIds.push(b.id)
  await broadcastAction(prisma, b.id, 'submit', staff, depsFor(fakeProvider('SMS').connector))
  const a = await broadcastAction(prisma, b.id, 'approve', owner, depsFor(fakeProvider('SMS').connector))
  assert.strictEqual(a.broadcast.status, 'APPROVED')
  return a.broadcast
}
const recipients = (id: number) => prisma.marketingBroadcastRecipient.findMany({ where: { broadcastId: id }, orderBy: { id: 'asc' } })
const db = (id: number) => prisma.marketingBroadcast.findUniqueOrThrow({ where: { id } })

before(async () => {
  const s = await getSettings(prisma)
  savedSettings = { liveEnabled: s.liveEnabled, messageDailyCap: s.messageDailyCap }
  const existing = await prisma.marketingChannel.findMany({ where: { kind: { in: ['SMS', 'EMAIL', 'WHATSAPP_CLOUD'] } }, select: { id: true, status: true } })
  savedChannels = existing
  await prisma.marketingChannel.updateMany({ where: { id: { in: existing.map((c) => c.id) } }, data: { status: 'NOT_CONNECTED' } })
  for (const kind of ['SMS', 'EMAIL', 'WHATSAPP_CLOUD']) {
    const creds = kind === 'SMS' ? SMS_CREDS : kind === 'EMAIL' ? { apiKey: 'k', senderEmail: 'hello@vyra.example' } : { phoneNumberId: '1098765', accessToken: 'WA-SECRET' }
    channelIds.push((await prisma.marketingChannel.create({ data: { kind, name: `ZP1200 ${kind}`, status: 'CONNECTED', credentialsEnc: encryptJson(creds), tokenHint: '1234', externalId: kind === 'SMS' ? SMS_CREDS.accountSid : null } })).id)
  }
  process.env.GRACE_STOREFRONT_HOSTS = 'vyra.example'
})

after(async () => {
  await prisma.marketingBroadcast.deleteMany({ where: { id: { in: broadcastIds } } })
  await prisma.marketingContact.deleteMany({ where: { id: { in: contactIds } } })
  await prisma.marketingChannel.deleteMany({ where: { id: { in: channelIds } } })
  for (const c of savedChannels) await prisma.marketingChannel.update({ where: { id: c.id }, data: { status: c.status } })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: { in: [owner.username, staff.username, 'system', 'self:unsubscribe'] }, createdAt: { gte: new Date(Date.now() - 3_600_000) } } })
  if (savedSettings) await prisma.marketingSettings.update({ where: { id: 1 }, data: savedSettings })
  if (savedEnv.live === undefined) delete process.env.GRACE_MARKETING_LIVE; else process.env.GRACE_MARKETING_LIVE = savedEnv.live
  if (savedEnv.hosts === undefined) delete process.env.GRACE_STOREFRONT_HOSTS; else process.env.GRACE_STOREFRONT_HOSTS = savedEnv.hosts
  await prisma.$disconnect()
})

beforeEach(async () => {
  await setLive(true)
  await prisma.marketingSettings.update({ where: { id: 1 }, data: { messageDailyCap: 10000 } })
  await prisma.marketingChannel.updateMany({ where: { id: { in: channelIds } }, data: { status: 'CONNECTED', credentialsEnc: encryptJson(SMS_CREDS) } })
  // each channel row keeps its own credentials shape
  await prisma.marketingChannel.update({ where: { id: channelIds[1] }, data: { credentialsEnc: encryptJson({ apiKey: 'k', senderEmail: 'hello@vyra.example' }) } })
  await prisma.marketingChannel.update({ where: { id: channelIds[2] }, data: { credentialsEnc: encryptJson({ phoneNumberId: '1098765', accessToken: 'WA-SECRET' }) } })
})

describe('audience: only a recorded, un-withdrawn opt-in for that exact channel', () => {
  test('latest row wins; other channels do not count; no address is left out', async () => {
    const yes = await contact({ optIn: ['SMS'] })
    const none = await contact()
    const out = await contact({ optIn: ['SMS'], optOut: ['SMS'] })
    const again = await contact({ optIn: ['SMS'], optOut: ['SMS'] })
    await recordConsent(prisma, again.id, { channel: 'SMS', status: 'OPTED_IN', method: 'asked to be added again' }, owner.username)
    const waOnly = await contact({ optIn: ['WHATSAPP'] })
    const aud = await computeAudience(prisma, { channelKind: 'SMS', audienceFilter: { contactIds: [yes.id, none.id, out.id, again.id, waOnly.id] } })
    assert.deepStrictEqual(aud.eligible.map((m) => m.id).sort(), [yes.id, again.id].sort())
    assert.deepStrictEqual(aud.withheld, { noAddress: 0, noConsent: 2, optedOut: 1 })
    const email = await computeAudience(prisma, { channelKind: 'EMAIL', audienceFilter: { contactIds: [yes.id, waOnly.id] } })
    assert.strictEqual(email.eligible.length, 0)
    assert.strictEqual(email.withheld.noAddress, 2)
  })

  test('opting in needs an address for that channel', async () => {
    const c = await contact()
    await rejects(() => recordConsent(prisma, c.id, { channel: 'EMAIL', status: 'OPTED_IN', method: 'form' }, owner.username), 400, /no email/)
    await rejects(() => recordConsent(prisma, c.id, { channel: 'SMS', status: 'OPTED_IN', method: '' }, owner.username), 400)
  })
})

describe('go-live gate: every condition blocks a broadcast with zero requests', () => {
  const blockers: [string, () => Promise<void>, RegExp][] = [
    ['env GRACE_MARKETING_LIVE off', async () => { process.env.GRACE_MARKETING_LIVE = 'false' }, /switched off on this server/],
    ['live switched off in settings', async () => { await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: false } }) }, /marketing settings/],
    ['channel not connected', async () => { await prisma.marketingChannel.update({ where: { id: channelIds[0] }, data: { status: 'NOT_CONNECTED' } }) }, /not connected/],
    ['channel has no credentials', async () => { await prisma.marketingChannel.update({ where: { id: channelIds[0] }, data: { credentialsEnc: null } }) }, /no saved credentials/],
  ]
  for (const [label, breakIt, re] of blockers) {
    test(label, async () => {
      const c = await contact({ optIn: ['SMS'] })
      const b = await approvedBroadcast([c.id])
      const p = fakeProvider('SMS')
      await breakIt()
      await rejects(() => broadcastAction(prisma, b.id, 'send', owner, depsFor(p.connector)), 409, re)
      assert.strictEqual(p.sent.length, 0)
      assert.strictEqual((await db(b.id)).status, 'APPROVED')
      assert.strictEqual((await recipients(b.id)).length, 0)
      const detail = await getBroadcastDetail(prisma, b.id)
      assert.ok(detail.blockedReasons.some((r) => re.test(r)), 'the screen lists why')
    })
  }

  test('not approved: a draft, a pending message, and an APPROVED row with the approval wiped', async () => {
    const c = await contact({ optIn: ['SMS'] })
    const p = fakeProvider('SMS')
    const draft = await createBroadcast(prisma, { channelKind: 'SMS', name: 'ZP1200 draft', text: 'Hi', audienceFilter: { contactIds: [c.id] } }, owner.username)
    broadcastIds.push(draft.id)
    await rejects(() => broadcastAction(prisma, draft.id, 'send', owner, depsFor(p.connector)), 409)
    await broadcastAction(prisma, draft.id, 'submit', owner, depsFor(p.connector))
    await rejects(() => broadcastAction(prisma, draft.id, 'send', owner, depsFor(p.connector)), 409)
    const b = await approvedBroadcast([c.id])
    await prisma.marketingBroadcast.update({ where: { id: b.id }, data: { approvedBy: null, approvedAt: null } })
    await rejects(() => broadcastAction(prisma, b.id, 'send', owner, depsFor(p.connector)), 409, /approved/)
    assert.strictEqual(p.sent.length, 0)
  })

  test('staff cannot approve or send', async () => {
    const c = await contact({ optIn: ['SMS'] })
    const b = await createBroadcast(prisma, { channelKind: 'SMS', name: 'ZP1200 staff', text: 'Hi', audienceFilter: { contactIds: [c.id] } }, staff.username)
    broadcastIds.push(b.id)
    const p = fakeProvider('SMS')
    await broadcastAction(prisma, b.id, 'submit', staff, depsFor(p.connector))
    await rejects(() => broadcastAction(prisma, b.id, 'approve', staff, depsFor(p.connector)), 409, /owner/)
    assert.strictEqual(p.sent.length, 0)
  })

  test('the real SMS connector with a counting fetch: zero requests when blocked mid-run, and the gate is read again for each message', async () => {
    const a = await contact({ optIn: ['SMS'] })
    const b2 = await contact({ optIn: ['SMS'] })
    const b = await approvedBroadcast([a.id, b2.id])
    let requests = 0
    const deps: BroadcastDeps = {
      baseUrl: 'https://vyra.example', sleep: async () => { await prisma.marketingSettings.update({ where: { id: 1 }, data: { liveEnabled: false } }) },
      fetch: async () => { requests++; return new Response(JSON.stringify({ sid: `SM${requests}`, status: 'queued' }), { status: 201 }) },
      getConnector,
    }
    const r = await broadcastAction(prisma, b.id, 'send', owner, deps)
    assert.strictEqual(requests, 1, 'live was switched off after the first message, so the second never went')
    assert.match(r.run?.stoppedBecause ?? '', /marketing settings/)
    assert.strictEqual(r.broadcast.status, 'SENDING')
  })
})

describe('sending', () => {
  test('goes only to opted-in contacts, with the tracked link, once each, and finishes SENT', async () => {
    const yes1 = await contact({ optIn: ['SMS'], name: 'Tendai Moyo' })
    const yes2 = await contact({ optIn: ['SMS'], name: '' })
    const noConsent = await contact()
    const withdrew = await contact({ optIn: ['SMS'], optOut: ['SMS'] })
    const wrongChannel = await contact({ optIn: ['WHATSAPP', 'EMAIL'], withEmail: true })
    const ids = [yes1.id, yes2.id, noConsent.id, withdrew.id, wrongChannel.id]
    const b = await approvedBroadcast(ids, { text: 'Hi {name}, new dresses: https://vyra.example/p/pink and https://other.example/x' })
    const p = fakeProvider('SMS')
    const deps = depsFor(p.connector)
    const r = await broadcastAction(prisma, b.id, 'send', owner, deps)
    assert.strictEqual(r.broadcast.status, 'SENT')
    assert.strictEqual(r.run?.sent, 2)
    assert.deepStrictEqual(p.sent.map((m) => m.to).sort(), [yes1.phone, yes2.phone].sort())
    const first = p.sent.find((m) => m.to === yes1.phone)!
    assert.match(first.text, /^Hi Tendai, /)
    assert.ok(first.text.includes(`https://vyra.example/p/pink?src=${b.trackingTag}`))
    assert.ok(first.text.includes('https://other.example/x') && !first.text.includes('other.example/x?src'))
    assert.match(p.sent.find((m) => m.to === yes2.phone)!.text, /^Hi there, /)
    assert.deepStrictEqual(deps.sleeps, [1000, 1000], 'one message per second by default')
    const row = await db(b.id)
    assert.deepStrictEqual([row.plannedCount, row.sentCount, row.failedCount, row.skippedCount], [2, 2, 0, 0])
    assert.ok(row.approvedBy && row.approvedAt)
    const audit = await prisma.marketingAuditLog.findMany({ where: { entity: 'broadcast', entityId: b.id } })
    for (const a of ['broadcast.create', 'broadcast.submit', 'broadcast.approve', 'broadcast.send', 'broadcast.plan', 'broadcast.send_run', 'broadcast.finish']) assert.ok(audit.some((x) => x.action === a), a)
  })

  test('the rate is configurable (GRACE_MARKETING_SEND_PER_SECOND)', async () => {
    const a = await contact({ optIn: ['SMS'] }); const c = await contact({ optIn: ['SMS'] })
    const b = await approvedBroadcast([a.id, c.id])
    const deps = depsFor(fakeProvider('SMS').connector, { env: { GRACE_MARKETING_LIVE: 'true', GRACE_MARKETING_SEND_PER_SECOND: '2' } })
    await broadcastAction(prisma, b.id, 'send', owner, deps)
    assert.deepStrictEqual(deps.sleeps, [500, 500])
  })

  test('no double send: a second send, a second continue and two runs at once each message a person once', async () => {
    const people = await Promise.all([1, 2, 3, 4].map(() => contact({ optIn: ['SMS'] })))
    const b = await approvedBroadcast(people.map((c) => c.id))
    const p = fakeProvider('SMS')
    const slow = fakeProvider('SMS', async (_m, n) => { await new Promise((r) => setTimeout(r, 5)); return { ok: true, externalId: `e${n}` } })
    void p
    await broadcastAction(prisma, b.id, 'send', owner, depsFor(slow.connector), { max: 1 })
    await Promise.all([continueSending(prisma, b.id, owner, depsFor(slow.connector)), continueSending(prisma, b.id, owner, depsFor(slow.connector))])
    assert.strictEqual(slow.sent.length, 4)
    assert.strictEqual(new Set(slow.sent.map((m) => m.to)).size, 4)
    assert.strictEqual((await db(b.id)).status, 'SENT')
    await rejects(() => broadcastAction(prisma, b.id, 'send', owner, depsFor(slow.connector)), 409)
    await rejects(() => broadcastAction(prisma, b.id, 'retry', owner, depsFor(slow.connector)), 409)
    await rejects(() => continueSending(prisma, b.id, owner, depsFor(slow.connector)), 409)
    assert.strictEqual(slow.sent.length, 4)
  })

  test('one row per person is enforced by the database', async () => {
    const c = await contact({ optIn: ['SMS'] })
    const b = await approvedBroadcast([c.id])
    await prisma.marketingBroadcastRecipient.create({ data: { broadcastId: b.id, contactId: c.id } })
    await assert.rejects(() => prisma.marketingBroadcastRecipient.create({ data: { broadcastId: b.id, contactId: c.id } }), (e: unknown) => (e as { code?: string }).code === 'P2002')
  })

  test('an opt-out recorded during the send is honoured before that person is messaged', async () => {
    const a = await contact({ optIn: ['SMS'] }); const c = await contact({ optIn: ['SMS'] })
    const b = await approvedBroadcast([a.id, c.id])
    const p = fakeProvider('SMS')
    const deps = depsFor(p.connector, { sleep: async () => { await recordConsent(prisma, c.id, { channel: 'SMS', status: 'OPTED_OUT', method: 'replied stop' }, owner.username) } })
    const r = await broadcastAction(prisma, b.id, 'send', owner, deps)
    assert.deepStrictEqual(p.sent.map((m) => m.to), [a.phone])
    assert.strictEqual(r.run?.skipped, 1)
    const rows = await recipients(b.id)
    assert.strictEqual(rows.find((x) => x.contactId === c.id)?.status, 'SKIPPED')
    assert.strictEqual(r.broadcast.status, 'SENT')
  })

  test('at most `max` messages per run; the rest wait and carry on', async () => {
    const people = await Promise.all([1, 2, 3].map(() => contact({ optIn: ['SMS'] })))
    const b = await approvedBroadcast(people.map((c) => c.id))
    const p = fakeProvider('SMS')
    const r1 = await broadcastAction(prisma, b.id, 'send', owner, depsFor(p.connector), { max: 2 })
    assert.strictEqual(r1.run?.sent, 2); assert.strictEqual(r1.broadcast.status, 'SENDING')
    const r2 = await continueSending(prisma, b.id, owner, depsFor(p.connector), { max: 2 })
    assert.strictEqual(r2.run?.sent, 1); assert.strictEqual(r2.broadcast.status, 'SENT')
    assert.strictEqual(p.sent.length, 3)
  })

  test('the daily cap stops the run and sending carries on once it allows', async () => {
    const people = await Promise.all([1, 2, 3].map(() => contact({ optIn: ['SMS'] })))
    const b = await approvedBroadcast(people.map((c) => c.id))
    const p = fakeProvider('SMS')
    const before = await prisma.marketingBroadcastRecipient.count({ where: { status: 'SENT', sentAt: { gte: new Date(Date.now() - 86_400_000) } } })
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { messageDailyCap: before + 1 } })
    const r1 = await broadcastAction(prisma, b.id, 'send', owner, depsFor(p.connector))
    assert.strictEqual(p.sent.length, 1)
    assert.match(r1.run?.stoppedBecause ?? '', /daily limit/)
    assert.strictEqual(r1.broadcast.status, 'SENDING')
    assert.ok((await getBroadcastDetail(prisma, b.id)).blockedReasons.some((x) => /daily limit/.test(x)))
    await prisma.marketingSettings.update({ where: { id: 1 }, data: { messageDailyCap: 10000 } })
    const r2 = await continueSending(prisma, b.id, owner, depsFor(p.connector))
    assert.strictEqual(r2.broadcast.status, 'SENT'); assert.strictEqual(p.sent.length, 3)
  })

  test('retry is idempotent: only failed people are sent again, never the sent ones, and never twice', async () => {
    const people = await Promise.all([1, 2, 3].map(() => contact({ optIn: ['SMS'] })))
    const b = await approvedBroadcast(people.map((c) => c.id))
    let failFor: string | null = people[1].phone
    const p = fakeProvider('SMS', (m) => (m.to === failFor ? { ok: false, error: 'Twilio is busy', retryable: false } : { ok: true, externalId: 'x' }))
    const r1 = await broadcastAction(prisma, b.id, 'send', owner, depsFor(p.connector))
    assert.strictEqual(r1.broadcast.status, 'FAILED'); assert.strictEqual(r1.broadcast.failedCount, 1); assert.strictEqual(r1.broadcast.sentCount, 2)
    assert.strictEqual(p.sent.length, 3)
    failFor = null
    const r2 = await broadcastAction(prisma, b.id, 'retry', owner, depsFor(p.connector))
    assert.strictEqual(r2.broadcast.status, 'SENT'); assert.strictEqual(r2.broadcast.sentCount, 3)
    assert.strictEqual(p.sent.length, 4, 'only the failed person was sent again')
    assert.strictEqual(p.sent.filter((m) => m.to === people[0].phone).length, 1)
    await rejects(() => broadcastAction(prisma, b.id, 'retry', owner, depsFor(p.connector)), 409)
  })

  test('a send whose outcome is unknown (crashed run) is never repeated by a retry', async () => {
    const a = await contact({ optIn: ['SMS'] }); const c = await contact({ optIn: ['SMS'] })
    const b = await approvedBroadcast([a.id, c.id])
    const p = fakeProvider('SMS')
    await broadcastAction(prisma, b.id, 'send', owner, depsFor(p.connector), { max: 1 })
    const pending = (await recipients(b.id)).find((r) => r.status === 'PENDING')!
    await prisma.marketingBroadcastRecipient.update({ where: { id: pending.id }, data: { status: 'SENDING' } }) // another run is sending it right now
    const busy = await continueSending(prisma, b.id, owner, depsFor(p.connector))
    assert.strictEqual(busy.broadcast.status, 'SENDING', 'a message another run is sending is not called failed')
    await prisma.marketingBroadcastRecipient.update({ where: { id: pending.id }, data: { updatedAt: new Date(Date.now() - 20 * 60 * 1000) } }) // that run died
    const r = await continueSending(prisma, b.id, owner, depsFor(p.connector))
    assert.strictEqual(p.sent.length, 1)
    assert.strictEqual(r.broadcast.status, 'FAILED')
    assert.match((await recipients(b.id)).find((x) => x.id === pending.id)?.error ?? '', /Not sure/)
    await broadcastAction(prisma, b.id, 'retry', owner, depsFor(p.connector))
    assert.strictEqual(p.sent.length, 1, 'still not sent: nobody is messaged on a guess')
  })

  test('a provider STOP reply records an opt-out and the person is skipped', async () => {
    const a = await contact({ optIn: ['SMS'] })
    const b = await approvedBroadcast([a.id])
    const p = fakeProvider('SMS', () => ({ ok: false, error: 'stopped', retryable: false, code: 21610, optedOut: true }))
    const r = await broadcastAction(prisma, b.id, 'send', owner, depsFor(p.connector))
    assert.strictEqual(r.broadcast.skippedCount, 1)
    const aud = await computeAudience(prisma, { channelKind: 'SMS', audienceFilter: { contactIds: [a.id] } })
    assert.strictEqual(aud.eligible.length, 0)
  })

  test('a rejected token stops the run and marks the channel ERROR', async () => {
    const people = await Promise.all([1, 2].map(() => contact({ optIn: ['SMS'] })))
    const b = await approvedBroadcast(people.map((c) => c.id))
    const p = fakeProvider('SMS', () => ({ ok: false, error: 'Twilio no longer accepts', retryable: false, code: 401 }))
    const r = await broadcastAction(prisma, b.id, 'send', owner, depsFor(p.connector))
    assert.strictEqual(p.sent.length, 1)
    assert.strictEqual(r.broadcast.status, 'SENDING')
    assert.strictEqual((await prisma.marketingChannel.findUniqueOrThrow({ where: { id: channelIds[0] } })).status, 'ERROR')
  })

  test('editing an approved message sends it back to a draft: the approval was for the exact words', async () => {
    const a = await contact({ optIn: ['SMS'] })
    const b = await approvedBroadcast([a.id])
    const e = await updateBroadcast(prisma, b.id, { text: 'Different words' }, owner)
    assert.strictEqual(e.status, 'DRAFT'); assert.strictEqual(e.approvedBy, null); assert.strictEqual(e.approvedAt, null)
    const p = fakeProvider('SMS')
    await rejects(() => broadcastAction(prisma, b.id, 'send', owner, depsFor(p.connector)), 409)
    assert.strictEqual(p.sent.length, 0)
  })

  test('cancel stops a send in progress', async () => {
    const people = await Promise.all([1, 2, 3].map(() => contact({ optIn: ['SMS'] })))
    const b = await approvedBroadcast(people.map((c) => c.id))
    const p = fakeProvider('SMS')
    await broadcastAction(prisma, b.id, 'send', owner, depsFor(p.connector), { max: 1 })
    await broadcastAction(prisma, b.id, 'cancel', owner, depsFor(p.connector))
    await rejects(() => continueSending(prisma, b.id, owner, depsFor(p.connector)), 409)
    assert.strictEqual(p.sent.length, 1)
  })

  test('validation: SMS length, email subject, WhatsApp template', async () => {
    await rejects(() => createBroadcast(prisma, { channelKind: 'SMS', name: 'x', text: 'a'.repeat(300) }, owner.username), 400, /too long/)
    await rejects(() => createBroadcast(prisma, { channelKind: 'FACEBOOK_PAGE', name: 'x', text: 'a' }, owner.username), 400)
    const e = await createBroadcast(prisma, { channelKind: 'EMAIL', name: 'ZP1200 nosubject', text: 'Hello' }, owner.username)
    broadcastIds.push(e.id)
    await rejects(() => broadcastAction(prisma, e.id, 'submit', owner, depsFor(fakeProvider('EMAIL').connector)), 409, /subject/)
    const w = await createBroadcast(prisma, { channelKind: 'WHATSAPP_CLOUD', name: 'ZP1200 notemplate', text: 'Hello' }, owner.username)
    broadcastIds.push(w.id)
    await rejects(() => broadcastAction(prisma, w.id, 'submit', owner, depsFor(fakeProvider('WHATSAPP_CLOUD').connector)), 409, /template/)
    await rejects(() => createBroadcast(prisma, { channelKind: 'WHATSAPP_CLOUD', name: 'x', text: 'a', templateName: 'Bad Name' }, owner.username), 400)
  })
})

describe('WhatsApp and email end to end with the real connectors and a fake fetch', () => {
  test('WhatsApp: a template message to the opted-in person only', async () => {
    const yes = await contact({ optIn: ['WHATSAPP'], name: 'Rudo Banda' }); const sms = await contact({ optIn: ['SMS'] })
    const b = await approvedBroadcast([yes.id, sms.id], { channelKind: 'WHATSAPP_CLOUD', text: 'Hi {name}, new arrivals', templateName: 'new_arrivals', templateVars: ['{name}'] })
    const calls: { url: string; body: { to: string; template: { name: string; components: { parameters: { text: string }[] }[] } } }[] = []
    const deps: BroadcastDeps = { baseUrl: 'https://vyra.example', sleep: async () => {}, getConnector, fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init?.body as string) }); return new Response(JSON.stringify({ messages: [{ id: `wamid.${calls.length}` }] })) } }
    const r = await broadcastAction(prisma, b.id, 'send', owner, deps)
    assert.strictEqual(r.broadcast.status, 'SENT')
    assert.strictEqual(calls.length, 1)
    assert.match(calls[0].url, /graph\.facebook\.com\/v[\d.]+\/1098765\/messages$/)
    assert.strictEqual(calls[0].body.to, yes.phone!.slice(1))
    assert.strictEqual(calls[0].body.template.name, 'new_arrivals')
    assert.strictEqual(calls[0].body.template.components[0].parameters[0].text, 'Rudo')
    assert.strictEqual((await recipients(b.id))[0].externalId, 'wamid.1')
  })

  test('email: the unsubscribe link in the message really opts that person out, and the next send skips them', async () => {
    const c = await contact({ optIn: ['EMAIL'], withEmail: true })
    const b = await approvedBroadcast([c.id], { channelKind: 'EMAIL', subject: 'New in', text: 'Hello {name}' })
    const bodies: { to: { email: string }[]; headers: Record<string, string> }[] = []
    const deps: BroadcastDeps = { baseUrl: 'https://vyra.example', sleep: async () => {}, getConnector, fetch: async (_u, init) => { bodies.push(JSON.parse(init?.body as string)); return new Response(JSON.stringify({ messageId: '<m1>' }), { status: 201 }) } }
    await broadcastAction(prisma, b.id, 'send', owner, deps)
    assert.strictEqual(bodies.length, 1)
    assert.strictEqual(bodies[0].to[0].email, c.email)
    const link = bodies[0].headers['List-Unsubscribe'].slice(1, -1)
    const token = new URL(link).searchParams.get('t')
    assert.deepStrictEqual(verifyUnsubscribeToken(token), { contactId: c.id, channel: 'EMAIL' })
    assert.strictEqual(await applyUnsubscribe(prisma, token), 'done')
    assert.strictEqual(await applyUnsubscribe(prisma, token), 'already')
    assert.strictEqual(await applyUnsubscribe(prisma, `${token}x`), 'invalid')
    const aud = await computeAudience(prisma, { channelKind: 'EMAIL', audienceFilter: { contactIds: [c.id] } })
    assert.strictEqual(aud.eligible.length, 0)
    const history = await prisma.marketingConsent.findMany({ where: { contactId: c.id, channel: 'EMAIL' }, orderBy: { id: 'asc' } })
    assert.deepStrictEqual(history.map((h) => h.status), ['OPTED_IN', 'OPTED_OUT'])
    assert.strictEqual(history[1].recordedBy, 'self:unsubscribe')
  })
})

describe('the runner', () => {
  test('starts a due approved message, leaves a future one, and is blocked by the gate', async () => {
    // Earlier tests leave some messages half-sent: the runner would carry those on too, so stop them first.
    await prisma.marketingBroadcast.updateMany({ where: { id: { in: broadcastIds }, status: { in: ['SENDING', 'APPROVED'] } }, data: { status: 'CANCELLED' } })
    const a = await contact({ optIn: ['SMS'] })
    const due = await approvedBroadcast([a.id], { scheduledFor: new Date(Date.now() - 60_000).toISOString() })
    const c = await contact({ optIn: ['SMS'] })
    const later = await approvedBroadcast([c.id], { scheduledFor: new Date(Date.now() + 86_400_000).toISOString() })
    const p = fakeProvider('SMS')
    await setLive(false)
    const blocked = await runDueBroadcasts(prisma, new Date(), depsFor(p.connector))
    assert.ok(blocked.blocked.some((x) => x.id === due.id)); assert.strictEqual(p.sent.length, 0)
    await setLive(true)
    const ok = await runDueBroadcasts(prisma, new Date(), depsFor(p.connector))
    assert.ok(ok.started.includes(due.id)); assert.ok(!ok.started.includes(later.id))
    assert.strictEqual(p.sent.length, 1)
    assert.strictEqual((await db(later.id)).status, 'APPROVED')
  })
})
