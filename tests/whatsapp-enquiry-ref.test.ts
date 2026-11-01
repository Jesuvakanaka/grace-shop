/**
 * ZP-504 (owner decision 2026-11-01): every product enquiry on WhatsApp ends
 * with a short public reference "(ref V-0099)" = "V-" + the product id
 * zero-padded to 4 digits, never the private item number. General enquiries
 * carry no ref. The owner's template may place it with {ref}; otherwise it is
 * appended.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { buildWhatsAppLink } from '../src/lib/site-settings/whatsapp'
import { SITE_SETTINGS_DEFAULTS, TEMPLATE_PLACEHOLDERS } from '../src/lib/site-settings/schema'
import { validateSiteSettingsInput } from '../src/lib/site-settings/validate'
import { publicProductRef } from '../src/lib/storefront/product-ref'
import { productEnquiryHref } from '../src/lib/storefront/product-enquiry'
import { RESTOCK_TEMPLATE, toFeedItem } from '../src/lib/storefront/feed'
import { toPublicProduct, type PublicProduct, type PublicProductRow } from '../src/lib/storefront/dto'

const contacts = (enquiryTemplate: string = SITE_SETTINGS_DEFAULTS.enquiryTemplate) => ({
  contacts: {
    whatsappNumber: '+263771234567',
    enquiryTemplate,
    generalEnquiryMessage: SITE_SETTINGS_DEFAULTS.generalEnquiryMessage,
  },
})

function textOf(link: string | null): string {
  assert.ok(link)
  return new URL(link).searchParams.get('text') ?? ''
}

const URL_ = 'https://vyra.example/p/silk'

describe('publicProductRef', () => {
  test('"V-" + id zero-padded to 4 digits', () => {
    assert.strictEqual(publicProductRef(99), 'V-0099')
    assert.strictEqual(publicProductRef(1), 'V-0001')
    assert.strictEqual(publicProductRef(1234), 'V-1234')
    assert.strictEqual(publicProductRef(12345), 'V-12345')
  })
  test('rejects anything but a positive integer id', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => publicProductRef(bad), /product id/i, String(bad))
    }
  })
})

describe('buildWhatsAppLink with a ref', () => {
  test('default template: the message ends with " (ref V-0099)"', () => {
    assert.strictEqual(
      textOf(buildWhatsAppLink(contacts(), { product: 'Silk Dress', url: URL_, ref: 'V-0099' })),
      `Hi VYRA, I'm interested in Silk Dress (${URL_}) (ref V-0099)`,
    )
  })
  test('appended colour/size lines come first; the ref is the last line', () => {
    assert.strictEqual(
      textOf(buildWhatsAppLink(contacts(), { product: 'Silk Dress', url: URL_, colour: 'Lime', size: 'M', ref: 'V-0099' })),
      `Hi VYRA, I'm interested in Silk Dress (${URL_})\nColour: Lime\nSize: M\n(ref V-0099)`,
    )
  })
  test('a custom template with {ref} places it there and nothing is appended', () => {
    assert.strictEqual(
      textOf(buildWhatsAppLink(contacts('Ref {ref}: {product}'), { product: 'Silk Dress', ref: 'V-0099' })),
      'Ref V-0099: Silk Dress',
    )
  })
  test('a custom template without {ref} still gets it appended', () => {
    assert.strictEqual(
      textOf(buildWhatsAppLink(contacts('Hello, {product} please'), { product: 'Silk Dress', ref: 'V-0042' })),
      'Hello, Silk Dress please (ref V-0042)',
    )
  })
  test('{ref} in a template but no ref given: "(ref {ref})" / "({ref})" wrappers and bare {ref} disappear', () => {
    assert.strictEqual(textOf(buildWhatsAppLink(contacts('{product} (ref {ref})'), { product: 'Dress' })), 'Dress')
    assert.strictEqual(textOf(buildWhatsAppLink(contacts('{product} ({ref}) ok'), { product: 'Dress' })), 'Dress ok')
    assert.strictEqual(textOf(buildWhatsAppLink(contacts('{product} {ref}'), { product: 'Dress' })), 'Dress')
  })
  test('without a ref nothing changes (existing behaviour)', () => {
    assert.strictEqual(
      textOf(buildWhatsAppLink(contacts(), { product: 'Silk Dress', url: URL_ })),
      `Hi VYRA, I'm interested in Silk Dress (${URL_})`,
    )
  })
  test('general (non-product) enquiries never carry a ref', () => {
    assert.strictEqual(textOf(buildWhatsAppLink(contacts(), { ref: 'V-0099' })), SITE_SETTINGS_DEFAULTS.generalEnquiryMessage)
  })
  test('"{ref}" inside a product name is not expanded', () => {
    assert.strictEqual(
      textOf(buildWhatsAppLink(contacts('{product} [{ref}]'), { product: 'Tee {ref}', ref: 'V-0007' })),
      'Tee {ref} [V-0007]',
    )
  })
})

describe('product page and feed enquiries carry the ref', () => {
  test('productEnquiryHref passes the ref through', () => {
    assert.strictEqual(
      textOf(productEnquiryHref(contacts(), { name: 'Silk Dress', url: URL_, size: 'M', ref: 'V-0099' })),
      `Hi VYRA, I'm interested in Silk Dress (${URL_})\nSize: M\n(ref V-0099)`,
    )
  })

  const product = (over: Partial<PublicProduct> = {}): PublicProduct => ({
    slug: 'silk',
    name: 'Silk Dress',
    description: null,
    category: { slug: 'dresses', name: 'Dresses' },
    colours: null,
    sizes: null,
    availability: 'IN_STOCK',
    images: [],
    isNew: false,
    featured: false,
    priceUsd: 65,
    ref: 'V-0099',
    ...over,
  })
  const ctx = { base: '' as const, contacts: contacts().contacts, productUrl: (slug: string) => `https://vyra.example/p/${slug}` }

  test('feed Enquire ends with the ref', () => {
    assert.strictEqual(textOf(toFeedItem(product(), ctx).enquireHref), `Hi VYRA, I'm interested in Silk Dress (${URL_}) (ref V-0099)`)
  })
  test('feed restock message ends with the ref', () => {
    assert.strictEqual(
      textOf(toFeedItem(product({ availability: 'SOLD_OUT' }), ctx).enquireHref),
      `${RESTOCK_TEMPLATE.replace('{product}', 'Silk Dress').replace('{url}', URL_)} (ref V-0099)`,
    )
  })
})

describe('public product DTO ref', () => {
  const row = (id: number): PublicProductRow => ({
    id,
    itemNumber: 'GRC-SECRET-7',
    productName: 'Silk Dress',
    publicName: null,
    slug: 'silk',
    publicDescription: null,
    colours: null,
    sizes: null,
    featured: false,
    sortOrder: 0,
    published: true,
    publishedAt: new Date('2026-10-01T00:00:00Z'),
    priceDisplay: 'SHOW_PRICE',
    sellingPriceUsd: 65,
    currentQuantity: 3,
    category: { slug: 'dresses', name: 'Dresses', published: true },
    images: [],
  })
  test('derived from the id; the item number never appears', () => {
    const dto = toPublicProduct(row(99), { now: new Date('2026-11-01T00:00:00Z') })
    assert.strictEqual(dto.ref, 'V-0099')
    assert.ok(!JSON.stringify(dto).includes('GRC-SECRET'))
    assert.ok(!('id' in dto))
  })
})

describe('settings validator', () => {
  test('{ref} is an allowed enquiry template placeholder', () => {
    assert.ok((TEMPLATE_PLACEHOLDERS as readonly string[]).includes('ref'))
    const r = validateSiteSettingsInput({ enquiryTemplate: 'Hi, {product} (ref {ref})' })
    assert.strictEqual(r.ok, true)
  })
})
