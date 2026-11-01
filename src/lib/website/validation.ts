// Request validation for the admin website API (ZP-483). Pure; allow-lists only.
// Anything not listed is refused, so a client can never write columns such as
// published, publishedAt, cost or stock through these routes.
import { imageKeyFromImageUrl } from '@/lib/storefront-model'
import { parseSizeChart, type SizeChartRow } from '@/lib/storefront-model/size-chart'
import {
  ALT_TEXT_MAX,
  BULK_MAX_IDS,
  CATEGORY_DESCRIPTION_MAX,
  CATEGORY_NAME_MAX,
  GALLERY_MAX_IMAGES,
  PUBLIC_DESCRIPTION_MAX,
  PUBLIC_NAME_MAX,
  SHORT_TEXT_MAX,
} from './labels'

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string; field?: string }

const fail = (error: string, field?: string): { ok: false; error: string; field?: string } =>
  field ? { ok: false, error, field } : { ok: false, error }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2_147_483_647
}

/** Route param "12" -> 12, else null. */
export function parseIdParam(raw: string | undefined): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw)) return null
  const n = Number(raw)
  return isPositiveInt(n) ? n : null
}

const READ_ONLY_FIELDS: Record<string, string> = {
  published: 'Use the "Published on website" switch to publish or unpublish.',
  publishedAt: 'publishedAt is set by publishing and cannot be edited.',
}

function checkKeys(
  src: Record<string, unknown>,
  allowed: readonly string[],
  readOnly: Record<string, string> = READ_ONLY_FIELDS,
): string | null {
  for (const key of Object.keys(src)) {
    // Own keys only: "__proto__", "constructor" etc. must not hit Object.prototype.
    if (Object.hasOwn(readOnly, key)) return readOnly[key]
    if (!allowed.includes(key)) return `Unknown field "${key}"`
  }
  return null
}

// Control characters other than tab and newline are never valid text.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/** null / "" / whitespace -> null; otherwise the trimmed string, at most `max` characters. */
function optionalText(v: unknown, label: string, max: number, field: string): Parsed<string | null> {
  if (v === null) return { ok: true, data: null }
  if (typeof v !== 'string') return fail(`${label} must be text.`, field)
  const text = v.replace(/\r\n?/g, '\n').trim()
  if (CONTROL.test(text)) return fail(`${label} contains invalid characters.`, field)
  if (text.length > max) return fail(`${label} can be at most ${max} characters.`, field)
  return { ok: true, data: text === '' ? null : text }
}

// ─── Product website fields ─────────────────────────────────────────────────────

export type ProductWebsitePatch = {
  publicName?: string | null
  slug?: string
  publicDescription?: string | null
  categoryId?: number | null
  priceDisplay?: 'SHOW_PRICE' | 'ASK_FOR_PRICE'
  colours?: string | null
  sizes?: string | null
  featured?: boolean
  // ZP-513: details card "size & fit" and "fabric & care".
  fitNote?: string | null
  fabric?: string | null
  care?: string | null
  sizeChart?: SizeChartRow[] | null
}

/** ZP-513 limits (characters, after trimming). */
export const FIT_NOTE_MAX = 160
export const FABRIC_MAX = 80
export const CARE_MAX = 80

const PRODUCT_FIELDS = [
  'publicName',
  'slug',
  'publicDescription',
  'categoryId',
  'priceDisplay',
  'colours',
  'sizes',
  'featured',
  'fitNote',
  'fabric',
  'care',
  'sizeChart',
] as const

