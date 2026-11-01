// ZP-493: first-party analytics, the event catalogue. Pure; shared by the
// browser tracker (./client-core.ts) and the endpoint (./ingest.ts).
//
// The allow-list is strict: an event with an unknown type, an unknown field or
// prop, a wrong type, a value out of range or too long is invalid. The client
// runs validateEvent before queueing (and drops what fails); the server drops
// invalid events one by one and answers 400 only for a bad envelope.
// Nothing free-form is accepted (no names, numbers, messages, URLs with a
// query). See docs/storefront/analytics.md for the catalogue in prose.
import { isValidSlug } from '@/lib/storefront-model/slug'

/** Most events in one POST (the client's flush size). */
export const MAX_BATCH_EVENTS = 20
/** Wire format version. */
export const BATCH_VERSION = 1
/** Client timestamps further off than this are replaced by the server time. */
export const MAX_CLOCK_PAST_MS = 24 * 3_600_000
export const MAX_CLOCK_FUTURE_MS = 5 * 60_000

/** Analytics days are calendar days in Harare (the shop's time zone, UTC+2, no DST). */
export const ANALYTICS_TIME_ZONE = 'Africa/Harare'

export const REFERRER_BUCKETS = ['instagram', 'tiktok', 'whatsapp', 'facebook', 'google', 'direct', 'other'] as const
export type ReferrerBucket = (typeof REFERRER_BUCKETS)[number]
export const DEVICE_CLASSES = ['phone', 'tablet', 'desktop'] as const
export type DeviceClass = (typeof DEVICE_CLASSES)[number]
/** Where a button was tapped. */
export const SCREENS = ['feed', 'product', 'menu', 'visit', 'about', 'collection', 'shop', 'new', 'other'] as const
export type Screen = (typeof SCREENS)[number]
/** How a product page was reached. */
export const PRODUCT_OPEN_SOURCES = ['feed', 'collection', 'shop', 'new', 'related', 'shared', 'other'] as const
export const SHARE_METHODS = ['native', 'copy', 'whatsapp', 'facebook', 'other'] as const
export const LOAD_ERROR_KINDS = ['image', 'video', 'feed', 'page', 'other'] as const
export const VIDEO_PROGRESS_STEPS = [25, 50, 75, 100] as const
/** ZP-510: how the feed's details sheet was closed (drag down, backdrop tap, ✕, browser / Android back, Escape; ZP-513: also_like = a "You may also like" piece tapped). */
export const SHEET_CLOSE_REASONS = ['swipe', 'backdrop', 'button', 'back', 'escape', 'also_like'] as const

export const ANALYTICS_EVENT_TYPES = [
  // Visit
  'visit_start',
  'visit_end',
  // Feed: attention
  'look_view',
  'look_dwell',
  'photo_view',
  'photo_dwell',
  'video_start',
  'video_progress',
  'video_replay',
  'video_seconds',
  'details_show',
  'details_hide',
  'collection_switch',
  'feed_load_more',
  'feed_end_reached',
  // Intent
  'product_open',
  'size_select',
  'colour_select',
  'whatsapp_enquire',
  'restock_request',
  'call',
  'share',
  'directions',
  'visit_us',
  'gallery_zoom',
  // Guide (ZP-509)
  'guide_shown',
  'guide_step',
  'guide_skipped',
  'guide_completed',
  'guide_replayed',
  // Hearts (ZP-507)
  'love_on',
  'love_off',
  // Details sheet (ZP-510)
  'details_sheet_open',
  'details_sheet_close',
  // Details card (ZP-513)
  'size_guide_open',
  'also_like_open',
  // Health
  'load_error',
  'slow_load',
  'action_failed',
] as const
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number]
const EVENT_TYPE_SET = new Set<string>(ANALYTICS_EVENT_TYPES)

export function isAnalyticsEventType(value: unknown): value is AnalyticsEventType {
  return typeof value === 'string' && EVENT_TYPE_SET.has(value)
}

// ------------------------------------------------------------ prop schema

type Field =
  | { kind: 'int'; min: number; max: number }
  | { kind: 'num'; min: number; max: number }
  | { kind: 'enum'; values: readonly (string | number)[] }
  | { kind: 'text'; max: number }
  | { kind: 'token'; max: number }
  | { kind: 'bool' }
  | { kind: 'path' }
  | { kind: 'host' }
  | { kind: 'lang' }
  | { kind: 'image' }
  | { kind: 'collection' }
  | { kind: 'eventType' }
  | { kind: 'slug' }
type PropSpec = Field & { optional?: boolean }
export type EventSpec = {
  /** Whether the event names a piece (envelope `slug`). Required slugs must be published pieces. */
  slug: 'required' | 'optional' | 'none'
  props: Readonly<Record<string, PropSpec>>
}

