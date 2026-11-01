/**
 * ZP-490: storefront product page, pure parts.
 * - WhatsApp enquiry link (encoding round trip, chip variants, labels)
 *   src/lib/storefront/product-enquiry.ts
 * - "You may also like" selection: src/lib/storefront/related.ts
 * - Route decision (published / old slug / unpublished / unknown / preview),
 *   preview-request detection for the proxy, absolute product URL:
 *   src/lib/storefront/product-route.ts
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = 'zp490-product-page-tests-secret-0123456789abcdef'

import { signPreviewToken, verifyPreviewTokenFor } from '../src/lib/website/preview-token'
import {
  enquiryLabel,
  productEnquiryHref,
  splitOptions,
  telHref,
  toggleOption,
} from '../src/lib/storefront/product-enquiry'
import { pickRelated, RELATED_LIMIT } from '../src/lib/storefront/related'
import {
  decideProductRoute,
  isProductPreviewRequest,
  PREVIEW_RESPONSE_HEADERS,
  previewTokenFrom,
  productAbsoluteUrl,
  type ProductRouteDeps,
} from '../src/lib/storefront/product-route'
import type { PublicProduct } from '../src/lib/storefront/dto'

const DEFAULT_TEMPLATE = "Hi VYRA, I'm interested in {product} ({url})"

function settings(contacts: Partial<{ whatsappNumber: string | null; enquiryTemplate: string; generalEnquiryMessage: string }> = {}) {
  return {
    contacts: {
      whatsappNumber: '+263 77 123 4567',
      enquiryTemplate: DEFAULT_TEMPLATE,
      generalEnquiryMessage: "Hi VYRA, I'd like to ask about your collection.",
      ...contacts,
    },
  }
}

/** The text WhatsApp will show, decoded from the link. */
function messageOf(href: string | null): string {
  assert.ok(href, 'expected a link')
  const url = new URL(href)
  assert.strictEqual(url.origin, 'https://wa.me')
  // The raw query is one parameter: nothing in the message escaped encoding.
  assert.match(url.search, /^\?text=[^&#?\s]*$/)
  return decodeURIComponent(url.search.slice('?text='.length))
}

function product(slug: string, over: Partial<PublicProduct> = {}): PublicProduct {
  return {
    slug,
    name: slug,
    description: null,
    category: { slug: 'dresses', name: 'Dresses' },
    colours: null,
    sizes: null,
    availability: 'IN_STOCK',
    images: [],
    isNew: false,
    featured: false,
    priceUsd: null,
    ...over,
  }
}

const URL_ = 'https://vyra.example/p/lime-wrap-dress'

describe('WhatsApp enquiry link', () => {
  test('round trip: spaces, &, #, ?, newlines and emoji decode to the intended text', () => {
    const name = 'Tee & Co #1? "Sunny" 🌞\nsecond line 100% + more'
    const href = productEnquiryHref(settings(), { name, url: URL_ })
    assert.strictEqual(messageOf(href), `Hi VYRA, I'm interested in ${name} (${URL_})`)
    // URLSearchParams agrees (it would turn a raw "+" into a space).
    assert.strictEqual(new URL(href!).searchParams.get('text'), `Hi VYRA, I'm interested in ${name} (${URL_})`)
  })

  test('url with its own query and hash stays inside the message', () => {
    const url = 'https://vyra.example/p/a-b?x=1&y=2#top'
    const href = productEnquiryHref(settings(), { name: 'Dress', url })
    assert.strictEqual(messageOf(href), `Hi VYRA, I'm interested in Dress (${url})`)
  })

  test('number is reduced to digits', () => {
    assert.ok(productEnquiryHref(settings(), { name: 'Dress', url: URL_ })!.startsWith('https://wa.me/263771234567?text='))
  })

  test('no colour or size picked: template only', () => {
    assert.strictEqual(
      messageOf(productEnquiryHref(settings(), { name: 'Lime wrap dress', url: URL_ })),
      `Hi VYRA, I'm interested in Lime wrap dress (${URL_})`,
    )
  })

  test('colour picked: appended on its own line', () => {
    assert.strictEqual(
      messageOf(productEnquiryHref(settings(), { name: 'Lime wrap dress', url: URL_, colour: 'Lime' })),
      `Hi VYRA, I'm interested in Lime wrap dress (${URL_})\nColour: Lime`,
    )
  })

  test('size picked: appended on its own line', () => {
    assert.strictEqual(
      messageOf(productEnquiryHref(settings(), { name: 'Lime wrap dress', url: URL_, size: 'M' })),
      `Hi VYRA, I'm interested in Lime wrap dress (${URL_})\nSize: M`,
    )
  })

  test('colour and size picked: both lines, colour first', () => {
    assert.strictEqual(
      messageOf(productEnquiryHref(settings(), { name: 'Lime wrap dress', url: URL_, colour: 'Black & white', size: 'UK 10' })),
      `Hi VYRA, I'm interested in Lime wrap dress (${URL_})\nColour: Black & white\nSize: UK 10`,
    )
  })

  test('a template that names {colour} and {size} gets them filled in place', () => {
    const s = settings({ enquiryTemplate: 'Hello! {product} in {colour}, size {size}: {url}' })
    assert.strictEqual(
      messageOf(productEnquiryHref(s, { name: 'Dress', url: URL_, colour: 'Olive', size: 'S' })),
      `Hello! Dress in Olive, size S: ${URL_}`,
    )
  })

  test('no absolute url: the "({url})" wrapper is dropped', () => {
    assert.strictEqual(messageOf(productEnquiryHref(settings(), { name: 'Dress', url: null })), "Hi VYRA, I'm interested in Dress")
  })

  test('no number configured: null (hide the button)', () => {
    assert.strictEqual(productEnquiryHref(settings({ whatsappNumber: null }), { name: 'Dress', url: URL_ }), null)
    assert.strictEqual(productEnquiryHref(settings({ whatsappNumber: '12' }), { name: 'Dress', url: URL_ }), null)
  })

  test('label: sold out asks about restock', () => {
    assert.strictEqual(enquiryLabel('IN_STOCK'), 'Enquire on WhatsApp')
    assert.strictEqual(enquiryLabel('FEW_LEFT'), 'Enquire on WhatsApp')
    assert.strictEqual(enquiryLabel('SOLD_OUT'), 'Ask about restock')
  })

  test('sold out message still names the chosen size', () => {
    assert.strictEqual(
      messageOf(productEnquiryHref(settings(), { name: 'Dress', url: URL_, size: 'L' })),
      `Hi VYRA, I'm interested in Dress (${URL_})\nSize: L`,
    )
  })
})

describe('Call us link', () => {
  test('tel: with digits and a leading +', () => {
    assert.strictEqual(telHref('+263 (77) 123-4567'), 'tel:+263771234567')
    assert.strictEqual(telHref('077 123 4567'), 'tel:0771234567')
  })
  test('no phone, or too few digits: null (hide the link)', () => {
    assert.strictEqual(telHref(null), null)
    assert.strictEqual(telHref('  '), null)
    assert.strictEqual(telHref('call us'), null)
    assert.strictEqual(telHref('12'), null)
  })
})

describe('colour and size chips', () => {
  test('splitOptions: commas, semicolons, pipes and new lines; trimmed; no duplicates', () => {
    assert.deepStrictEqual(splitOptions('Black, Lime ;Olive|cream\nBlack'), ['Black', 'Lime', 'Olive', 'cream'])
    assert.deepStrictEqual(splitOptions('S/M, L/XL'), ['S/M', 'L/XL'])
    assert.deepStrictEqual(splitOptions('  '), [])
    assert.deepStrictEqual(splitOptions(null), [])
    assert.deepStrictEqual(splitOptions('One size'), ['One size'])
  })

  test('splitOptions treats case-only repeats as one option', () => {
    assert.deepStrictEqual(splitOptions('Lime, lime, LIME'), ['Lime'])
  })

  test('toggleOption: single select, click again to clear', () => {
    assert.strictEqual(toggleOption(null, 'M'), 'M')
    assert.strictEqual(toggleOption('M', 'L'), 'L')
    assert.strictEqual(toggleOption('L', 'L'), null)
  })
})

describe('related products ("You may also like")', () => {
  const current = product('current')

  test('same category only, never the product itself, at most 4', () => {
    const list = [
      product('current'),
      product('a'),
      product('other-cat', { category: { slug: 'tops', name: 'Tops' } }),
      product('b'),
      product('c'),
      product('d'),
      product('e'),
    ]
    assert.strictEqual(RELATED_LIMIT, 4)
    assert.deepStrictEqual(pickRelated(list, current).map((p) => p.slug), ['a', 'b', 'c', 'd'])
  })

  test('sold-out products are left out when enough others exist', () => {
    const list = [
      product('s1', { availability: 'SOLD_OUT' }),
      product('a'),
      product('b', { availability: 'FEW_LEFT' }),
      product('c'),
      product('d'),
    ]
    assert.deepStrictEqual(pickRelated(list, current).map((p) => p.slug), ['a', 'b', 'c', 'd'])
  })

  test('sold-out products fill the remaining places, last', () => {
    const list = [product('s1', { availability: 'SOLD_OUT' }), product('a'), product('s2', { availability: 'SOLD_OUT' }), product('b')]
    assert.deepStrictEqual(pickRelated(list, current).map((p) => p.slug), ['a', 'b', 's1', 's2'])
  })

  test('keeps the input order within each group and honours a smaller limit', () => {
    const list = [product('c'), product('a'), product('b')]
    assert.deepStrictEqual(pickRelated(list, current, 2).map((p) => p.slug), ['c', 'a'])
  })

  test('nothing in the category: empty (the page hides the block)', () => {
    assert.deepStrictEqual(pickRelated([product('x', { category: { slug: 'tops', name: 'Tops' } })], current), [])
    assert.deepStrictEqual(pickRelated([], current), [])
  })

  test('duplicate slugs in the input appear once', () => {
    assert.deepStrictEqual(pickRelated([product('a'), product('a')], current).map((p) => p.slug), ['a'])
  })
})

describe('route decision', () => {
  const T0 = new Date('2026-11-01T10:00:00Z')
  const live = product('lime-wrap-dress')
  const draft = product('olive-draft')
  const DRAFT_ID = 41
  const OTHER_ID = 42

  /** Records which lookups ran, so we can check unknown input stays cheap. */
  function deps(now = new Date(T0.getTime() + 60_000)): ProductRouteDeps & { calls: string[] } {
    const calls: string[] = []
    return {
      calls,
      async lookupPublished(slug) {
        calls.push(`published:${slug}`)
        if (slug === live.slug) return { product: live }
        if (slug === 'old-lime-dress') return { redirectTo: live.slug }
        return null
      },
      async loadPreviewCandidate(slug) {
        calls.push(`candidate:${slug}`)
        return slug === draft.slug ? { productId: DRAFT_ID, product: draft } : null
      },
      verifyPreviewTokenFor: (token, productId) => verifyPreviewTokenFor(token, productId, { now }),
    }
  }

  test('published product renders', async () => {
    assert.deepStrictEqual(await decideProductRoute({ slug: live.slug, previewToken: null }, deps()), {
      kind: 'product',
      product: live,
    })
  })

  test('old slug redirects permanently to the current slug', async () => {
    assert.deepStrictEqual(await decideProductRoute({ slug: 'old-lime-dress', previewToken: null }, deps()), {
      kind: 'redirect',
      slug: live.slug,
    })
  })

  test('unpublished product without a token: 404, no draft lookup', async () => {
    const d = deps()
    assert.deepStrictEqual(await decideProductRoute({ slug: draft.slug, previewToken: null }, d), { kind: 'not-found' })
    assert.deepStrictEqual(d.calls, [`published:${draft.slug}`])
  })

  test('unknown slug: 404', async () => {
    const { token } = await signPreviewToken(DRAFT_ID, { now: T0 })
    assert.deepStrictEqual(await decideProductRoute({ slug: 'no-such-thing', previewToken: null }, deps()), { kind: 'not-found' })
    assert.deepStrictEqual(await decideProductRoute({ slug: 'no-such-thing', previewToken: token }, deps()), { kind: 'not-found' })
  })

  test('invalid slug: 404 without touching any lookup', async () => {
    const d = deps()
    assert.deepStrictEqual(await decideProductRoute({ slug: '../../etc', previewToken: 'x' }, d), { kind: 'not-found' })
    assert.deepStrictEqual(d.calls, [])
  })

  test('valid preview token for this product: preview', async () => {
    const { token } = await signPreviewToken(DRAFT_ID, { now: T0 })
    assert.deepStrictEqual(await decideProductRoute({ slug: draft.slug, previewToken: token }, deps()), {
      kind: 'preview',
      product: draft,
    })
  })

  test('token issued for another product: 404', async () => {
    const { token } = await signPreviewToken(OTHER_ID, { now: T0 })
    assert.deepStrictEqual(await decideProductRoute({ slug: draft.slug, previewToken: token }, deps()), { kind: 'not-found' })
  })

  test('expired token: 404', async () => {
    const { token } = await signPreviewToken(DRAFT_ID, { now: T0 })
    const later = new Date(T0.getTime() + 31 * 60_000)
    assert.deepStrictEqual(await decideProductRoute({ slug: draft.slug, previewToken: token }, deps(later)), { kind: 'not-found' })
  })

  test('garbage token: 404', async () => {
    assert.deepStrictEqual(await decideProductRoute({ slug: draft.slug, previewToken: 'not-a-jwt' }, deps()), { kind: 'not-found' })
  })

  test('a published product ignores a preview token (public page, no banner)', async () => {
    const { token } = await signPreviewToken(DRAFT_ID, { now: T0 })
    assert.deepStrictEqual(await decideProductRoute({ slug: live.slug, previewToken: token }, deps()), {
      kind: 'product',
      product: live,
    })
  })

  test('previewTokenFrom: one non-empty value only', () => {
    assert.strictEqual(previewTokenFrom(undefined), null)
    assert.strictEqual(previewTokenFrom(''), null)
    assert.strictEqual(previewTokenFrom(['a', 'b']), null)
    assert.strictEqual(previewTokenFrom('abc'), 'abc')
    assert.strictEqual(previewTokenFrom('x'.repeat(5000)), null)
  })
})

describe('preview responses (proxy headers)', () => {
  test('detects a product URL with a preview parameter on both hosts', () => {
    const q = (s: string) => new URLSearchParams(s)
    assert.strictEqual(isProductPreviewRequest('/site/p/olive-draft', q('preview=abc')), true)
    assert.strictEqual(isProductPreviewRequest('/p/olive-draft', q('preview=abc')), true)
    assert.strictEqual(isProductPreviewRequest('/site/p/olive-draft', q('preview=')), true)
    assert.strictEqual(isProductPreviewRequest('/site/p/olive-draft', q('')), false)
    assert.strictEqual(isProductPreviewRequest('/site/shop', q('preview=abc')), false)
    assert.strictEqual(isProductPreviewRequest('/site/p/a/b', q('preview=abc')), false)
    assert.strictEqual(isProductPreviewRequest('/products/1', q('preview=abc')), false)
  })

  test('headers: no referrer, private no-store', () => {
    assert.deepStrictEqual(PREVIEW_RESPONSE_HEADERS, {
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, no-store',
    })
  })
})

describe('preview pictures', () => {
  test('point at the signed-in image route, without width variants', async () => {
    const { withPreviewImages } = await import('../src/lib/storefront/preview')
    const hex = 'a'.repeat(32)
    const p = withPreviewImages(
      product('draft', {
        images: [
          { url: `/api/images/public/${hex}.webp`, srcSet: `/api/images/public/${hex}.webp?w=320 320w`, alt: 'Front', width: null, height: null },
        ],
      }),
    )
    assert.deepStrictEqual(p.images, [{ url: `/api/images/${hex}.webp`, srcSet: '', alt: 'Front', width: null, height: null }])
  })
})

describe('absolute product URL for the enquiry message', () => {
  test('configured storefront host wins: clean https URL', () => {
    assert.strictEqual(
      productAbsoluteUrl({ slug: 'lime-wrap-dress', storefrontHosts: ['vyra.example'], host: 'grace-uat.a.run.app' }),
      'https://vyra.example/p/lime-wrap-dress',
    )
  })

  test('no storefront host: the request host with /site', () => {
    assert.strictEqual(
      productAbsoluteUrl({ slug: 'lime-wrap-dress', storefrontHosts: [], host: 'grace-uat.a.run.app' }),
      'https://grace-uat.a.run.app/site/p/lime-wrap-dress',
    )
  })

  test('local hosts use http and keep the port', () => {
    assert.strictEqual(
      productAbsoluteUrl({ slug: 'a', storefrontHosts: [], host: 'localhost:3490' }),
      'http://localhost:3490/site/p/a',
    )
    assert.strictEqual(productAbsoluteUrl({ slug: 'a', storefrontHosts: [], host: '127.0.0.1:3490' }), 'http://127.0.0.1:3490/site/p/a')
  })

  test('a malformed Host header gives no URL (the message drops it)', () => {
    for (const host of ['evil.example/path', 'a b', 'x@y', '', null, 'exa mple.com', 'host:99999999']) {
      assert.strictEqual(productAbsoluteUrl({ slug: 'a', storefrontHosts: [], host }), null, String(host))
    }
  })

  test('the slug is encoded and an invalid slug gives no URL', () => {
    assert.strictEqual(productAbsoluteUrl({ slug: '../x', storefrontHosts: ['vyra.example'], host: null }), null)
  })
})