export function parseProductWebsitePatch(body: unknown): Parsed<ProductWebsitePatch> {
  if (!isPlainObject(body)) return fail('Invalid JSON body')
  const unknownKey = checkKeys(body, PRODUCT_FIELDS)
  if (unknownKey) return fail(unknownKey)
  const data: ProductWebsitePatch = {}

  const texts: [
    keyof ProductWebsitePatch & ('publicName' | 'publicDescription' | 'colours' | 'sizes' | 'fitNote' | 'fabric' | 'care'),
    string,
    number,
  ][] = [
    ['publicName', 'Public name', PUBLIC_NAME_MAX],
    ['publicDescription', 'Description', PUBLIC_DESCRIPTION_MAX],
    ['colours', 'Colours', SHORT_TEXT_MAX],
    ['sizes', 'Sizes', SHORT_TEXT_MAX],
    ['fitNote', 'Fit note', FIT_NOTE_MAX],
    ['fabric', 'Fabric', FABRIC_MAX],
    ['care', 'Care', CARE_MAX],
  ]
  for (const [key, label, max] of texts) {
    if (body[key] === undefined) continue
    const r = optionalText(body[key], label, max, key)
    if (!r.ok) return r
    data[key] = r.data
  }

  if (body.sizeChart !== undefined) {
    const r = parseSizeChart(body.sizeChart)
    if (!r.ok) return fail(r.error, 'sizeChart')
    data.sizeChart = r.value
  }

  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string' || body.slug.trim() === '') {
      return fail('Web address (slug) cannot be empty.', 'slug')
    }
    if (body.slug.length > 200) return fail('Web address (slug) is too long.', 'slug')
    data.slug = body.slug
  }

  if (body.categoryId !== undefined) {
    if (body.categoryId !== null && !isPositiveInt(body.categoryId)) return fail('Choose a valid category.', 'categoryId')
    data.categoryId = body.categoryId as number | null
  }

  if (body.priceDisplay !== undefined) {
    if (body.priceDisplay !== 'SHOW_PRICE' && body.priceDisplay !== 'ASK_FOR_PRICE') {
      return fail('Price display must be "Show price" or "Ask for price".', 'priceDisplay')
    }
    data.priceDisplay = body.priceDisplay
  }

  if (body.featured !== undefined) {
    if (typeof body.featured !== 'boolean') return fail('Featured must be true or false.', 'featured')
    data.featured = body.featured
  }

  return { ok: true, data }
}

export function parsePublishBody(body: unknown): Parsed<{ publish: boolean }> {
  if (!isPlainObject(body)) return fail('Invalid JSON body')
  const unknownKey = Object.keys(body).find((k) => k !== 'publish')
  if (unknownKey) return fail(`Unknown field "${unknownKey}"`)
  if (typeof body.publish !== 'boolean') return fail('"publish" must be true or false.')
  return { ok: true, data: { publish: body.publish } }
}

// ─── Lists of ids ──────────────────────────────────────────────────────────────

/** 1..max positive integer ids, without duplicates (order kept). */
export function parseIdList(v: unknown, label: string, max = BULK_MAX_IDS): Parsed<number[]> {
  if (!Array.isArray(v) || v.length === 0) return fail(`${label} must be a non-empty list.`)
  if (v.length > max) return fail(`${label} can have at most ${max} entries.`)
  if (!v.every(isPositiveInt)) return fail(`${label} must contain ids only.`)
  const ids = v as number[]
  if (new Set(ids).size !== ids.length) return fail(`${label} contains duplicates.`)
  return { ok: true, data: ids }
}

export type BulkAction =
  | { action: 'publish' | 'unpublish'; ids: number[] }
  | { action: 'set-category'; ids: number[]; categoryId: number }

export function parseBulkBody(body: unknown): Parsed<BulkAction> {
  if (!isPlainObject(body)) return fail('Invalid JSON body')
  const unknownKey = Object.keys(body).find((k) => !['action', 'ids', 'categoryId'].includes(k))
  if (unknownKey) return fail(`Unknown field "${unknownKey}"`)
  const ids = parseIdList(body.ids, 'ids')
  if (!ids.ok) return ids
  if (body.action === 'publish' || body.action === 'unpublish') {
    if (body.categoryId !== undefined) return fail('categoryId is only for "set-category".')
    return { ok: true, data: { action: body.action, ids: ids.data } }
  }
  if (body.action === 'set-category') {
    if (!isPositiveInt(body.categoryId)) return fail('Choose a category.', 'categoryId')
    return { ok: true, data: { action: 'set-category', ids: ids.data, categoryId: body.categoryId } }
  }
  return fail('action must be "publish", "unpublish" or "set-category".')
}

// ─── Gallery ───────────────────────────────────────────────────────────────────

