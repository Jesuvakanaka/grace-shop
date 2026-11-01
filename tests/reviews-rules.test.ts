// ZP-508: customer reviews, pure rules. Validation of the public form,
// display-name derivation, the review token, aggregates and their wording,
// the public review DTO allow-list, the same-origin check and the WhatsApp
// invite link. No database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN,
  containsProfanity,
  deriveDisplayName,
  firstNameOf,
  normaliseComment,
  parseModerationAction,
  validateCustomerHint,
  validateReviewSubmission,
} from '../src/lib/reviews/rules'
import {
  REVIEW_TOKEN_BYTES,
  generateReviewToken,
  hashReviewToken,
  isWellFormedReviewToken,
  sameTokenHash,
} from '../src/lib/reviews/token'
import {
  feedRatingText,
  ratingLabel,
  ratingSummaryText,
  relativeDate,
  shopRatingLine,
  shopRatingStars,
  sortReviewsForDisplay,
  starsText,
  summarizeStars,
} from '../src/lib/reviews/aggregate'
import { isSameOriginRequest } from '../src/lib/reviews/same-origin'
import { jsonLdScript, productReviewsJsonLd } from '../src/lib/reviews/structured-data'
import { reviewAbsoluteUrl, reviewInviteMessage, reviewWhatsAppHref } from '../src/lib/reviews/links'
import { toPublicReview, type PublicReviewRow } from '../src/lib/storefront/dto'
import { buildReviewsIndex } from '../src/lib/storefront/reviews'
import { toFeedItem } from '../src/lib/storefront/feed'
import type { PublicProduct } from '../src/lib/storefront/dto'
import { buildMenuModel } from '../src/lib/storefront/menu-model'
import { toPublicSiteSettings } from '../src/lib/site-settings/dto'
import { SITE_SETTINGS_DEFAULTS } from '../src/lib/site-settings/schema'
import { validateSiteSettingsInput } from '../src/lib/site-settings/validate'

const okInput = { stars: 5, comment: 'Lovely fit and soft fabric.', name: 'Tendai Moyo', photo: false, photoConsent: false }

describe('display name', () => {
  test('first name + last initial', () => {
    assert.strictEqual(deriveDisplayName('Tendai Moyo'), 'Tendai M.')
    assert.strictEqual(deriveDisplayName('  tendai   moyo  '), 'Tendai M.')
    assert.strictEqual(deriveDisplayName('Mary Jane Smith'), 'Mary S.')
  })
  test('a single name stays as it is (capitalised)', () => {
    assert.strictEqual(deriveDisplayName('rumbi'), 'Rumbi')
  })
  test('keeps apostrophes, hyphens and non-latin letters', () => {
    assert.strictEqual(deriveDisplayName("Nyasha-Rose O'Neil"), 'Nyasha-Rose O.')
    assert.strictEqual(deriveDisplayName('Zoë Ndlovu'), 'Zoë N.')
  })
  test('drops markup, digits and symbols; empty -> null', () => {
    const marked = deriveDisplayName('<b>Chipo</b> D')
    assert.ok(marked && !/[<>/]/.test(marked), String(marked))
    assert.strictEqual(deriveDisplayName('Chipo 0771234567'), 'Chipo')
    assert.strictEqual(deriveDisplayName('   '), null)
    assert.strictEqual(deriveDisplayName('12345'), null)
  })
  test('first name only, for the thank-you screen', () => {
    assert.strictEqual(firstNameOf('tendai moyo'), 'Tendai')
    assert.strictEqual(firstNameOf(''), null)
  })
})

describe('comment normalisation', () => {
  test('trims, normalises newlines, drops control characters', () => {
    assert.strictEqual(normaliseComment('  Hello\r\nthere\u0000!  '), 'Hello\nthere!')
    assert.strictEqual(normaliseComment('a\n\n\n\nb'), 'a\n\nb')
  })
  test('keeps text exactly (no HTML processing): escaping is the renderer’s job', () => {
    assert.strictEqual(normaliseComment('<script>x</script> ok ok'), '<script>x</script> ok ok')
  })
})