const int = (min: number, max: number): Field => ({ kind: 'int', min, max })
const num = (min: number, max: number): Field => ({ kind: 'num', min, max })
const oneOf = (values: readonly (string | number)[]): Field => ({ kind: 'enum', values })
const text = (max: number): Field => ({ kind: 'text', max })
const token = (max: number): Field => ({ kind: 'token', max })
const bool: Field = { kind: 'bool' }
const path: Field = { kind: 'path' }
const host: Field = { kind: 'host' }
const lang: Field = { kind: 'lang' }
const image: Field = { kind: 'image' }
const collection: Field = { kind: 'collection' }
const eventType: Field = { kind: 'eventType' }
/** ZP-513: another piece's slug as a prop (also_like_open `to`). */
const slugProp: Field = { kind: 'slug' }
const opt = (f: Field): PropSpec => ({ ...f, optional: true })

const PHOTO = { index: int(1, 50), of: int(1, 50), image: opt(image) }
const SECONDS_DWELL = num(0.5, 60)

/** The allow-list: every event type and exactly the props it may carry. */
export const EVENT_SPECS: Readonly<Record<AnalyticsEventType, EventSpec>> = {
  visit_start: {
    slug: 'none',
    props: {
      ref: oneOf(REFERRER_BUCKETS),
      refDomain: opt(host),
      campaign: opt(token(40)),
      device: oneOf(DEVICE_CLASSES),
      vw: int(0, 20_000),
      vh: int(0, 20_000),
      lang: opt(lang),
      landing: path,
      returning: bool,
    },
  },
  // slug = the last look seen. duration = visible seconds since the visit started.
  visit_end: { slug: 'optional', props: { duration: num(0, 86_400), looks: int(0, 100_000), last: opt(eventType) } },

  look_view: { slug: 'required', props: { position: opt(int(0, 10_000)) } },
  look_dwell: { slug: 'required', props: { seconds: SECONDS_DWELL } },
  photo_view: { slug: 'required', props: PHOTO },
  photo_dwell: { slug: 'required', props: { ...PHOTO, seconds: SECONDS_DWELL } },
  video_start: { slug: 'required', props: {} },
  video_progress: { slug: 'required', props: { pct: oneOf(VIDEO_PROGRESS_STEPS) } },
  video_replay: { slug: 'required', props: {} },
  video_seconds: { slug: 'required', props: { seconds: num(0, 600) } },
  details_show: { slug: 'required', props: {} },
  details_hide: { slug: 'required', props: {} },
  collection_switch: { slug: 'none', props: { from: collection, to: collection } },
  feed_load_more: { slug: 'none', props: { loaded: opt(int(0, 10_000)) } },
  feed_end_reached: { slug: 'none', props: { looks: opt(int(0, 10_000)) } },

  product_open: { slug: 'required', props: { from: oneOf(PRODUCT_OPEN_SOURCES) } },
  size_select: { slug: 'required', props: { size: text(24) } },
  colour_select: { slug: 'required', props: { colour: text(32) } },
  whatsapp_enquire: { slug: 'optional', props: { size: opt(text(24)), colour: opt(text(32)), screen: oneOf(SCREENS) } },
  restock_request: { slug: 'required', props: { size: opt(text(24)), screen: opt(oneOf(SCREENS)) } },
  call: { slug: 'optional', props: { screen: opt(oneOf(SCREENS)) } },
  share: { slug: 'optional', props: { method: oneOf(SHARE_METHODS), screen: opt(oneOf(SCREENS)) } },
  directions: { slug: 'none', props: { screen: opt(oneOf(SCREENS)) } },
  visit_us: { slug: 'none', props: { screen: opt(oneOf(SCREENS)) } },
  gallery_zoom: { slug: 'required', props: { index: opt(int(1, 50)) } },

  guide_shown: { slug: 'none', props: {} },
  guide_step: { slug: 'none', props: { step: int(1, 20) } },
  guide_skipped: { slug: 'none', props: { step: opt(int(1, 20)) } },
  guide_completed: { slug: 'none', props: {} },
  guide_replayed: { slug: 'none', props: {} },

  love_on: { slug: 'required', props: {} },
  love_off: { slug: 'required', props: {} },

  // ZP-510: the rollup counts details_sheet_open as a product_open (funnel "opened a piece").
  // ZP-512: from 'shared' = the landing of a /p/<slug> link (the old product page URL).
  details_sheet_open: { slug: 'required', props: { from: opt(oneOf(['shared'])) } },
  details_sheet_close: { slug: 'required', props: { reason: oneOf(SHEET_CLOSE_REASONS) } },
  // ZP-513: the card's size guide opened; a 'You may also like' piece tapped (slug = the open piece, to = the tapped one).
  size_guide_open: { slug: 'required', props: {} },
  also_like_open: { slug: 'required', props: { to: slugProp } },

  load_error: { slug: 'optional', props: { what: oneOf(LOAD_ERROR_KINDS) } },
  slow_load: { slug: 'none', props: { lcp: int(0, 600_000) } }, // milliseconds
  action_failed: { slug: 'optional', props: { action: token(40) } },
}

