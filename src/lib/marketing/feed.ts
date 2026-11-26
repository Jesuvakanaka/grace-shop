// VYRA Marketing hub (ZP-1200): the product feed for Meta Catalog and Google Merchant Center (CSV and RSS 2.0 with the
// g: namespace). Pure. It is built ONLY from public product DTOs (published products), so nothing private can leak.
// Price: "12.00 USD" only when the storefront shows a price (publicPriceUsd rule, already applied in PublicProduct.priceUsd).
// Meta and Google want a price on every item: pieces whose price is hidden are listed without one and will be flagged
// "missing price" by the platforms (they cannot be bought through a catalogue, by design).
import type { PublicProduct } from '@/lib/storefront/dto'
import { productAbsoluteUrl } from '@/lib/storefront/product-route'

export const FEED_BRAND = 'VYRA'
export const FEED_COLUMNS = [
  'id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'additional_image_link',
  'brand', 'google_product_category', 'product_type', 'identifier_exists',
] as const
export type FeedColumn = (typeof FEED_COLUMNS)[number]
export type FeedItem = Record<FeedColumn, string>

/** Google category paths by words found in the category name or slug (first match wins). */
const GOOGLE_CATEGORIES: readonly [RegExp, string][] = [
  [/dress|gown/i, 'Apparel & Accessories > Clothing > Dresses'],
  [/skirt/i, 'Apparel & Accessories > Clothing > Skirts'],
  [/trouser|pant|jean|legging/i, 'Apparel & Accessories > Clothing > Pants'],
  [/jacket|coat|blazer|cardigan/i, 'Apparel & Accessories > Clothing > Outerwear'],
  [/top|blouse|shirt|tee|t-shirt/i, 'Apparel & Accessories > Clothing > Shirts & Tops'],
  [/shoe|sandal|heel|boot/i, 'Apparel & Accessories > Shoes'],
  [/handbag|bag|purse/i, 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags'],
  [/jewel|necklace|earring|bracelet|ring/i, 'Apparel & Accessories > Jewelry'],
]

export function googleCategoryFor(category: { slug: string; name: string }): string {
  const hay = `${category.name} ${category.slug}`
  return GOOGLE_CATEGORIES.find(([re]) => re.test(hay))?.[1] ?? ''
}

export function feedAvailability(p: Pick<PublicProduct, 'availability' | 'preOrder'>): 'in stock' | 'out of stock' | 'preorder' {
  if (p.preOrder) return 'preorder'
  return p.availability === 'SOLD_OUT' ? 'out of stock' : 'in stock'
}

export const feedPrice = (priceUsd: number | null | undefined): string =>
  typeof priceUsd === 'number' && Number.isFinite(priceUsd) && priceUsd > 0 ? `${priceUsd.toFixed(2)} USD` : ''

const withParam = (url: string, k: string, v: string) => `${url}${url.includes('?') ? '&' : '?'}${k}=${v}`

/** Public JPEG rendition (Meta and Google do not all accept WebP). */
function jpegImage(origin: string, imageUrl: string, width = 1200): string {
  const abs = /^https?:\/\//.test(imageUrl) ? imageUrl : `${origin}${imageUrl}`
  return withParam(withParam(abs, 'format', 'jpeg'), 'w', String(width))
}

export interface FeedContext {
  storefrontHosts: readonly string[]
  /** Request Host, used only when no storefront host is configured (UAT). */
  host: string | null | undefined
}

/** One item per published product that has an absolute link. Products without one are skipped. */
export function buildFeedItems(products: readonly PublicProduct[], ctx: FeedContext): FeedItem[] {
  const items: FeedItem[] = []
  for (const p of products) {
    const id = p.itemNumber ?? p.ref
    const base = productAbsoluteUrl({ slug: p.slug, storefrontHosts: ctx.storefrontHosts, host: ctx.host })
    if (!id || !base) continue
    const origin = new URL(base).origin
    const images = p.images.map((i) => jpegImage(origin, i.url))
    items.push({
      id,
      title: p.name.slice(0, 150),
      description: (p.description?.trim() || p.name).slice(0, 5000),
      availability: feedAvailability(p),
      condition: 'new',
      price: feedPrice(p.priceUsd),
      link: withParam(base, 'src', 'feed'),
      image_link: images[0] ?? '',
      additional_image_link: images.slice(1, 10).join(','),
      brand: FEED_BRAND,
      google_product_category: googleCategoryFor(p.category),
      product_type: p.category.name,
      identifier_exists: 'no',
    })
  }
  return items
}

// ───────────────────────── CSV ─────────────────────────

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function feedCsv(items: readonly FeedItem[]): string {
  const rows = [FEED_COLUMNS.join(','), ...items.map((i) => FEED_COLUMNS.map((c) => csvCell(i[c])).join(','))]
  return `${rows.join('\r\n')}\r\n`
}

// ───────────────────────── RSS 2.0 ─────────────────────────

// eslint-disable-next-line no-control-regex
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
export const xmlEscape = (v: string): string =>
  v.replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export function feedRss(items: readonly FeedItem[], channel: { title: string; link: string; description: string }): string {
  const tag = (name: string, value: string) => (value === '' ? '' : `<g:${name}>${xmlEscape(value)}</g:${name}>`)
  const body = items
    .map((i) => {
      const extra = i.additional_image_link ? i.additional_image_link.split(',').map((u) => tag('additional_image_link', u)).join('') : ''
      return `<item>${tag('id', i.id)}<title>${xmlEscape(i.title)}</title><description>${xmlEscape(i.description)}</description>${tag('availability', i.availability)}${tag('condition', i.condition)}${tag('price', i.price)}<link>${xmlEscape(i.link)}</link>${tag('image_link', i.image_link)}${extra}${tag('brand', i.brand)}${tag('google_product_category', i.google_product_category)}${tag('product_type', i.product_type)}${tag('identifier_exists', i.identifier_exists)}</item>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${xmlEscape(channel.title)}</title><link>${xmlEscape(channel.link)}</link><description>${xmlEscape(channel.description)}</description>\n${body}\n</channel></rss>\n`
}