describe('validateReviewSubmission', () => {
  test('accepts a valid piece review', () => {
    const r = validateReviewSubmission({ ...okInput, shopStars: 4 }, { shopOnly: false, photoUploaded: false })
    assert.ok(r.ok)
    assert.deepStrictEqual(r.value, {
      stars: 5,
      shopStars: 4,
      comment: 'Lovely fit and soft fabric.',
      displayName: 'Tendai M.',
      firstName: 'Tendai',
      photo: false,
      photoConsent: false,
    })
  })
  test('stars must be a whole number 1-5', () => {
    for (const stars of [0, 6, 4.5, '5', null, undefined]) {
      const r = validateReviewSubmission({ ...okInput, stars }, { shopOnly: false, photoUploaded: false })
      assert.ok(!r.ok && r.errors.stars, `stars=${String(stars)}`)
    }
  })
  test('shop stars optional, 1-5 when given', () => {
    assert.ok(validateReviewSubmission({ ...okInput, shopStars: null }, { shopOnly: false, photoUploaded: false }).ok)
    const r = validateReviewSubmission({ ...okInput, shopStars: 9 }, { shopOnly: false, photoUploaded: false })
    assert.ok(!r.ok && r.errors.shopStars)
  })
  test(`comment ${REVIEW_COMMENT_MIN}-${REVIEW_COMMENT_MAX} characters after trimming`, () => {
    const short = validateReviewSubmission({ ...okInput, comment: '   too short   ' }, { shopOnly: false, photoUploaded: false })
    assert.ok(!short.ok && short.errors.comment)
    const nine = validateReviewSubmission({ ...okInput, comment: '123456789' }, { shopOnly: false, photoUploaded: false })
    assert.ok(!nine.ok)
    assert.ok(validateReviewSubmission({ ...okInput, comment: '1234567890' }, { shopOnly: false, photoUploaded: false }).ok)
    assert.ok(validateReviewSubmission({ ...okInput, comment: 'x'.repeat(1000) }, { shopOnly: false, photoUploaded: false }).ok)
    const long = validateReviewSubmission({ ...okInput, comment: 'x'.repeat(1001) }, { shopOnly: false, photoUploaded: false })
    assert.ok(!long.ok && long.errors.comment)
  })
  test('name is required and must give a display name', () => {
    const r = validateReviewSubmission({ ...okInput, name: '!!!' }, { shopOnly: false, photoUploaded: false })
    assert.ok(!r.ok && r.errors.name)
    const long = validateReviewSubmission({ ...okInput, name: 'a'.repeat(61) }, { shopOnly: false, photoUploaded: false })
    assert.ok(!long.ok && long.errors.name)
  })
  test('photo needs an uploaded photo; consent is kept as given', () => {
    const none = validateReviewSubmission({ ...okInput, photo: true, photoConsent: true }, { shopOnly: false, photoUploaded: false })
    assert.ok(!none.ok && none.errors.photo)
    const ok = validateReviewSubmission({ ...okInput, photo: true, photoConsent: true }, { shopOnly: false, photoUploaded: true })
    assert.ok(ok.ok && ok.value.photo && ok.value.photoConsent)
    const noConsent = validateReviewSubmission({ ...okInput, photo: true, photoConsent: false }, { shopOnly: false, photoUploaded: true })
    assert.ok(noConsent.ok && noConsent.value.photo && !noConsent.value.photoConsent)
  })
  test('consent without a photo is meaningless and dropped', () => {
    const r = validateReviewSubmission({ ...okInput, photo: false, photoConsent: true }, { shopOnly: false, photoUploaded: true })
    assert.ok(r.ok && r.value.photoConsent === false)
  })
  test('shop-only: no shop stars and no photo', () => {
    const r = validateReviewSubmission({ ...okInput, shopStars: 5 }, { shopOnly: true, photoUploaded: false })
    assert.ok(r.ok && r.value.shopStars === null)
    const p = validateReviewSubmission({ ...okInput, photo: true, photoConsent: true }, { shopOnly: true, photoUploaded: true })
    assert.ok(!p.ok && p.errors.photo)
  })
  test('rejects unknown fields and non-objects', () => {
    const r = validateReviewSubmission({ ...okInput, status: 'APPROVED' }, { shopOnly: false, photoUploaded: false })
    assert.ok(!r.ok && r.errors.status)
    assert.ok(!validateReviewSubmission(null, { shopOnly: false, photoUploaded: false }).ok)
    assert.ok(!validateReviewSubmission([], { shopOnly: false, photoUploaded: false }).ok)
  })
  test('booleans must be booleans', () => {
    const r = validateReviewSubmission({ ...okInput, photo: 'yes' }, { shopOnly: false, photoUploaded: true })
    assert.ok(!r.ok && r.errors.photo)
  })
})