/** Uploaded picture URLs ("/api/images/<32 hex>.webp") -> storage keys. */
export function parseImageUrls(body: unknown): Parsed<string[]> {
  if (!isPlainObject(body)) return fail('Invalid JSON body')
  const unknownKey = Object.keys(body).find((k) => k !== 'urls')
  if (unknownKey) return fail(`Unknown field "${unknownKey}"`)
  if (!Array.isArray(body.urls) || body.urls.length === 0) return fail('urls must be a non-empty list.')
  if (body.urls.length > GALLERY_MAX_IMAGES) return fail(`At most ${GALLERY_MAX_IMAGES} photos per product.`)
  const keys: string[] = []
  for (const url of body.urls) {
    const key = typeof url === 'string' ? imageKeyFromImageUrl(url) : null
    if (!key) return fail('Only photos uploaded here can be added.')
    if (!keys.includes(key)) keys.push(key)
  }
  return { ok: true, data: keys }
}

export function parseOrderBody(body: unknown, max: number): Parsed<number[]> {
  if (!isPlainObject(body)) return fail('Invalid JSON body')
  const unknownKey = Object.keys(body).find((k) => k !== 'order')
  if (unknownKey) return fail(`Unknown field "${unknownKey}"`)
  return parseIdList(body.order, 'order', max)
}

export type ImagePatch = { alt?: string | null; primary?: true }

export function parseImagePatch(body: unknown): Parsed<ImagePatch> {
  if (!isPlainObject(body)) return fail('Invalid JSON body')
  const unknownKey = Object.keys(body).find((k) => k !== 'alt' && k !== 'primary')
  if (unknownKey) return fail(`Unknown field "${unknownKey}"`)
  const data: ImagePatch = {}
  if (body.alt !== undefined) {
    const r = optionalText(body.alt, 'Alt text', ALT_TEXT_MAX, 'alt')
    if (!r.ok) return r
    data.alt = r.data
  }
  if (body.primary !== undefined) {
    if (body.primary !== true) return fail('"primary" can only be true. Make another photo primary instead.')
    data.primary = true
  }
  if (data.alt === undefined && !data.primary) return fail('Nothing to change.')
  return { ok: true, data }
}

// ─── Categories ────────────────────────────────────────────────────────────────

export type CategoryInput = {
  name?: string
  slug?: string
  description?: string | null
  /** Storage key from an uploaded picture URL, or null to clear. */
  heroImageKey?: string | null
  published?: boolean
}

const CATEGORY_FIELDS = ['name', 'slug', 'description', 'heroImageUrl', 'published'] as const

export function parseCategoryInput(body: unknown, { create }: { create: boolean }): Parsed<CategoryInput> {
  if (!isPlainObject(body)) return fail('Invalid JSON body')
  const unknownKey = checkKeys(body, CATEGORY_FIELDS, {})
  if (unknownKey) return fail(unknownKey)
  const data: CategoryInput = {}

  if (body.name !== undefined || create) {
    const r = optionalText(body.name ?? null, 'Name', CATEGORY_NAME_MAX, 'name')
    if (!r.ok) return r
    if (!r.data) return fail('Give the category a name.', 'name')
    data.name = r.data
  }
  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string' || body.slug.trim() === '') return fail('Web address (slug) cannot be empty.', 'slug')
    if (body.slug.length > 200) return fail('Web address (slug) is too long.', 'slug')
    data.slug = body.slug
  }
  if (body.description !== undefined) {
    const r = optionalText(body.description, 'Description', CATEGORY_DESCRIPTION_MAX, 'description')
    if (!r.ok) return r
    data.description = r.data
  }
  if (body.heroImageUrl !== undefined) {
    if (body.heroImageUrl === null || body.heroImageUrl === '') data.heroImageKey = null
    else {
      const key = typeof body.heroImageUrl === 'string' ? imageKeyFromImageUrl(body.heroImageUrl) : null
      if (!key) return fail('Only photos uploaded here can be used.', 'heroImageUrl')
      data.heroImageKey = key
    }
  }
  if (body.published !== undefined) {
    if (typeof body.published !== 'boolean') return fail('Published must be true or false.', 'published')
    data.published = body.published
  }
  return { ok: true, data }
}
