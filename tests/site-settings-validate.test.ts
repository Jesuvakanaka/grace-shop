// ZP-486: pure validation of the site settings form / PUT body.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  validateSiteSettingsInput,
  normalizeE164,
  isHttpsUrl,
  validateOpeningHours,
} from '../src/lib/site-settings/validate'
import { DAYS, EDITABLE_FIELDS, SITE_SETTINGS_DEFAULTS } from '../src/lib/site-settings/schema'

const HASH = 'a'.repeat(32)
const fullHours = () =>
  Object.fromEntries(DAYS.map((d) => [d, d === 'sun' ? { closed: true } : { closed: false, open: '09:00', close: '17:30' }]))

function errorsOf(input: unknown): Record<string, string> {
  const r = validateSiteSettingsInput(input)
  assert.strictEqual(r.ok, false, `expected errors for ${JSON.stringify(input)}`)
  return (r as { ok: false; errors: Record<string, string> }).errors
}

function valueOf(input: unknown) {
  const r = validateSiteSettingsInput(input)
  assert.ok(r.ok, `expected ok, got ${JSON.stringify(r)}`)
  return r.value
}

describe('site settings: defaults', () => {
  test('match the issue copy', () => {
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.enquiryTemplate, "Hi VYRA, I'm interested in {product} ({url})")
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.generalEnquiryMessage, "Hi VYRA, I'd like to ask about your collection.")
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.heroHeadline, 'Style Your Way')
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.heroSubline, 'Premium fashion. Modern you.')
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.statement, 'Confidence in every stitch')
    assert.deepStrictEqual(
      [SITE_SETTINGS_DEFAULTS.trustLabel1, SITE_SETTINGS_DEFAULTS.trustLabel2, SITE_SETTINGS_DEFAULTS.trustLabel3],
      ['Premium Quality', 'Visit Our Store', 'Enquire on WhatsApp'],
    )
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.fewLeftThreshold, 3)
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.showItemNumber, false)
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.whatsappNumber, null)
  })

  test('the defaults themselves validate', () => {
    assert.deepStrictEqual(valueOf({ ...SITE_SETTINGS_DEFAULTS }), { ...SITE_SETTINGS_DEFAULTS })
  })

  test('editable fields never include id or audit columns', () => {
    for (const f of ['id', 'createdAt', 'updatedAt', 'updatedBy']) assert.ok(!(EDITABLE_FIELDS as string[]).includes(f), f)
  })
})

describe('site settings: E.164', () => {
  test('accepts and normalises', () => {
    assert.strictEqual(normalizeE164('+263771234567'), '+263771234567')
    assert.strictEqual(normalizeE164(' +263 77 123 4567 '), '+263771234567')
    assert.strictEqual(normalizeE164('+263-77-123-4567'), '+263771234567')
    assert.strictEqual(normalizeE164('+1 (415) 555-0100'), '+14155550100')
  })
  test('rejects', () => {
    for (const bad of ['263771234567', '0771234567', '+0771234567', '+26377', '+2637712345678901', '+263 77 abc', '++263771234567', '']) {
      assert.strictEqual(normalizeE164(bad), null, bad)
    }
  })
  test('field: normalised in the value, error otherwise, empty clears', () => {
    assert.strictEqual(valueOf({ whatsappNumber: '+263 77 123 4567' }).whatsappNumber, '+263771234567')
    assert.match(errorsOf({ whatsappNumber: '0771234567' }).whatsappNumber, /\+263/)
    assert.strictEqual(valueOf({ whatsappNumber: '' }).whatsappNumber, null)
    assert.strictEqual(valueOf({ whatsappNumber: null }).whatsappNumber, null)
  })
})

