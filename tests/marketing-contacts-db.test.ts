// ZP-1200: contacts, consent history, CSV import, the public unsubscribe route and partners against DATABASE_URL.
// Only touches rows it creates (createdBy zp1200-ct, partner codes zp1200-*, analytics rows with campaign zp1200-*).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zp1200-test-secret-0123456789abcdef0123'

import prisma from '../src/lib/db'
import { commitImport, createContact, getContact, listContacts, previewImport, recordConsent, updateContact } from '../src/lib/marketing/contacts'
import { consentSummary } from '../src/lib/marketing/consent'
import { signUnsubscribeToken } from '../src/lib/marketing/unsubscribe'
import { createPartner, getPartner, listPartners, shareKit, updatePartner } from '../src/lib/marketing/partners'
import { WebsiteError } from '../src/lib/website/http'
import * as unsub from '../src/app/api/public/marketing/unsubscribe/route'

const ACTOR = 'zp1200-ct'
const rejects = async (fn: () => Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(fn, (e: unknown) => e instanceof WebsiteError && e.status === status && (!re || re.test(e.message)))

const tag = Math.random().toString(36).slice(2, 8)
const num = (n: number) => `+2637${String(10_000_00 + Number(tag.replace(/\D/g, '').slice(0, 4) || 0) * 10 + n).padStart(8, '0')}`.slice(0, 13)
const partnerIds: number[] = []
let productId = 0
let categoryId = 0
const KEY = `products/${'d'.repeat(32)}.webp`
const campaigns = [`zp1200-${tag}-a`, `zp1200-${tag}-b`]

before(async () => {
  const cat = await prisma.category.create({ data: { slug: `zp1200ct-${tag}`, name: 'Dresses', published: true } })
  categoryId = cat.id
  const p = await prisma.product.create({ data: { itemNumber: `ZP1200CT-${tag}`, productName: 'ZP1200CT Pink Dress', slug: `zp1200ct-pink-${tag}`, published: true, publishedAt: new Date(), categoryId, currentQuantity: 2, priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 12 } })
  productId = p.id
  await prisma.productImage.create({ data: { productId, imageKey: KEY, isPrimary: true } })
})

after(async () => {
  await prisma.marketingContact.deleteMany({ where: { createdBy: ACTOR } })
  await prisma.marketingPartner.deleteMany({ where: { id: { in: partnerIds } } })
  await prisma.analyticsDailySource.deleteMany({ where: { campaign: { startsWith: 'zp1200-' } } })
  await prisma.productImage.deleteMany({ where: { productId } })
  await prisma.product.deleteMany({ where: { id: productId } })
  await prisma.category.deleteMany({ where: { id: categoryId } })
  await prisma.marketingAuditLog.deleteMany({ where: { actor: { in: [ACTOR, 'self:unsubscribe'] }, createdAt: { gte: new Date(Date.now() - 3_600_000) } } })
  await prisma.$disconnect()
})

describe('contacts', () => {
  test('a new contact has NO consent, numbers are stored as +263, duplicates are refused', async () => {
    const c = await createContact(prisma, { name: 'Tendai', phone: `0771${tag.replace(/\D/g, '0').padEnd(6, '0').slice(0, 6)}`.slice(0, 10), email: ` Tendai-${tag}@Example.com ` }, ACTOR)
    assert.match(c.phone as string, /^\+263771\d{6}$/)
    assert.strictEqual(c.email, `tendai-${tag}@example.com`)
    assert.deepStrictEqual(c.consent, { WHATSAPP: 'NONE', SMS: 'NONE', EMAIL: 'NONE' })
    assert.strictEqual(c.source, 'MANUAL')
    await rejects(() => createContact(prisma, { phone: c.phone }, ACTOR), 409, /phone/)
    await rejects(() => createContact(prisma, { email: c.email }, ACTOR), 409, /email/)
    await rejects(() => createContact(prisma, { name: 'x' }, ACTOR), 400)
    await rejects(() => createContact(prisma, { phone: 'abc' }, ACTOR), 400)
    await rejects(() => createContact(prisma, { phone: '+263771111111', consent: 'OPTED_IN' }, ACTOR), 400)
  })

  test('consent history keeps every change; the latest wins; the method is required; edits and search work', async () => {
    const c = await createContact(prisma, { name: 'Rudo ZP1200', phone: '+263772' + tag.replace(/\D/g, '1').padEnd(6, '2').slice(0, 6) }, ACTOR)
    await recordConsent(prisma, c.id, { channel: 'WHATSAPP', status: 'OPTED_IN', method: 'said yes on WhatsApp on 26 Nov', evidence: 'chat screenshot' }, ACTOR)
    let after = await recordConsent(prisma, c.id, { channel: 'WHATSAPP', status: 'OPTED_OUT', method: 'asked to stop' }, ACTOR)
    assert.strictEqual(after.consent.WHATSAPP, 'OPTED_OUT')
    after = await recordConsent(prisma, c.id, { channel: 'WHATSAPP', status: 'OPTED_IN', method: 'asked to be added back' }, ACTOR)
    assert.strictEqual(after.consent.WHATSAPP, 'OPTED_IN')
    assert.strictEqual(after.consent.SMS, 'NONE')
    const { history } = await getContact(prisma, c.id)
    assert.deepStrictEqual(history.map((h) => h.status), ['OPTED_IN', 'OPTED_OUT', 'OPTED_IN'])
    assert.strictEqual(history[2].method, 'said yes on WhatsApp on 26 Nov'); assert.strictEqual(history[2].evidence, 'chat screenshot')
    await rejects(() => recordConsent(prisma, c.id, { channel: 'SMS', status: 'OPTED_IN', method: '  ' }, ACTOR), 400)
    await rejects(() => recordConsent(prisma, c.id, { channel: 'TELEGRAM', status: 'OPTED_IN', method: 'x' }, ACTOR), 400)
    await rejects(() => recordConsent(prisma, 987654321, { channel: 'SMS', status: 'OPTED_IN', method: 'x' }, ACTOR), 404)
    const u = await updateContact(prisma, c.id, { notes: 'met at the market' }, ACTOR)
    assert.strictEqual(u.notes, 'met at the market'); assert.strictEqual(u.consent.WHATSAPP, 'OPTED_IN')
    const found = await listContacts(prisma, { q: 'Rudo ZP1200' })
    assert.ok(found.contacts.some((x) => x.id === c.id))
    const filtered = await listContacts(prisma, { q: 'Rudo ZP1200', channel: 'WHATSAPP', status: 'OPTED_IN' })
    assert.ok(filtered.contacts.some((x) => x.id === c.id))
    const other = await listContacts(prisma, { q: 'Rudo ZP1200', channel: 'SMS', status: 'OPTED_IN' })
    assert.ok(!other.contacts.some((x) => x.id === c.id))
    const audit = await prisma.marketingAuditLog.findMany({ where: { entity: 'contact', entityId: c.id } })
    assert.ok(audit.some((a) => a.action === 'consent.opt_in') && audit.some((a) => a.action === 'consent.opt_out'))
  })
})

describe('CSV import', () => {
  const p1 = `0773${tag.replace(/\D/g, '3').padEnd(6, '4').slice(0, 6)}`
  const p2 = `0774${tag.replace(/\D/g, '5').padEnd(6, '6').slice(0, 6)}`
  const csv = `name,phone,email\nAnna ZP1200,${p1},anna-${tag}@example.com\nBen ZP1200,${p2},\nnobody,,\nBad,12,\nAnna again,${p1},\n`

  test('without a consent column nobody is opted in, even if the file says "yes" in another column', async () => {
    const withYes = csv.replace('name,phone,email', 'name,phone,email,agreed').replace(/\n(?=\w)/g, ',yes\n').replace(',yes\n', '\n')
    const plan = await previewImport(prisma, { csv: withYes, fileName: 'customers.csv' })
    assert.strictEqual(plan.hasConsentColumns, false)
    assert.deepStrictEqual([plan.totals.create, plan.totals.skip, plan.totals.optIns], [2, 3, 0])
    assert.strictEqual(await prisma.marketingContact.count({ where: { name: { in: ['Anna ZP1200', 'Ben ZP1200'] } } }), 0, 'a preview writes nothing')
    const done = await commitImport(prisma, { csv: withYes, fileName: 'customers.csv', commit: true }, ACTOR)
    assert.deepStrictEqual([done.created, done.updated], [2, 0])
    const made = await prisma.marketingContact.findMany({ where: { name: { in: ['Anna ZP1200', 'Ben ZP1200'] } }, include: { consents: true } })
    assert.strictEqual(made.length, 2)
    for (const m of made) { assert.strictEqual(m.source, 'IMPORT'); assert.strictEqual(m.consents.length, 0) }
    const audit = await prisma.marketingAuditLog.findFirst({ where: { action: 'contacts.import', actor: ACTOR }, orderBy: { id: 'desc' } })
    assert.deepStrictEqual((audit?.detail as { fileName: string; created: number; optIns: number }), { ...(audit?.detail as object), fileName: 'customers.csv', created: 2, optIns: 0 })
    // Running it again creates nobody twice.
    const again = await commitImport(prisma, { csv: withYes, commit: true }, ACTOR)
    assert.deepStrictEqual([again.created, again.updated], [0, 2])
  })

  test('with an explicit consent column: yes needs the owner to confirm; opt-ins are recorded with the method; an earlier opt-out stays', async () => {
    const q1 = `0775${tag.replace(/\D/g, '7').padEnd(6, '8').slice(0, 6)}`
    const q2 = `0776${tag.replace(/\D/g, '9').padEnd(6, '1').slice(0, 6)}`
    const q3 = `0778${tag.replace(/\D/g, '2').padEnd(6, '3').slice(0, 6)}`
    const stays = await createContact(prisma, { name: 'Stays out ZP1200', phone: q3 }, ACTOR)
    await recordConsent(prisma, stays.id, { channel: 'SMS', status: 'OPTED_IN', method: 'form' }, ACTOR)
    await recordConsent(prisma, stays.id, { channel: 'SMS', status: 'OPTED_OUT', method: 'said stop' }, ACTOR)
    const file = `name,phone,sms_consent,consent_method\nCara ZP1200,${q1},yes,Ticked the box on the sign-up sheet 20 Nov\nDan ZP1200,${q2},no,\nStays out ZP1200,${q3},yes,Sheet\nEve ZP1200,${num(5)},maybe,`
    const plan = await previewImport(prisma, { csv: file })
    assert.strictEqual(plan.hasConsentColumns, true)
    assert.deepStrictEqual([plan.totals.optIns, plan.totals.optOuts, plan.totals.ignoredOptIns], [1, 1, 1])
    await rejects(() => commitImport(prisma, { csv: file, commit: true }, ACTOR), 409, /confirm/)
    assert.strictEqual(await prisma.marketingContact.count({ where: { name: 'Cara ZP1200' } }), 0, 'nothing written without confirmation')
    await commitImport(prisma, { csv: file, commit: true, confirmConsent: true }, ACTOR)
    const cara = await prisma.marketingContact.findFirstOrThrow({ where: { name: 'Cara ZP1200' }, include: { consents: true } })
    assert.deepStrictEqual(cara.consents.map((c) => [c.channel, c.status, c.method]), [['SMS', 'OPTED_IN', 'Ticked the box on the sign-up sheet 20 Nov']])
    assert.strictEqual(cara.consents[0].recordedBy, ACTOR)
    const dan = await prisma.marketingContact.findFirstOrThrow({ where: { name: 'Dan ZP1200' }, include: { consents: true } })
    assert.strictEqual(consentSummary(dan.consents).SMS, 'OPTED_OUT')
    const eve = await prisma.marketingContact.findFirstOrThrow({ where: { name: 'Eve ZP1200' }, include: { consents: true } })
    assert.strictEqual(eve.consents.length, 0, '"maybe" is not a yes')
    assert.strictEqual(consentSummary((await getContact(prisma, stays.id)).history).SMS, 'OPTED_OUT')
  })

  test('limits and a missing header are refused', async () => {
    await rejects(() => previewImport(prisma, { csv: '' }), 400)
    await rejects(() => previewImport(prisma, { csv: 'name,notes\nA,b' }), 400, /phone/)
    await rejects(() => previewImport(prisma, { csv: 'phone\n' }), 400)
    await rejects(() => previewImport(prisma, { csv: 'phone\n' + '0771234567\n'.repeat(2001) }), 400, /2000/)
  })
})

describe('public unsubscribe route', () => {
  async function fresh() {
    const c = await createContact(prisma, { phone: `+26377${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}` }, ACTOR)
    await recordConsent(prisma, c.id, { channel: 'SMS', status: 'OPTED_IN', method: 'asked' }, ACTOR)
    return c
  }
  const url = (q: string) => `https://vyra.example/api/public/marketing/unsubscribe${q}`
  const sms = async (id: number) => consentSummary((await getContact(prisma, id)).history).SMS

  test('GET with a good token opts out and answers a plain page; again says the same; the history keeps the opt-in', async () => {
    const c = await fresh()
    const t = encodeURIComponent(signUnsubscribeToken(c.id, 'SMS'))
    const r = await unsub.GET(new Request(url(`?t=${t}`)))
    assert.strictEqual(r.status, 200)
    assert.match(r.headers.get('content-type') ?? '', /text\/html/)
    assert.match(await r.text(), /You are unsubscribed/)
    assert.strictEqual(await sms(c.id), 'OPTED_OUT')
    assert.strictEqual((await unsub.GET(new Request(url(`?t=${t}`)))).status, 200)
    assert.strictEqual((await prisma.marketingConsent.count({ where: { contactId: c.id } })), 2, 'no duplicate row the second time')
  })

  test('POST (one-click) and JSON answers', async () => {
    const c = await fresh()
    const t = encodeURIComponent(signUnsubscribeToken(c.id, 'SMS'))
    const r = await unsub.POST(new Request(url(`?t=${t}`), { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }))
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(await r.json(), { ok: true, status: 'unsubscribed' })
    assert.strictEqual(await sms(c.id), 'OPTED_OUT')
    const j = await unsub.GET(new Request(url(`?t=${t}&format=json`)))
    assert.deepStrictEqual(await j.json(), { ok: true, status: 'already_unsubscribed' })
    const c2 = await fresh()
    const form = new URLSearchParams({ t: signUnsubscribeToken(c2.id, 'SMS') })
    const r2 = await unsub.POST(new Request(url(''), { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } }))
    assert.strictEqual(r2.status, 200)
    assert.strictEqual(await sms(c2.id), 'OPTED_OUT')
  })

  test('a tampered, wrong-channel, other-contact or missing token is refused and writes nothing', async () => {
    const c = await fresh()
    const good = signUnsubscribeToken(c.id, 'SMS')
    const [, , sig] = good.split('.')
    for (const bad of [`${c.id}.SMS.${sig}x`, `${c.id}.EMAIL.${sig}`, `${c.id + 1}.SMS.${sig}`, '', 'garbage']) {
      assert.strictEqual((await unsub.GET(new Request(url(`?t=${encodeURIComponent(bad)}`)))).status, 400, bad)
      assert.strictEqual((await unsub.POST(new Request(url(`?t=${encodeURIComponent(bad)}`), { method: 'POST' }))).status, 400, bad)
    }
    assert.strictEqual((await unsub.GET(new Request(url('')))).status, 400)
    assert.strictEqual(await sms(c.id), 'OPTED_IN')
    assert.strictEqual((await unsub.GET(new Request(url(`?t=${signUnsubscribeToken(987654321, 'SMS')}`)))).status, 400, 'a valid signature for a contact that does not exist')
  })

  test('it works even when the hub kill switch is on', async () => {
    const saved = process.env.GRACE_MARKETING_HUB
    process.env.GRACE_MARKETING_HUB = 'false'
    try {
      const c = await fresh()
      assert.strictEqual((await unsub.GET(new Request(url(`?t=${encodeURIComponent(signUnsubscribeToken(c.id, 'SMS'))}`)))).status, 200)
      assert.strictEqual(await sms(c.id), 'OPTED_OUT')
    } finally {
      if (saved === undefined) delete process.env.GRACE_MARKETING_HUB; else process.env.GRACE_MARKETING_HUB = saved
    }
  })
})

