// Pre-order listings: label, public DTO, feed badge, WhatsApp label/message, admin PATCH validation. No database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { preOrderLabel, shipWindow, toPreOrderInfo } from '../src/lib/storefront-model/preorder'
import { toPublicProduct, type PublicProductRow } from '../src/lib/storefront/dto'
import { feedBadge, toFeedItem } from '../src/lib/storefront/feed'
import { infoAvailability, infoPrimary } from '../src/lib/storefront/feed-view'
import { enquiryLabel } from '../src/lib/storefront/product-enquiry'
import { productPageEnquiryHref } from '../src/lib/storefront/product-page-enquiry'
import { parseProductWebsitePatch } from '../src/lib/website/validation'

const NOW = new Date('2026-11-01T12:00:00Z')
const contacts = { whatsappNumber: '+263771234567', enquiryTemplate: 'Hi VYRA, is the {product} available? ({url})', generalEnquiryMessage: 'Hi' }

function row(o: Partial<PublicProductRow> = {}): PublicProductRow {
  return {
    id: 1, itemNumber: 'I-1', productName: 'Lime dress', publicName: null, slug: 'lime-dress', publicDescription: null,
    colours: null, sizes: null, featured: false, sortOrder: 0, published: true, publishedAt: new Date('2026-01-01T00:00:00Z'),
    priceDisplay: 'SHOW_PRICE', sellingPriceUsd: 50, currentQuantity: 0,
    category: { slug: 'dresses', name: 'Dresses', published: true }, images: [], video: null, ...o,
  }
}
const pre = row({ listingType: 'PRE_ORDER', preorderShipFrom: new Date('2027-02-01T00:00:00Z'), preorderShipTo: new Date('2027-03-01T00:00:00Z') })

describe('pre-order label', () => {
  test('formats', () => {
    assert.equal(preOrderLabel('2027-02-01', '2027-03-01'), 'Pre-order · ships Feb–Mar 2027')
    assert.equal(preOrderLabel('2027-03-01', '2027-03-20'), 'Pre-order · ships Mar 2027')
    assert.equal(preOrderLabel('2027-03-01', null), 'Pre-order · ships Mar 2027')
    assert.equal(preOrderLabel(null, '2027-04-01'), 'Pre-order · ships Apr 2027')
    assert.equal(preOrderLabel(null, null), 'Pre-order')
    assert.equal(shipWindow('2026-12-01', '2027-01-01'), 'Dec 2026–Jan 2027')
  })
  test('only PRE_ORDER gives info', () => {
    assert.equal(toPreOrderInfo({ listingType: 'IN_STOCK' }), null)
    assert.deepEqual(toPreOrderInfo({ listingType: 'PRE_ORDER' }), { shipFrom: null, shipTo: null, label: 'Pre-order' })
  })
})

describe('pre-order public DTO', () => {
  test('never sold out, with label and ISO dates', () => {
    const p = toPublicProduct(pre, { now: NOW })
    assert.equal(p.availability, 'IN_STOCK')
    assert.deepEqual(p.preOrder, { shipFrom: '2027-02-01T00:00:00.000Z', shipTo: '2027-03-01T00:00:00.000Z', label: 'Pre-order · ships Feb–Mar 2027' })
  })
  test('in-stock rows keep stock availability and null preOrder', () => {
    const p = toPublicProduct(row(), { now: NOW })
    assert.equal(p.availability, 'SOLD_OUT')
    assert.equal(p.preOrder, null)
  })
  test('feed badge and info panel show the label', () => {
    const p = toPublicProduct(pre, { now: NOW })
    assert.deepEqual(feedBadge(p), { kind: 'pre-order', label: 'Pre-order · ships Feb–Mar 2027' })
    const item = toFeedItem(p, { base: '', contacts, productUrl: () => 'https://x.example/p/lime-dress' })
    assert.equal(item.soldOut, false)
    assert.equal(infoAvailability(item).label, 'Pre-order · ships Feb–Mar 2027')
    assert.equal(infoPrimary(item).label, 'Pre-order on WhatsApp')
    assert.match(decodeURIComponent(item.enquireHref ?? ''), /pre-order the Lime dress \(ships Feb–Mar 2027\)/)
  })
})

describe('pre-order enquiry', () => {
  const info = { shipFrom: '2027-02-01T00:00:00.000Z', shipTo: '2027-03-01T00:00:00.000Z' }
  test('label', () => {
    assert.equal(enquiryLabel('IN_STOCK', info), 'Pre-order on WhatsApp')
    assert.equal(enquiryLabel('IN_STOCK'), 'Enquire on WhatsApp')
  })
  test('message names the pre-order and ship window', () => {
    const href = productPageEnquiryHref(contacts, 'IN_STOCK', { name: 'Lime dress', url: 'https://x.example/p/l' }, info) ?? ''
    const text = decodeURIComponent(new URL(href).searchParams.get('text') ?? '')
    assert.match(text, /pre-order the Lime dress \(ships Feb–Mar 2027\)/)
    assert.match(text, /https:\/\/x\.example\/p\/l/)
  })
})

describe('admin PATCH validation (pre-order)', () => {
  test('accepts a valid pre-order and stores first of month', () => {
    const r = parseProductWebsitePatch({ listingType: 'PRE_ORDER', preorderShipFrom: '2027-02', preorderShipTo: '2027-03-15', preorderExpectedQty: 40 })
    assert.ok(r.ok)
    if (r.ok) {
      assert.equal(r.data.preorderShipFrom?.toISOString(), '2027-02-01T00:00:00.000Z')
      assert.equal(r.data.preorderShipTo?.toISOString(), '2027-03-01T00:00:00.000Z')
      assert.equal(r.data.preorderExpectedQty, 40)
    }
  })
  test('rejects shipTo before shipFrom', () => {
    const r = parseProductWebsitePatch({ preorderShipFrom: '2027-03', preorderShipTo: '2027-02' })
    assert.ok(!r.ok && r.field === 'preorderShipTo')
  })
  test('rejects bad quantity, month and listing type', () => {
    for (const q of [-1, 1.5, 100001, '5']) assert.ok(!parseProductWebsitePatch({ preorderExpectedQty: q }).ok)
    assert.ok(parseProductWebsitePatch({ preorderExpectedQty: 0 }).ok)
    assert.ok(parseProductWebsitePatch({ preorderExpectedQty: 100000 }).ok)
    assert.ok(!parseProductWebsitePatch({ preorderShipFrom: '2027-13' }).ok)
    assert.ok(!parseProductWebsitePatch({ listingType: 'SOLD' }).ok)
    assert.ok(parseProductWebsitePatch({ listingType: 'IN_STOCK' }).ok)
  })
})