// --------------------------------------------------------------- formats

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
/** Path only: no scheme, host, query or fragment. Percent-encoding allowed. */
const PATH = /^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/]*$/
export const PAGE_MAX_LENGTH = 200
const HOST = /^(?=.{1,100}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
const LANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,2}$/
/** Tags (campaign, action): lowercase letters, digits, "-" and "_". */
const TOKEN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/
const IMAGE_NAME = /^[a-f0-9]{32}\.webp$/
/** C0 / C1 control characters and the Unicode line / paragraph separators (U+2028, U+2029). */
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]')

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value)
}

export function isPagePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= PAGE_MAX_LENGTH && PATH.test(value)
}

/**
 * ZP-508: paths that carry a secret. /review/<token> (one-time review link,
 * also under /site) is stored as "/review" only, on the client (normalizePage)
 * AND again on the server (validateEvent), so a live token never reaches
 * AnalyticsEvent, whatever a client sends.
 */
const PRIVATE_PATH = /^(?:\/site)?\/review(?:[/?#]|$)/i

export function isPrivatePagePath(pathname: string): boolean {
  return PRIVATE_PATH.test(pathname)
}

export function redactPrivatePath(path: string): string {
  return isPrivatePagePath(path) ? '/review' : path
}

/** Feed collection keys: "new" (New in) or a category slug. */
export function isCollectionKey(value: unknown): value is string {
  return typeof value === 'string' && (value === 'new' || isValidSlug(value))
}

// ------------------------------------------------------------ validation

export type PropValue = string | number | boolean
export type ValidEvent = {
  /** Client-made UUID; the server stores each id once. */
  id: string
  type: AnalyticsEventType
  occurredAt: Date
  page: string | null
  slug: string | null
  collection: string | null
  props: Record<string, PropValue>
}
export type ValidBatch = {
  ok: true
  visitId: string
  deviceId: string | null
  /** The valid events, in order. */
  events: ValidEvent[]
  /** How many invalid events were dropped. */
  dropped: number
  /** The first few reasons (debugging; never echoed to the client). */
  errors: string[]
}
export type BatchResult = ValidBatch | { ok: false; error: string }

/** Zero-width space / joiners, word joiner, BOM: invisible, stripped from text before validating. */
const ZERO_WIDTH = /[​-‍⁠﻿]/g

/** Text as validated: zero-width characters removed, trimmed. */
export function cleanText(value: string): string {
  return value.replace(ZERO_WIDTH, '').trim()
}

const BATCH_KEYS = new Set(['v', 'visit', 'device', 'events'])
const EVENT_KEYS = new Set(['id', 'type', 'at', 'page', 'slug', 'collection', 'props'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const round2 = (n: number) => Math.round(n * 100) / 100

function checkField(field: Field, value: unknown): PropValue | undefined {
  switch (field.kind) {
    case 'int':
      return typeof value === 'number' && Number.isInteger(value) && value >= field.min && value <= field.max ? value : undefined
    case 'num':
      return typeof value === 'number' && Number.isFinite(value) && value >= field.min && value <= field.max
        ? round2(value)
        : undefined
    case 'enum':
      return (typeof value === 'string' || typeof value === 'number') && field.values.includes(value) ? value : undefined
    case 'text': {
      if (typeof value !== 'string') return undefined
      const v = cleanText(value)
      return v.length > 0 && v.length <= field.max && !CONTROL.test(v) ? v : undefined
    }
    case 'token':
      return typeof value === 'string' && value.length <= field.max && TOKEN.test(value) ? value : undefined
    case 'bool':
      return typeof value === 'boolean' ? value : undefined
    case 'path':
      return isPagePath(value) ? redactPrivatePath(value) : undefined
    case 'host':
      return typeof value === 'string' && HOST.test(value) ? value : undefined
    case 'lang':
      return typeof value === 'string' && value.length <= 16 && LANG.test(value) ? value : undefined
    case 'image':
      return typeof value === 'string' && IMAGE_NAME.test(value) ? value : undefined
    case 'collection':
      return isCollectionKey(value) ? value : undefined
    case 'eventType':
      return isAnalyticsEventType(value) ? value : undefined
    case 'slug':
      return typeof value === 'string' && isValidSlug(value) ? value : undefined
  }
}

/**
 * Validate one event against the allow-list. Returns the normalised event,
 * or the reason it is invalid. Shared: the browser tracker runs it before
 * queueing, the server before storing. `now` is the validating side's clock.
 */
export function validateEvent(raw: unknown, now: Date): ValidEvent | string {
  if (!isPlainObject(raw)) return 'event is not an object'
  for (const key of Object.keys(raw)) if (!EVENT_KEYS.has(key)) return `unknown field "${key.slice(0, 32)}"`

  const type = raw.type
  if (!isAnalyticsEventType(type)) return 'unknown type'
  const where = type
  const spec = EVENT_SPECS[type]

  if (!isUuidV4(raw.id)) return `${where}: id must be a v4 UUID`
  const id = raw.id

  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return `${where}: at must be a timestamp`
  const nowMs = now.getTime()
  const at = raw.at >= nowMs - MAX_CLOCK_PAST_MS && raw.at <= nowMs + MAX_CLOCK_FUTURE_MS ? Math.round(raw.at) : nowMs

  let page: string | null = null
  if (raw.page !== undefined) {
    if (!isPagePath(raw.page)) return `${where}: bad page`
    page = redactPrivatePath(raw.page)
  }

  let slug: string | null = null
  if (raw.slug !== undefined) {
    if (spec.slug === 'none') return `${where}: ${type} takes no slug`
    if (typeof raw.slug !== 'string' || !isValidSlug(raw.slug)) return `${where}: bad slug`
    slug = raw.slug
  } else if (spec.slug === 'required') {
    return `${where}: ${type} needs a slug`
  }

  let coll: string | null = null
  if (raw.collection !== undefined) {
    if (!isCollectionKey(raw.collection)) return `${where}: bad collection`
    coll = raw.collection
  }

  const rawProps = raw.props === undefined ? {} : raw.props
  if (!isPlainObject(rawProps)) return `${where}: props must be an object`
  const props: Record<string, PropValue> = {}
  for (const key of Object.keys(rawProps)) {
    if (!Object.prototype.hasOwnProperty.call(spec.props, key)) return `${where}: ${type} has no prop "${key.slice(0, 32)}"`
  }
  for (const [key, field] of Object.entries(spec.props)) {
    const value = rawProps[key]
    if (value === undefined) {
      if (field.optional) continue
      return `${where}: ${type} needs ${key}`
    }
    const checked = checkField(field, value)
    if (checked === undefined) return `${where}: bad ${key}`
    props[key] = checked
  }
  if ((type === 'photo_view' || type === 'photo_dwell') && (props.index as number) > (props.of as number)) {
    return `${where}: bad index (more than of)`
  }

  return { id, type, occurredAt: new Date(at), page, slug, collection: coll, props }
}

/**
 * Validate one POSTed batch. `now` is the server's receive time. A bad
 * envelope (not an object, unknown field, version, ids, no events, more than
 * MAX_BATCH_EVENTS) rejects the batch; invalid events are dropped one by one.
 */
export function validateBatch(input: unknown, now: Date): BatchResult {
  if (!isPlainObject(input)) return { ok: false, error: 'Body must be a JSON object' }
  for (const key of Object.keys(input)) if (!BATCH_KEYS.has(key)) return { ok: false, error: `Unknown field "${key.slice(0, 32)}"` }
  if (input.v !== BATCH_VERSION) return { ok: false, error: 'Unsupported version' }
  if (!isUuidV4(input.visit)) return { ok: false, error: 'Bad visit id' }
  if (input.device !== undefined && !isUuidV4(input.device)) return { ok: false, error: 'Bad device id' }
  if (!Array.isArray(input.events) || input.events.length === 0) return { ok: false, error: 'events must be a non-empty list' }
  if (input.events.length > MAX_BATCH_EVENTS) return { ok: false, error: `At most ${MAX_BATCH_EVENTS} events per batch` }

  const events: ValidEvent[] = []
  const errors: string[] = []
  let dropped = 0
  for (let i = 0; i < input.events.length; i += 1) {
    const result = validateEvent(input.events[i], now)
    if (typeof result === 'string') {
      dropped += 1
      if (errors.length < 3) errors.push(`events[${i}]: ${result}`)
    } else {
      events.push(result)
    }
  }
  return { ok: true, visitId: input.visit, deviceId: (input.device as string | undefined) ?? null, events, dropped, errors }
}

// ------------------------------------------------------------------ days

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The analytics day ("YYYY-MM-DD", Harare) of an instant. */
export function analyticsDay(at: Date): string {
  return DAY_FORMAT.format(at)
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar date "YYYY-MM-DD". */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DAY.exec(value)
  if (!m) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** "YYYY-MM-DD" -> the Date Prisma stores in a @db.Date column (midnight UTC). */
export function dayToDate(day: string): Date {
  if (!isDay(day)) throw new Error(`Not a date: ${day}`)
  return new Date(`${day}T00:00:00Z`)
}

/** Add whole days to "YYYY-MM-DD". */
export function addDays(day: string, n: number): string {
  const d = dayToDate(day)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
