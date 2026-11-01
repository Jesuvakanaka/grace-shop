// ZP-486: WhatsApp link builder, public DTO and revalidation tags (pure).
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { buildWhatsAppLink } from '../src/lib/site-settings/whatsapp'
import { toPublicSiteSettings, publicSettingsImageUrl } from '../src/lib/site-settings/dto'
import { SITE_SETTINGS_DEFAULTS } from '../src/lib/site-settings/schema'
import { revalidateSiteSettings, SITE_SETTINGS_REVALIDATE_TAGS } from '../src/lib/site-settings/revalidate'

const HASH = 'b'.repeat(32)

const contacts = (whatsappNumber: string | null, over: Partial<typeof SITE_SETTINGS_DEFAULTS> = {}) => ({
  contacts: {
    whatsappNumber,
    enquiryTemplate: over.enquiryTemplate ?? SITE_SETTINGS_DEFAULTS.enquiryTemplate,
    generalEnquiryMessage: over.generalEnquiryMessage ?? SITE_SETTINGS_DEFAULTS.generalEnquiryMessage,
  },
})

function textOf(link: string | null): string {
  assert.ok(link)
  const u = new URL(link)
  return u.searchParams.get('text') ?? ''
}

describe('buildWhatsAppLink', () => {
  test('missing or unusable number -> null', () => {
    assert.strictEqual(buildWhatsAppLink(contacts(null), { product: 'Dress' }), null)
    assert.strictEqual(buildWhatsAppLink(contacts(''), {}), null)
    assert.strictEqual(buildWhatsAppLink(contacts('+12')), null)
  })

  test('general enquiry without a product; digits only in the path', () => {
    const link = buildWhatsAppLink(contacts('+263 77 123 4567'))
    assert.ok(link)
    assert.ok(link.startsWith('https://wa.me/263771234567?text='), link)
    assert.strictEqual(textOf(link), "Hi VYRA, I'd like to ask about your collection.")
  })

  test('product enquiry fills {product} and {url}; spaces are %20, & is encoded', () => {
    const link = buildWhatsAppLink(contacts('+263771234567'), {
      product: 'Silk & Satin Dress',
      url: 'https://vyra.example/p/silk-satin?ref=wa&x=1',
    })
    assert.ok(link)
    const query = link.split('?text=')[1]
    assert.ok(!/[ &]/.test(query), `raw space or & in ${query}`)
    assert.match(query, /Silk%20%26%20Satin%20Dress/)
    assert.strictEqual(textOf(link), "Hi VYRA, I'm interested in Silk & Satin Dress (https://vyra.example/p/silk-satin?ref=wa&x=1)")
  })

  test('emoji survive the round trip', () => {
    const link = buildWhatsAppLink(contacts('+263771234567'), { product: 'Sunset Dress 🌅✨' })
    assert.match(link!, /%F0%9F%8C%85/)
    assert.match(textOf(link), /Sunset Dress 🌅✨/)
  })

  test('product without url: the empty "()" is removed', () => {
    assert.strictEqual(textOf(buildWhatsAppLink(contacts('+263771234567'), { product: 'Blazer' })), "Hi VYRA, I'm interested in Blazer")
  })

  test('colour and size: substituted when the template has them, appended otherwise', () => {
    const appended = textOf(buildWhatsAppLink(contacts('+263771234567'), { product: 'Blazer', colour: 'Black', size: 'M' }))
    assert.strictEqual(appended, "Hi VYRA, I'm interested in Blazer\nColour: Black\nSize: M")
    const inline = textOf(
      buildWhatsAppLink(contacts('+263771234567', { enquiryTemplate: '{product} in {colour}, size {size}: {url}' }), {
        product: 'Blazer',
        colour: 'Black',
        size: 'M',
        url: 'https://vyra.example/p/blazer',
      }),
    )
    assert.strictEqual(inline, 'Blazer in Black, size M: https://vyra.example/p/blazer')
  })

  test('only the "()" left by a missing {url} is removed, not other parentheses (review fix 4)', () => {
    const c = contacts('+263771234567', { enquiryTemplate: 'Hi () about {product} ({url}) thanks' })
    assert.strictEqual(textOf(buildWhatsAppLink(c, { product: 'Tee (Kids) ()' })), 'Hi () about Tee (Kids) () thanks')
    assert.strictEqual(
      textOf(buildWhatsAppLink(c, { product: 'Tee ()', url: 'https://vyra.example/p/t' })),
      'Hi () about Tee () (https://vyra.example/p/t) thanks',
    )
    // Default template, product name ending in "()": kept.
    assert.strictEqual(textOf(buildWhatsAppLink(contacts('+263771234567'), { product: 'Mystery box ()' })), "Hi VYRA, I'm interested in Mystery box ()")
    // A bare {url} with no url just disappears.
    const bare = contacts('+263771234567', { enquiryTemplate: '{product} - {url}' })
    assert.strictEqual(textOf(buildWhatsAppLink(bare, { product: 'Blazer' })), 'Blazer -')
  })

  test('placeholder-looking text in a product name is not re-expanded', () => {
    const t = textOf(buildWhatsAppLink(contacts('+263771234567'), { product: 'Tee {url}', url: 'https://vyra.example/p/t' }))
    assert.strictEqual(t, "Hi VYRA, I'm interested in Tee {url} (https://vyra.example/p/t)")
  })
})

