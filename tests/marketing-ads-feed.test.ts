// ZP-1200: the product feed (CSV and RSS), pure, plus the route logic with injected data. No database, no network.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import type { PublicProduct } from '../src/lib/storefront/dto'
import { buildFeedItems, feedCsv, feedPrice, feedRss, googleCategoryFor, xmlEscape, FEED_COLUMNS } from '../src/lib/marketing/feed'
import { serveFeed } from '../src/lib/marketing/feed-route'

const product = (o: Partial<PublicProduct> = {}): PublicProduct => ({
  slug: 'pink-party-dress', name: 'Pink party dress', description: 'A soft pink dress, perfect for parties.',
  category: { slug: 'dresses', name: 'Dresses' }, colours: null, sizes: null, availability: 'IN_STOCK', preOrder: null,
  images: [
    { url: '/api/images/public/' + 'a'.repeat(32) + '.webp', srcSet: '', alt: 'x', width: null, height: null },
    { url: '/api/images/public/' + 'b'.repeat(32) + '.webp', srcSet: '', alt: 'x', width: null, height: null },
  ],
  video: null, isNew: false, featured: false, priceUsd: 12, itemNumber: 'VY-0001', ref: 'V-0001', ...o,
})
const ctx = { storefrontHosts: ['vyra.example'], host: null }

describe('feed items', () => {
  test('fields for a priced, in-stock product', () => {
    const [i] = buildFeedItems([product()], ctx)
    assert.strictEqual(i.id, 'VY-0001')
    assert.strictEqual(i.title, 'Pink party dress')
    assert.strictEqual(i.availability, 'in stock')
    assert.strictEqual(i.condition, 'new')
    assert.strictEqual(i.price, '12.00 USD')
    assert.strictEqual(i.link, 'https://vyra.example/p/pink-party-dress?src=feed')
    assert.strictEqual(i.brand, 'VYRA')
    assert.strictEqual(i.google_product_category, 'Apparel & Accessories > Clothing > Dresses')
  })
  test('images are public JPEG renditions with a width', () => {
    const [i] = buildFeedItems([product()], ctx)
    assert.strictEqual(i.image_link, `https://vyra.example/api/images/public/${'a'.repeat(32)}.webp?format=jpeg&w=1200`)
    assert.strictEqual(i.additional_image_link, `https://vyra.example/api/images/public/${'b'.repeat(32)}.webp?format=jpeg&w=1200`)
  })
  test('the price is hidden exactly when the storefront hides it', () => {
    const [i] = buildFeedItems([product({ priceUsd: null })], ctx)
    assert.strictEqual(i.price, '')
    assert.strictEqual(feedPrice(0), '')
    assert.strictEqual(feedPrice(-1), '')
    assert.strictEqual(feedPrice(9.5), '9.50 USD')
    assert.doesNotMatch(feedRss([i], { title: 't', link: 'l', description: 'd' }), /g:price/)
  })
  test('availability: out of stock, few left is in stock, pre-order', () => {
    const a = (p: Partial<PublicProduct>) => buildFeedItems([product(p)], ctx)[0].availability
    assert.strictEqual(a({ availability: 'SOLD_OUT' }), 'out of stock')
    assert.strictEqual(a({ availability: 'FEW_LEFT' }), 'in stock')
    assert.strictEqual(a({ preOrder: { label: 'Pre-order' } as never }), 'preorder')
  })
  test('category omitted when not derivable; description falls back to the name', () => {
    assert.strictEqual(googleCategoryFor({ slug: 'gifts', name: 'Gifts' }), '')
    const [i] = buildFeedItems([product({ category: { slug: 'gifts', name: 'Gifts' }, description: null })], ctx)
    assert.strictEqual(i.google_product_category, '')
    assert.strictEqual(i.description, 'Pink party dress')
  })
  test('on UAT (no storefront host) the request host is used; with neither, the product is skipped', () => {
    assert.strictEqual(buildFeedItems([product()], { storefrontHosts: [], host: 'uat.example.com' })[0].link, 'https://uat.example.com/site/p/pink-party-dress?src=feed')
    assert.strictEqual(buildFeedItems([product()], { storefrontHosts: [], host: null }).length, 0)
  })
})

describe('CSV and RSS output', () => {
  test('CSV: header, quoting and doubled quotes', () => {
    const items = buildFeedItems([product({ name: 'The "Rose", dress', description: 'line one\nline two' })], ctx)
    const csv = feedCsv(items)
    const lines = csv.split('\r\n')
    assert.strictEqual(lines[0], FEED_COLUMNS.join(','))
    assert.match(csv, /"The ""Rose"", dress"/)
    assert.match(csv, /"line one\nline two"/)
  })
  test('RSS 2.0 with the g: namespace and XML escaping', () => {
    const items = buildFeedItems([product({ name: 'Tom & Jerry <dress>', description: `5 > 3 "quoted" it's \u0001ok` })], ctx)
    const xml = feedRss(items, { title: 'VYRA & co', link: 'https://vyra.example/', description: 'd' })
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/)
    assert.match(xml, /<rss version="2.0" xmlns:g="http:\/\/base.google.com\/ns\/1.0">/)
    assert.match(xml, /<title>Tom &amp; Jerry &lt;dress&gt;<\/title>/)
    assert.match(xml, /5 &gt; 3 &quot;quoted&quot; it&apos;s ok/)
    assert.match(xml, /<title>VYRA &amp; co<\/title>/)
    assert.match(xml, /<g:price>12.00 USD<\/g:price>/)
    assert.match(xml, /src=feed<\/link>/)
    assert.doesNotMatch(xml, /\u0001/)
    assert.strictEqual(xmlEscape('<&>'), '&lt;&amp;&gt;')
  })
})

describe('serveFeed', () => {
  const req = (host = 'vyra.example') => new Request('https://x/api/public/marketing/feed.csv', { headers: { host } })
  const on = { settings: async () => ({ productFeedEnabled: true }), loadProducts: async () => [product()] }
  test('404 when the feed is switched off in the settings (no cache, no data)', async () => {
    let loaded = false
    const res = await serveFeed(req(), 'csv', { settings: async () => ({ productFeedEnabled: false }), loadProducts: async () => { loaded = true; return [] } })
    assert.strictEqual(res.status, 404)
    assert.strictEqual(res.headers.get('cache-control'), 'no-store')
    assert.strictEqual(loaded, false)
  })
  test('404 when the hub kill switch is off, even if the feed is enabled', async () => {
    assert.strictEqual((await serveFeed(req(), 'xml', { ...on, hubOn: false })).status, 404)
  })
  test('200 CSV and XML with cache headers and the right types, no auth needed', async () => {
    const csv = await serveFeed(req(), 'csv', on)
    assert.strictEqual(csv.status, 200)
    assert.match(csv.headers.get('content-type') ?? '', /^text\/csv/)
    assert.match(csv.headers.get('cache-control') ?? '', /public, max-age=300/)
    assert.match(await csv.text(), /VY-0001/)
    const xml = await serveFeed(req(), 'xml', on)
    assert.match(xml.headers.get('content-type') ?? '', /^application\/rss\+xml/)
    assert.match(await xml.text(), /<g:id>VY-0001<\/g:id>/)
  })
})
