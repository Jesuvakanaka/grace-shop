// ZP-486: GET/PUT /api/website/settings against DATABASE_URL.
// Saves the SiteSettings row before the tests and restores it afterwards.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = 'zp486-site-settings-tests-secret-0123456789'

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import * as route from '../src/app/api/website/settings/route'
import { SITE_SETTINGS_DEFAULTS } from '../src/lib/site-settings/schema'
import { loadPublicSiteSettings } from '../src/lib/site-settings/public'

type Row = Awaited<ReturnType<typeof prisma.siteSettings.findUnique>>
let saved: Row = null
let ownerToken = ''
let staffToken = ''

function req(method: 'GET' | 'PUT', token?: string, body?: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.cookie = `auth-token=${token}`
  return new Request('http://localhost/api/website/settings', {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const HOURS = {
  mon: { closed: false, open: '08:30', close: '17:00' },
  tue: { closed: false, open: '08:30', close: '17:00' },
  wed: { closed: false, open: '08:30', close: '17:00' },
  thu: { closed: false, open: '08:30', close: '17:00' },
  fri: { closed: false, open: '08:30', close: '17:00' },
  sat: { closed: false, open: '09:00', close: '13:00' },
  sun: { closed: true },
}

describe('/api/website/settings', () => {
  before(async () => {
    saved = await prisma.siteSettings.findUnique({ where: { id: 1 } })
    await prisma.siteSettings.deleteMany({})
    ownerToken = await createToken(910001, 'zp486-owner', 'OWNER')
    staffToken = await createToken(910002, 'zp486-staff', 'STAFF')
  })
  after(async () => {
    await prisma.siteSettings.deleteMany({})
    if (saved) await prisma.siteSettings.create({ data: { ...saved, openingHours: saved.openingHours ?? undefined, defaultSizeChart: saved.defaultSizeChart ?? undefined } })
    await prisma.$disconnect()
  })

  test('anonymous 401, STAFF 403 on GET and PUT', async () => {
    assert.strictEqual((await route.GET(req('GET'))).status, 401)
    assert.strictEqual((await route.PUT(req('PUT', undefined, {}))).status, 401)
    assert.strictEqual((await route.GET(req('GET', staffToken))).status, 403)
    assert.strictEqual((await route.PUT(req('PUT', staffToken, { heroHeadline: 'x' }))).status, 403)
    assert.strictEqual(await prisma.siteSettings.count(), 0)
  })

  test('GET with no row returns the defaults', async () => {
    const res = await route.GET(req('GET', ownerToken))
    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.deepStrictEqual(body.settings, { ...SITE_SETTINGS_DEFAULTS })
  })

  test('PUT rejects unknown fields and writes nothing', async () => {
    const res = await route.PUT(req('PUT', ownerToken, { heroHeadline: 'New', updatedBy: 'mallory', id: 7 }))
    assert.strictEqual(res.status, 400)
    const body = await res.json()
    assert.match(body.error, /Unknown field/)
    assert.ok(body.fieldErrors.updatedBy && body.fieldErrors.id)
    assert.strictEqual(await prisma.siteSettings.count(), 0)
  })

  test('PUT rejects bad values with per-field errors and writes nothing', async () => {
    const res = await route.PUT(
      req('PUT', ownerToken, {
        whatsappNumber: '0771234567',
        instagramUrl: 'https://evil.example/vyra',
        fewLeftThreshold: 99,
        openingHours: { ...HOURS, mon: { closed: false, open: '18:00', close: '09:00' } },
      }),
    )
    assert.strictEqual(res.status, 400)
    const body = await res.json()
    assert.deepStrictEqual(Object.keys(body.fieldErrors).sort(), ['fewLeftThreshold', 'instagramUrl', 'openingHours.mon', 'whatsappNumber'])
    assert.strictEqual(await prisma.siteSettings.count(), 0)
  })

  test('PUT rejects malformed JSON and non-object bodies', async () => {
    assert.strictEqual((await route.PUT(req('PUT', ownerToken, '{not-json'))).status, 400)
    assert.strictEqual((await route.PUT(req('PUT', ownerToken, [1, 2]))).status, 400)
  })

  test('PUT saves valid values (partial update), GET and the public reader see them', async () => {
    const res = await route.PUT(req('PUT', ownerToken, { whatsappNumber: '+263 77 123 4567', openingHours: HOURS, fewLeftThreshold: 5 }))
    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.settings.whatsappNumber, '+263771234567')
    assert.strictEqual(body.settings.heroHeadline, 'Style Your Way')

    const row = await prisma.siteSettings.findUniqueOrThrow({ where: { id: 1 } })
    assert.strictEqual(row.updatedBy, 'zp486-owner')
    assert.deepStrictEqual(row.openingHours, HOURS)
    assert.strictEqual(row.fewLeftThreshold, 5)

    // A second partial update keeps earlier fields.
    assert.strictEqual((await route.PUT(req('PUT', ownerToken, { heroHeadline: 'New Season' }))).status, 200)
    const after = await (await route.GET(req('GET', ownerToken))).json()
    assert.strictEqual(after.settings.heroHeadline, 'New Season')
    assert.strictEqual(after.settings.whatsappNumber, '+263771234567')
    assert.deepStrictEqual(after.settings.openingHours, HOURS)

    const pub = await loadPublicSiteSettings(prisma)
    assert.strictEqual(pub.contacts.whatsappNumber, '+263771234567')
    assert.strictEqual(pub.home.heroHeadline, 'New Season')
    assert.deepStrictEqual(pub.visit.hours, HOURS)
    assert.strictEqual(pub.fewLeftThreshold, 5)
  })

  test('the database refuses a second row', async () => {
    await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO "SiteSettings" (id, "updatedAt") VALUES (2, now())`))
  })
})