describe('public DTO', () => {
  test('allow-listed shape from the defaults', () => {
    const dto = toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS })
    assert.deepStrictEqual(Object.keys(dto).sort(), ['about', 'contacts', 'fewLeftThreshold', 'home', 'reviews', 'seo', 'showItemNumber', 'social', 'visit'])
    assert.deepStrictEqual(dto.home.trustLabels, ['Premium Quality', 'Visit Our Store', 'Enquire on WhatsApp'])
    assert.strictEqual(dto.home.heroHeadline, 'Style Your Way')
    assert.strictEqual(dto.home.heroImageUrls.desktop, null)
    assert.strictEqual(dto.visit.hours, null)
    assert.strictEqual(dto.fewLeftThreshold, 3)
    assert.strictEqual(dto.showItemNumber, false)
  })

  test('never leaks audit columns or raw keys', () => {
    const row = {
      ...SITE_SETTINGS_DEFAULTS,
      id: 1,
      updatedBy: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
      heroImageKeyDesktop: `products/${HASH}.webp`,
    } as typeof SITE_SETTINGS_DEFAULTS
    const json = JSON.stringify(toPublicSiteSettings(row))
    assert.doesNotMatch(json, /updatedBy|owner|createdAt|products\//)
    assert.match(json, new RegExp(`/api/images/public/${HASH}\\.webp`))
  })

  test('image keys become /api/images/public/<hash>.webp; bad keys become null', () => {
    assert.strictEqual(publicSettingsImageUrl(`products/${HASH}.webp`), `/api/images/public/${HASH}.webp`)
    assert.strictEqual(publicSettingsImageUrl(null), null)
    assert.strictEqual(publicSettingsImageUrl('../x'), null)
  })

  test('the DTO works with buildWhatsAppLink', () => {
    const dto = toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS, whatsappNumber: '+263771234567' })
    assert.ok(buildWhatsAppLink(dto)!.startsWith('https://wa.me/263771234567?text='))
  })
})

describe('changedSettings (admin form sends only changed fields)', () => {
  test('returns only the fields that differ; latitude/longitude travel together', async () => {
    const { changedSettings } = await import('../src/lib/site-settings/diff')
    const base = { ...SITE_SETTINGS_DEFAULTS } as Record<string, unknown>
    assert.deepStrictEqual(changedSettings(base, base), {})
    assert.deepStrictEqual(changedSettings({ ...base, heroHeadline: 'New' }, base), { heroHeadline: 'New' })
    assert.deepStrictEqual(changedSettings({ ...base, latitude: 1 }, base), { latitude: 1, longitude: null })
    const hours = { mon: { closed: true } }
    assert.deepStrictEqual(changedSettings({ ...base, openingHours: hours }, base), { openingHours: hours })
    assert.deepStrictEqual(changedSettings({ ...base, openingHours: { mon: { closed: true } } }, { ...base, openingHours: hours }), {})
  })
})

describe('public cache options (review fix 1)', () => {
  test('tagged storefront:settings with a 60s time-based backstop (multi-instance Cloud Run)', async () => {
    const { PUBLIC_SETTINGS_CACHE_OPTIONS, PUBLIC_SETTINGS_REVALIDATE_SECONDS } = await import('../src/lib/site-settings/public')
    assert.strictEqual(PUBLIC_SETTINGS_REVALIDATE_SECONDS, 60)
    // Also "storefront", so revalidateStorefront() (no scope) clears it with everything else.
    assert.deepStrictEqual(PUBLIC_SETTINGS_CACHE_OPTIONS, { tags: ['storefront', 'storefront:settings'], revalidate: 60 })
  })
})

describe('revalidateSiteSettings', () => {
  test('revalidates storefront:settings and storefront:home, expiring immediately', () => {
    const calls: unknown[][] = []
    const r = revalidateSiteSettings({ settings: true }, (...args: unknown[]) => void calls.push(args))
    assert.deepStrictEqual(r, { ok: true, tags: ['storefront:settings', 'storefront:home'] })
    assert.deepStrictEqual([...SITE_SETTINGS_REVALIDATE_TAGS], ['storefront:settings', 'storefront:home'])
    assert.deepStrictEqual(calls, [
      ['storefront:settings', { expire: 0 }],
      ['storefront:home', { expire: 0 }],
    ])
  })

  test('outside a Next request the "store missing" error is ignored', () => {
    const r = revalidateSiteSettings({ settings: true }, () => {
      throw new Error('Invariant: static generation store missing in revalidateTag("storefront:settings")')
    })
    assert.strictEqual(r.ok, true)
  })

  test('any other failure is reported, not thrown (the save already happened)', () => {
    const originalError = console.error
    console.error = () => {}
    try {
      const r = revalidateSiteSettings({ settings: true }, () => {
        throw new Error('boom')
      })
      assert.strictEqual(r.ok, false)
    } finally {
      console.error = originalError
    }
  })
})