describe('profanity flag (simple word list)', () => {
  test('whole words, any case', () => {
    assert.ok(containsProfanity('This is SHIT quality'))
    assert.ok(containsProfanity('f*ck no'))
    assert.ok(!containsProfanity('Scunthorpe classic assessment'))
    assert.ok(!containsProfanity('Beautiful dress, I love it'))
  })
})

describe('customer hint', () => {
  test('optional first name, trimmed, max 40, no control chars', () => {
    assert.deepStrictEqual(validateCustomerHint(undefined), { ok: true, value: null })
    assert.deepStrictEqual(validateCustomerHint('  Tendai '), { ok: true, value: 'Tendai' })
    assert.ok(!validateCustomerHint('x'.repeat(41)).ok)
    assert.ok(!validateCustomerHint(42).ok)
  })
})

describe('moderation actions', () => {
  test('approve / hide (note) / unpublish / reply', () => {
    assert.deepStrictEqual(parseModerationAction({ action: 'approve' }), { ok: true, value: { type: 'approve' } })
    assert.deepStrictEqual(parseModerationAction({ action: 'hide', note: ' spam ' }), { ok: true, value: { type: 'hide', note: 'spam' } })
    assert.deepStrictEqual(parseModerationAction({ action: 'hide' }), { ok: true, value: { type: 'hide', note: null } })
    assert.deepStrictEqual(parseModerationAction({ action: 'unpublish' }), { ok: true, value: { type: 'unpublish' } })
    assert.deepStrictEqual(parseModerationAction({ action: 'reply', reply: ' Thank you! ' }), {
      ok: true,
      value: { type: 'reply', reply: 'Thank you!' },
    })
    assert.deepStrictEqual(parseModerationAction({ action: 'reply', reply: '' }), { ok: true, value: { type: 'reply', reply: null } })
  })
  test('rejects unknown actions and over-long text', () => {
    assert.ok(!parseModerationAction({ action: 'create' }).ok)
    assert.ok(!parseModerationAction({ action: 'reply', reply: 'x'.repeat(501) }).ok)
    assert.ok(!parseModerationAction({ action: 'hide', note: 'x'.repeat(301) }).ok)
    assert.ok(!parseModerationAction(null).ok)
  })
})