describe('site settings: URLs', () => {
  test('https only, no credentials', () => {
    assert.ok(isHttpsUrl('https://maps.google.com/?q=VYRA'))
    assert.ok(!isHttpsUrl('http://maps.google.com/'))
    assert.ok(!isHttpsUrl('javascript:alert(1)'))
    assert.ok(!isHttpsUrl('https://user:pw@example.com/'))
    assert.ok(!isHttpsUrl('not a url'))
    assert.ok(!isHttpsUrl('//example.com'))
  })
  test('per-domain social URLs', () => {
    assert.strictEqual(valueOf({ instagramUrl: 'https://www.instagram.com/vyra' }).instagramUrl, 'https://www.instagram.com/vyra')
    assert.ok(valueOf({ instagramUrl: 'https://instagram.com/vyra' }))
    assert.ok(valueOf({ facebookUrl: 'https://www.facebook.com/vyra' }))
    assert.ok(valueOf({ facebookUrl: 'https://m.facebook.com/vyra' }))
    assert.ok(valueOf({ tiktokUrl: 'https://www.tiktok.com/@vyra' }))
    assert.match(errorsOf({ instagramUrl: 'https://evil.com/instagram.com' }).instagramUrl, /instagram\.com/)
    assert.match(errorsOf({ instagramUrl: 'https://instagram.com.evil.com/x' }).instagramUrl, /instagram\.com/)
    assert.match(errorsOf({ facebookUrl: 'http://facebook.com/vyra' }).facebookUrl, /https/)
    assert.match(errorsOf({ tiktokUrl: 'https://www.instagram.com/vyra' }).tiktokUrl, /tiktok\.com/)
    assert.strictEqual(valueOf({ tiktokUrl: '' }).tiktokUrl, null)
  })
  test('map URL is any https URL', () => {
    assert.ok(valueOf({ mapUrl: 'https://maps.app.goo.gl/abc' }))
    assert.ok(errorsOf({ mapUrl: 'http://maps.app.goo.gl/abc' }).mapUrl)
  })
})

describe('site settings: opening hours', () => {
  test('a full week with open/close or closed', () => {
    const r = validateOpeningHours(fullHours())
    assert.ok(r.ok)
    assert.deepStrictEqual(r.value.sun, { closed: true })
    assert.deepStrictEqual(r.value.mon, { closed: false, open: '09:00', close: '17:30' })
  })
  test('closed days drop their times', () => {
    const h = fullHours()
    h.sat = { closed: true, open: '09:00', close: '12:00' } as never
    const r = validateOpeningHours(h)
    assert.ok(r.ok)
    assert.deepStrictEqual(r.value.sat, { closed: true })
  })
  test('rejects bad formats, missing days, close before open, unknown days', () => {
    const cases: [unknown, string][] = [
      [{ ...fullHours(), mon: { closed: false, open: '9:00', close: '17:00' } }, 'openingHours.mon'],
      [{ ...fullHours(), mon: { closed: false, open: '24:00', close: '25:00' } }, 'openingHours.mon'],
      [{ ...fullHours(), tue: { closed: false, open: '17:00', close: '09:00' } }, 'openingHours.tue'],
      [{ ...fullHours(), wed: { closed: false, open: '09:00', close: '09:00' } }, 'openingHours.wed'],
      [{ ...fullHours(), thu: { closed: 'no' } }, 'openingHours.thu'],
      [{ ...fullHours(), fri: undefined }, 'openingHours.fri'],
      [{ ...fullHours(), funday: { closed: true } }, 'openingHours'],
      ['Mon-Fri 9-5', 'openingHours'],
      [[], 'openingHours'],
    ]
    for (const [input, key] of cases) {
      const errs = errorsOf({ openingHours: input })
      assert.ok(errs[key], `expected ${key} error for ${JSON.stringify(input)}, got ${JSON.stringify(errs)}`)
    }
  })
  test('null clears the hours', () => {
    assert.strictEqual(valueOf({ openingHours: null }).openingHours, null)
  })
})