describe('partners', () => {
  test('create with a typed or suggested code; codes are unique and survive the link tracking; the code is fixed', async () => {
    const a = await createPartner(prisma, { name: 'Tendai Influencer', kind: 'INFLUENCER', code: campaigns[0], commissionPercent: 10, phone: '077 123 4567', handle: '@tendai' }, ACTOR)
    partnerIds.push(a.id)
    assert.strictEqual(a.code, campaigns[0]); assert.strictEqual(a.status, 'ACTIVE'); assert.strictEqual(a.phone, '+263771234567')
    await rejects(() => createPartner(prisma, { name: 'Other', kind: 'RESELLER', code: campaigns[0] }, ACTOR), 409, /already used/)
    await rejects(() => createPartner(prisma, { name: 'Other', kind: 'RESELLER', code: 'Bad Code' }, ACTOR), 400)
    await rejects(() => createPartner(prisma, { name: 'Other', kind: 'SELLER' }, ACTOR), 400)
    await rejects(() => createPartner(prisma, { name: 'Other', kind: 'RESELLER', commissionPercent: 101 }, ACTOR), 400)
    const auto = await createPartner(prisma, { name: 'Zim Reseller', kind: 'RESELLER' }, ACTOR)
    partnerIds.push(auto.id)
    assert.match(auto.code, /^zim-[0-9a-f]{3}$/)
    await rejects(() => updatePartner(prisma, a.id, { code: 'new-code' }, ACTOR), 400)
    const paused = await updatePartner(prisma, a.id, { status: 'PAUSED', commissionPercent: null }, ACTOR)
    assert.strictEqual(paused.status, 'PAUSED'); assert.strictEqual(paused.commissionPercent, null)
    const audit = await prisma.marketingAuditLog.findMany({ where: { entity: 'partner', entityId: a.id } })
    assert.ok(audit.some((x) => x.action === 'partner.create') && audit.some((x) => x.action === 'partner.update'))
  })

  test('results come from AnalyticsDailySource where campaign = code', async () => {
    const [codeA, codeB] = campaigns
    const day = (n: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - n))
    await prisma.analyticsDailySource.createMany({
      data: [
        { day: day(1), source: 'whatsapp', deviceClass: 'phone', campaign: codeA, visits: 10, enquiringVisits: 3 },
        { day: day(1), source: 'instagram', deviceClass: 'phone', campaign: codeA, visits: 5, enquiringVisits: 1 },
        { day: day(2), source: 'direct', deviceClass: 'desktop', campaign: codeA, visits: 2, enquiringVisits: 0 },
        { day: day(100), source: 'direct', deviceClass: 'desktop', campaign: codeA, visits: 99, enquiringVisits: 9 },
        { day: day(1), source: 'direct', deviceClass: 'desktop', campaign: codeB, visits: 50, enquiringVisits: 50 },
      ],
    })
    const mine = await prisma.marketingPartner.findFirstOrThrow({ where: { code: codeA } })
    const p = await getPartner(prisma, mine.id)
    assert.strictEqual(p.results?.visits, 17); assert.strictEqual(p.results?.enquiries, 4)
    assert.strictEqual(p.results?.byDay.length, 2)
    const wide = await getPartner(prisma, mine.id, 365)
    assert.strictEqual(wide.results?.visits, 116)
    const listed = (await listPartners(prisma)).find((x) => x.id === mine.id)
    assert.strictEqual(listed?.results?.visits, 17)
    await rejects(() => getPartner(prisma, 987654321), 404)
  })

  test('share kit: tracked link to the shop or one product, fixed words, product photos, no prices', async () => {
    const mine = await prisma.marketingPartner.findFirstOrThrow({ where: { code: campaigns[0] } })
    process.env.GRACE_STOREFRONT_HOSTS = 'vyra.example'
    const home = await shareKit(prisma, mine.id, { host: 'vyra.example' })
    assert.ok(home.link?.endsWith(`?src=${campaigns[0]}`)); assert.deepStrictEqual(home.imageKeys, [])
    assert.ok(home.text.includes(home.link as string))
    const prod = await shareKit(prisma, mine.id, { productId, host: 'vyra.example' })
    assert.ok(prod.link?.includes(`/zp1200ct-pink-${tag}`) && prod.link.endsWith(`?src=${campaigns[0]}`))
    assert.deepStrictEqual(prod.imageKeys, [KEY]); assert.strictEqual(prod.productName, 'ZP1200CT Pink Dress')
    assert.ok(prod.text.includes('ZP1200CT Pink Dress')); assert.doesNotMatch(prod.text, /\$|USD|\d+\.\d\d/)
    await rejects(() => shareKit(prisma, mine.id, { productId: 987654321 }), 404)
  })
})