describe('review token', () => {
  test(`${REVIEW_TOKEN_BYTES} random bytes, base64url, hash is sha256 hex`, () => {
    const a = generateReviewToken()
    const b = generateReviewToken()
    assert.notStrictEqual(a.token, b.token)
    assert.match(a.token, /^[A-Za-z0-9_-]{43}$/)
    assert.strictEqual(Buffer.from(a.token, 'base64url').length, 32)
    assert.match(a.hash, /^[0-9a-f]{64}$/)
    assert.strictEqual(hashReviewToken(a.token), a.hash)
    assert.notStrictEqual(a.hash, a.token)
  })
  test('well-formed check', () => {
    assert.ok(isWellFormedReviewToken(generateReviewToken().token))
    for (const bad of ['', 'abc', 'x'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}/`, null, 42]) {
      assert.ok(!isWellFormedReviewToken(bad), String(bad))
    }
  })
  test('constant-time hash comparison', () => {
    const { hash } = generateReviewToken()
    assert.ok(sameTokenHash(hash, hash))
    assert.ok(!sameTokenHash(hash, generateReviewToken().hash))
    assert.ok(!sameTokenHash(hash, 'short'))
  })
})

describe('aggregates', () => {
  test('average to one decimal and count; none -> null', () => {
    assert.deepStrictEqual(summarizeStars([5, 5, 4]), { average: 4.7, count: 3 })
    assert.deepStrictEqual(summarizeStars([4]), { average: 4, count: 1 })
    assert.strictEqual(summarizeStars([]), null)
  })
  test('shop rating: shop stars of piece reviews plus stars of shop-only reviews', () => {
    const stars = shopRatingStars([
      { shopOnly: false, stars: 2, shopStars: 5 },
      { shopOnly: false, stars: 3, shopStars: null },
      { shopOnly: true, stars: 4, shopStars: null },
    ])
    assert.deepStrictEqual(stars.sort(), [4, 5])
  })
  test('wording, never "0 reviews"', () => {
    const s = { average: 4.8, count: 12 }
    assert.strictEqual(feedRatingText(s), '★ 4.8 (12)')
    assert.strictEqual(ratingSummaryText(s), '4.8 · 12 reviews')
    assert.strictEqual(ratingSummaryText({ average: 5, count: 1 }), '5.0 · 1 review')
    assert.strictEqual(shopRatingLine({ average: 4.8, count: 36 }), 'Rated 4.8 out of 5 by 36 verified customers')
    assert.strictEqual(shopRatingLine({ average: 5, count: 1 }), 'Rated 5.0 out of 5 by 1 verified customer')
    assert.strictEqual(ratingLabel(s), 'Rated 4.8 out of 5 from 12 reviews')
    assert.strictEqual(starsText(4.4), '★★★★☆')
    // The picture never shows more than the number: 4.5 and 4.8 are four full stars.
    assert.strictEqual(starsText(4.5), '★★★★☆')
    assert.strictEqual(starsText(4.8), '★★★★☆')
    assert.strictEqual(starsText(5), '★★★★★')
    assert.strictEqual(starsText(1), '★☆☆☆☆')
    assert.strictEqual(feedRatingText(null), null)
    assert.strictEqual(shopRatingLine(null), null)
  })
  test('display order: reviews with a photo first, then newest', () => {
    const order = sortReviewsForDisplay([
      { date: '2026-10-01T00:00:00.000Z', photo: null, n: 1 },
      { date: '2026-10-03T00:00:00.000Z', photo: null, n: 2 },
      { date: '2026-09-01T00:00:00.000Z', photo: { url: 'x', srcSet: 'x', alt: 'x' }, n: 3 },
      { date: '2026-10-02T00:00:00.000Z', photo: { url: 'y', srcSet: 'y', alt: 'y' }, n: 4 },
    ]).map((r) => r.n)
    assert.deepStrictEqual(order, [4, 3, 2, 1])
  })
  test('relative dates', () => {
    const now = new Date('2026-11-01T12:00:00Z')
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()
    assert.strictEqual(relativeDate(ago(0), now), 'Today')
    assert.strictEqual(relativeDate(ago(1), now), 'Yesterday')
    assert.strictEqual(relativeDate(ago(3), now), '3 days ago')
    assert.strictEqual(relativeDate(ago(14), now), '2 weeks ago')
    assert.strictEqual(relativeDate(ago(35), now), '1 month ago')
    assert.strictEqual(relativeDate(ago(400), now), '1 year ago')
  })
})

const HEX = 'a'.repeat(32)
const baseRow: PublicReviewRow = {
  id: 7,
  inviteId: 9,
  shopOnly: false,
  productId: 3,
  stars: 5,
  shopStars: 4,
  comment: 'Beautiful <b>dress</b>, https://spam.example',
  displayName: 'Tendai M.',
  photoKey: `products/${HEX}.webp`,
  photoConsent: true,
  status: 'APPROVED',
  flagged: true,
  ownerReply: 'Thank you!',
  privateNote: 'owner only',
  moderatedBy: 'grace',
  createdAt: new Date('2026-10-20T10:00:00Z'),
  approvedAt: new Date('2026-10-21T10:00:00Z'),
}

describe('public review DTO (allow-list)', () => {
  test('only the allow-listed fields', () => {
    const dto = toPublicReview(baseRow, 'Velvet Dress')
    assert.ok(dto)
    assert.deepStrictEqual(Object.keys(dto).sort(), ['comment', 'date', 'name', 'photo', 'reply', 'stars'])
    assert.strictEqual(dto.comment, baseRow.comment) // stored as plain text; React escapes it
    assert.strictEqual(dto.name, 'Tendai M.')
    assert.strictEqual(dto.date, '2026-10-20T10:00:00.000Z')
    assert.strictEqual(dto.reply, 'Thank you!')
    assert.deepStrictEqual(Object.keys(dto.photo ?? {}).sort(), ['alt', 'srcSet', 'url'])
    assert.strictEqual(dto.photo?.url, `/api/images/public/${HEX}.webp`)
    const json = JSON.stringify(dto)
    for (const secret of ['owner only', 'grace', 'APPROVED', 'inviteId', 'products/', '"id"']) {
      assert.ok(!json.includes(secret), `leaked ${secret}`)
    }
  })
  test('never a review that is not APPROVED', () => {
    assert.strictEqual(toPublicReview({ ...baseRow, status: 'PENDING' }, 'x'), null)
    assert.strictEqual(toPublicReview({ ...baseRow, status: 'HIDDEN' }, 'x'), null)
  })
  test('photo only with consent and a valid key', () => {
    assert.strictEqual(toPublicReview({ ...baseRow, photoConsent: false }, 'x')?.photo, null)
    assert.strictEqual(toPublicReview({ ...baseRow, photoKey: '../etc/passwd' }, 'x')?.photo, null)
    assert.strictEqual(toPublicReview({ ...baseRow, photoKey: null }, 'x')?.photo, null)
  })
  test('blank reply is null', () => {
    assert.strictEqual(toPublicReview({ ...baseRow, ownerReply: '  ' }, 'x')?.reply, null)
  })
})

describe('reviews index (approved only, public products only)', () => {
  const velvet = { slug: 'velvet', name: 'Velvet', isPublic: true }
  const rows = [
    { ...baseRow, id: 1, productId: 1, stars: 5, shopStars: 5, product: velvet },
    { ...baseRow, id: 2, productId: 1, stars: 4, shopStars: null, product: velvet },
    { ...baseRow, id: 3, productId: 1, stars: 1, status: 'PENDING' as const, product: velvet },
    { ...baseRow, id: 4, shopOnly: true, productId: null, stars: 3, shopStars: null, photoKey: null, product: null },
    { ...baseRow, id: 5, productId: 2, stars: 2, shopStars: 2, status: 'HIDDEN' as const, product: { slug: 'lime', name: 'Lime', isPublic: true } },
  ]
  test('aggregates and lists only APPROVED reviews', () => {
    const index = buildReviewsIndex(rows)
    assert.deepStrictEqual(index.products.velvet.summary, { average: 4.5, count: 2 })
    assert.strictEqual(index.products.velvet.reviews.length, 2)
    assert.strictEqual(index.products.lime, undefined)
    // shop: 5 (shopStars of #1) + 3 (shop-only #4); #2 gave no shop stars; pending/hidden ignored
    assert.deepStrictEqual(index.shop, { average: 4, count: 2 })
  })
  test('owner decision: unpublished or deleted pieces still count towards the shop rating, but are not listed', () => {
    const index = buildReviewsIndex([
      ...rows,
      // Unpublished piece: shop stars 1 count; the piece is not listed.
      { ...baseRow, id: 6, productId: 3, stars: 2, shopStars: 1, product: { slug: 'draft', name: 'Draft', isPublic: false } },
      // Deleted piece (productId SET NULL, not shop-only): shop stars 2 count; its piece stars (5) never do.
      { ...baseRow, id: 7, productId: null, stars: 5, shopStars: 2, product: null },
    ])
    assert.strictEqual(index.products.draft, undefined)
    assert.deepStrictEqual(Object.keys(index.products), ['velvet'])
    // shop: 5 + 3 + 1 + 2 = 11 / 4
    assert.deepStrictEqual(index.shop, { average: 2.8, count: 4 })
  })
  test('no approved reviews: no summaries at all', () => {
    const index = buildReviewsIndex(rows.filter((r) => r.status !== 'APPROVED'))
    assert.deepStrictEqual(index, { shop: null, products: {} })
  })
  test('the index is plain JSON (cacheable)', () => {
    const index = buildReviewsIndex(rows)
    assert.deepStrictEqual(JSON.parse(JSON.stringify(index)), index)
  })
})

const product: PublicProduct = {
  slug: 'velvet',
  name: 'Velvet Dress',
  description: null,
  category: { slug: 'dresses', name: 'Dresses' },
  colours: null,
  sizes: null,
  availability: 'IN_STOCK',
  images: [{ url: '/a', srcSet: '/a 320w', alt: 'a', width: null, height: null }],
  video: null,
  isNew: false,
  featured: false,
  priceUsd: 65,
  ref: 'V-0001',
}
const ctx = {
  base: '' as const,
  contacts: { whatsappNumber: null, enquiryTemplate: 'x {product}', generalEnquiryMessage: 'x' },
  productUrl: () => null,
}

describe('feed slide rating', () => {
  test('"★ 4.8 (12)" when the piece has approved reviews', () => {
    const item = toFeedItem(product, { ...ctx, rating: () => ({ average: 4.8, count: 12 }) })
    assert.deepStrictEqual(item.rating, { text: '★ 4.8 (12)', label: 'Rated 4.8 out of 5 from 12 reviews' })
  })
  test('absent without reviews (never "0 reviews") and without a rating source', () => {
    assert.strictEqual(toFeedItem(product, { ...ctx, rating: () => null }).rating, undefined)
    assert.strictEqual(toFeedItem(product, ctx).rating, undefined)
  })
})

describe('menu shop rating', () => {
  const settings = toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS })
  test('filled from the shop summary', () => {
    const menu = buildMenuModel({ settings, tabs: [], base: '', shopRating: { average: 4.8, count: 36 } })
    assert.deepStrictEqual(menu.shopRating, {
      average: '4.8',
      stars: '★★★★☆',
      line: 'Rated 4.8 out of 5 by 36 verified customers',
    })
  })
  test('hidden without reviews', () => {
    assert.strictEqual(buildMenuModel({ settings, tabs: [], base: '' }).shopRating, null)
    assert.strictEqual(buildMenuModel({ settings, tabs: [], base: '', shopRating: null }).shopRating, null)
  })
})

describe('same-origin check for public POSTs', () => {
  const h = (o: Record<string, string>) => new Headers(o)
  test('Sec-Fetch-Site same-origin passes; cross-site fails', () => {
    assert.ok(isSameOriginRequest(h({ 'sec-fetch-site': 'same-origin', host: 'vyra.co.zw' })))
    assert.ok(!isSameOriginRequest(h({ 'sec-fetch-site': 'cross-site', host: 'vyra.co.zw', origin: 'https://vyra.co.zw' })))
    assert.ok(!isSameOriginRequest(h({ 'sec-fetch-site': 'same-site', host: 'vyra.co.zw' })))
  })
  test('without Sec-Fetch-Site the Origin host must equal Host', () => {
    assert.ok(isSameOriginRequest(h({ origin: 'https://vyra.co.zw', host: 'vyra.co.zw' })))
    assert.ok(isSameOriginRequest(h({ origin: 'http://localhost:3455', host: 'localhost:3455' })))
    assert.ok(!isSameOriginRequest(h({ origin: 'https://evil.example', host: 'vyra.co.zw' })))
    assert.ok(!isSameOriginRequest(h({ origin: 'null', host: 'vyra.co.zw' })))
  })
  test('neither header: refused', () => {
    assert.ok(!isSameOriginRequest(h({ host: 'vyra.co.zw' })))
  })
})

describe('review links', () => {
  const token = generateReviewToken().token
  test('absolute URL prefers the storefront host, else /site on the admin host', () => {
    assert.strictEqual(
      reviewAbsoluteUrl({ token, storefrontHosts: ['vyra.co.zw'], host: 'admin.example' }),
      `https://vyra.co.zw/review/${token}`,
    )
    assert.strictEqual(reviewAbsoluteUrl({ token, storefrontHosts: [], host: 'localhost:3455' }), `http://localhost:3455/site/review/${token}`)
    assert.strictEqual(reviewAbsoluteUrl({ token: 'bad', storefrontHosts: [], host: 'localhost' }), null)
  })
  test('WhatsApp link has no number and carries the ready message', () => {
    const url = `https://vyra.co.zw/review/${token}`
    const message = reviewInviteMessage({ firstName: 'Tendai', pieceName: 'Velvet Dress', url })
    assert.match(message, /^Hi Tendai, thank you for shopping with VYRA!/)
    assert.ok(message.includes('Velvet Dress'))
    assert.ok(message.includes(url))
    const href = reviewWhatsAppHref(message)
    assert.ok(href.startsWith('https://wa.me/?text='))
    assert.strictEqual(decodeURIComponent(href.slice('https://wa.me/?text='.length)), message)
    const shop = reviewInviteMessage({ firstName: null, pieceName: null, url })
    assert.match(shop, /^Hi, thank you for shopping with VYRA!/)
  })
})