describe('site settings: other fields', () => {
  test('unknown fields are rejected, allow-listed fields kept', () => {
    const errs = errorsOf({ heroHeadline: 'Hi', id: 2, updatedBy: 'x', isAdmin: true })
    assert.deepStrictEqual(Object.keys(errs).sort(), ['id', 'isAdmin', 'updatedBy'])
    assert.match(errs.isAdmin, /Unknown field/)
  })
  test('body must be an object', () => {
    for (const bad of [null, [], 'x', 3]) assert.ok(errorsOf(bad)._form)
  })
  test('lengths: story up to 2000, required texts not blank', () => {
    assert.ok(valueOf({ aboutStory: 'x'.repeat(2000) }))
    assert.match(errorsOf({ aboutStory: 'x'.repeat(2001) }).aboutStory, /2000/)
    assert.match(errorsOf({ heroHeadline: '   ' }).heroHeadline, /required/i)
    assert.ok(errorsOf({ heroHeadline: 'x'.repeat(121) }).heroHeadline)
    assert.ok(errorsOf({ trustLabel2: 'x'.repeat(41) }).trustLabel2)
    assert.ok(errorsOf({ seoTitle: '' }).seoTitle)
    assert.ok(errorsOf({ heroHeadline: 42 }).heroHeadline)
  })
  test('text is trimmed; optional blank text becomes null', () => {
    const v = valueOf({ heroHeadline: '  Style Your Way  ', aboutHeadline: '  ', address: '12 Main St\nHarare\n' })
    assert.strictEqual(v.heroHeadline, 'Style Your Way')
    assert.strictEqual(v.aboutHeadline, null)
    assert.strictEqual(v.address, '12 Main St\nHarare')
  })
  test('enquiry template: only known placeholders', () => {
    assert.ok(valueOf({ enquiryTemplate: 'Hi, {product} {url} {colour} {size}' }))
    assert.match(errorsOf({ enquiryTemplate: 'Hi {name}' }).enquiryTemplate, /\{name\}/)
    assert.ok(errorsOf({ enquiryTemplate: 'x'.repeat(501) }).enquiryTemplate)
  })
  test('email and phone', () => {
    assert.strictEqual(valueOf({ email: ' Hello@VYRA.example ' }).email, 'Hello@VYRA.example')
    assert.ok(errorsOf({ email: 'not-an-email' }).email)
    assert.ok(valueOf({ phone: '+263 242 123 456' }))
    assert.ok(errorsOf({ phone: 'call me' }).phone)
    assert.strictEqual(valueOf({ phone: '' }).phone, null)
  })
  test('latitude/longitude: ranges and both-or-neither', () => {
    assert.deepStrictEqual(valueOf({ latitude: -17.8292, longitude: 31.0522 }), { latitude: -17.8292, longitude: 31.0522 })
    assert.deepStrictEqual(valueOf({ latitude: null, longitude: null }), { latitude: null, longitude: null })
    assert.ok(errorsOf({ latitude: 91, longitude: 0 }).latitude)
    assert.ok(errorsOf({ latitude: 0, longitude: -181 }).longitude)
    assert.ok(errorsOf({ latitude: 10 }).longitude)
    assert.ok(errorsOf({ latitude: '10', longitude: 3 }).latitude)
  })
  test('image keys must be stored pictures', () => {
    const key = `products/${HASH}.webp`
    assert.strictEqual(valueOf({ heroImageKeyDesktop: key }).heroImageKeyDesktop, key)
    assert.strictEqual(valueOf({ aboutImageKey: null }).aboutImageKey, null)
    assert.ok(errorsOf({ heroImageKeyMobile: '../etc/passwd' }).heroImageKeyMobile)
    assert.ok(errorsOf({ seoShareImageKey: `/api/images/${HASH}.webp` }).seoShareImageKey)
  })
  test('few-left threshold 1..50, integer', () => {
    assert.strictEqual(valueOf({ fewLeftThreshold: 1 }).fewLeftThreshold, 1)
    assert.strictEqual(valueOf({ fewLeftThreshold: 50 }).fewLeftThreshold, 50)
    for (const bad of [0, 51, 2.5, '3', null]) assert.ok(errorsOf({ fewLeftThreshold: bad }).fewLeftThreshold, String(bad))
  })
  test('showItemNumber must be boolean', () => {
    assert.strictEqual(valueOf({ showItemNumber: true }).showItemNumber, true)
    assert.ok(errorsOf({ showItemNumber: 'yes' }).showItemNumber)
  })
  test('collects every error at once', () => {
    const errs = errorsOf({ whatsappNumber: 'x', fewLeftThreshold: 0, instagramUrl: 'http://x' })
    assert.deepStrictEqual(Object.keys(errs).sort(), ['fewLeftThreshold', 'instagramUrl', 'whatsappNumber'])
  })
})