describe('structured data (genuine approved reviews only)', () => {
  const review = toPublicReview({ ...baseRow, comment: 'Lovely </script><script>alert(1)</script>' }, 'Velvet') as NonNullable<
    ReturnType<typeof toPublicReview>
  >
  test('Product with AggregateRating and Review items', () => {
    const ld = productReviewsJsonLd({ name: 'Velvet', url: 'https://vyra.co.zw/p/velvet', image: null, summary: { average: 4.5, count: 2 }, reviews: [review] })
    assert.ok(ld)
    assert.strictEqual(ld['@type'], 'Product')
    assert.deepStrictEqual(ld.aggregateRating, { '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 2, bestRating: 5, worstRating: 1 })
    const items = ld.review as Array<Record<string, unknown>>
    assert.strictEqual(items.length, 1)
    assert.deepStrictEqual(items[0].author, { '@type': 'Person', name: 'Tendai M.' })
  })
  test('no reviews: no markup', () => {
    assert.strictEqual(productReviewsJsonLd({ name: 'x', url: null, image: null, summary: null, reviews: [] }), null)
    assert.strictEqual(productReviewsJsonLd({ name: 'x', url: null, image: null, summary: { average: 5, count: 1 }, reviews: [] }), null)
  })
  test('the script text cannot close the tag', () => {
    const ld = productReviewsJsonLd({ name: 'x', url: null, image: null, summary: { average: 5, count: 1 }, reviews: [review] })
    const text = jsonLdScript(ld as Record<string, unknown>)
    assert.ok(!text.includes('</script'))
    assert.ok(!text.includes('<'))
    assert.deepStrictEqual(JSON.parse(text), ld)
  })
})

describe('site setting googleReviewUrl', () => {
  test('https Google review links only; public DTO carries it', () => {
    const ok = validateSiteSettingsInput({ googleReviewUrl: 'https://g.page/r/abc123/review' })
    assert.ok(ok.ok)
    assert.ok(validateSiteSettingsInput({ googleReviewUrl: 'https://search.google.com/local/writereview?placeid=x' }).ok)
    assert.ok(!validateSiteSettingsInput({ googleReviewUrl: 'http://g.page/r/abc' }).ok)
    assert.ok(!validateSiteSettingsInput({ googleReviewUrl: 'https://evil.example/review' }).ok)
    assert.ok(!validateSiteSettingsInput({ googleReviewUrl: 'javascript:alert(1)' }).ok)
    // Exact hosts only; google.com only under /maps.
    for (const ok of ['https://maps.app.goo.gl/AbC123', 'https://www.google.com/maps/place/VYRA', 'https://google.com/maps']) {
      assert.ok(validateSiteSettingsInput({ googleReviewUrl: ok }).ok, ok)
    }
    for (const bad of [
      'https://www.google.com/search?q=vyra',
      'https://google.com/mapsevil',
      'https://evil.g.page/r/x',
      'https://goo.gl/abc',
      'https://maps.google.co.zw/x',
      'https://docs.google.com/maps/x',
      'https://g.page.evil.example/r/x',
      'https://g.page:8443/r/x',
    ]) {
      assert.ok(!validateSiteSettingsInput({ googleReviewUrl: bad }).ok, bad)
    }
    assert.ok(validateSiteSettingsInput({ googleReviewUrl: null }).ok)
    const pub = toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS, googleReviewUrl: 'https://g.page/r/abc/review' })
    assert.strictEqual(pub.reviews.googleReviewUrl, 'https://g.page/r/abc/review')
    assert.strictEqual(toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS }).reviews.googleReviewUrl, null)
  })
})
