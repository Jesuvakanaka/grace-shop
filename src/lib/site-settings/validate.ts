// ZP-486: pure validation of site settings input (the PUT body / admin form).
// No database, no Next.js: safe to import from client components.
//
// validateSiteSettingsInput(input) accepts a PARTIAL object: only the fields
// present are validated and returned (a partial update). Unknown fields are
// errors, so the allow-list is EDITABLE_FIELDS. Every error is collected, keyed
// by field name ("openingHours.mon" for one day of the week, "_form" for the
// body as a whole).
import { isValidImageKey } from '@/lib/storage/keys'
import {
  DAYS,
  EDITABLE_FIELDS,
  FEW_LEFT_MAX,
  FEW_LEFT_MIN,
  MAX_LENGTH,
  SOCIAL_DOMAINS,
  TEMPLATE_PLACEHOLDERS,
  type DayHours,
  type OpeningHours,
  type SiteSettingsData,
  type SiteSettingsField,
} from './schema'

export type FieldErrors = Record<string, string>
export type ValidationResult = { ok: true; value: Partial<SiteSettingsData> } | { ok: false; errors: FieldErrors }

const E164 = /^\+[1-9]\d{7,14}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[0-9][0-9 ()-]{5,28}[0-9]$/

/** "+263 77 123-4567" -> "+263771234567". Null unless it is E.164 (8 to 15 digits). */
export function normalizeE164(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, '')
  return E164.test(compact) ? compact : null
}

/** An absolute https URL with a host and no credentials. With `domains`, the host must be one of them or a subdomain. */
export function isHttpsUrl(value: string, domains?: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return false
  if (!domains) return true
  const host = url.hostname.toLowerCase()
  return domains.some((d) => host === d || host.endsWith(`.${d}`))
}

export function validateOpeningHours(
  value: unknown,
): { ok: true; value: OpeningHours } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: { openingHours: 'Opening hours must list every day of the week.' } }
  }
  const input = value as Record<string, unknown>
  const unknown = Object.keys(input).filter((k) => !(DAYS as readonly string[]).includes(k))
  if (unknown.length) errors.openingHours = `Unknown day(s): ${unknown.join(', ')}`

  const out = {} as OpeningHours
  for (const day of DAYS) {
    const key = `openingHours.${day}`
    const d = input[day] as Record<string, unknown> | undefined
    if (typeof d !== 'object' || d === null || Array.isArray(d)) {
      errors[key] = 'Set opening and closing times, or mark the day closed.'
      continue
    }
    if (d.closed === true) {
      out[day] = { closed: true }
      continue
    }
    if (d.closed !== false) {
      errors[key] = 'Choose open or closed.'
      continue
    }
    const { open, close } = d
    if (typeof open !== 'string' || typeof close !== 'string' || !TIME.test(open) || !TIME.test(close)) {
      errors[key] = 'Use 24-hour times like 09:00 and 17:30.'
      continue
    }
    if (close <= open) {
      errors[key] = 'Closing time must be after opening time.'
      continue
    }
    out[day] = { closed: false, open, close } satisfies DayHours
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: out }
}

type Check = (value: unknown) => { value: unknown } | { error: string }

const fail = (error: string) => ({ error })

/** Required text: trimmed, not blank, at most `max` characters. */
const requiredText =
  (max: number): Check =>
  (v) => {
    if (typeof v !== 'string') return fail('Must be text.')
    const t = v.trim()
    if (!t) return fail('This field is required.')
    if (t.length > max) return fail(`At most ${max} characters.`)
    return { value: t }
  }

/** Optional text: null / "" / blank clear it; otherwise trimmed, then `inner`. */
const optional =
  (inner: Check): Check =>
  (v) => {
    if (v === null || v === undefined) return { value: null }
    if (typeof v !== 'string') return fail('Must be text.')
    if (!v.trim()) return { value: null }
    return inner(v.trim())
  }

const text = (max: number): Check => optional(requiredText(max))

const httpsUrl = (domains?: readonly string[]): Check =>
  optional((v) => {
    const s = v as string
    if (s.length > MAX_LENGTH.url) return fail(`At most ${MAX_LENGTH.url} characters.`)
    if (!isHttpsUrl(s)) return fail('Must be a full https:// link.')
    if (domains && !isHttpsUrl(s, domains)) return fail(`Must be a link on ${domains.join(' or ')}.`)
    return { value: s }
  })

const template: Check = (v) => {
  const r = requiredText(MAX_LENGTH.enquiryTemplate)(v)
  if ('error' in r) return r
  const unknown = [...(r.value as string).matchAll(/\{([^{}]*)\}/g)]
    .map((m) => m[1])
    .filter((p) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(p))
  if (unknown.length) {
    return fail(`Unknown placeholder {${unknown[0]}}. Use ${TEMPLATE_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`)
  }
  return r
}

const imageKey: Check = (v) => {
  if (v === null || v === undefined || v === '') return { value: null }
  return isValidImageKey(v) ? { value: v } : fail('Upload a picture with the picker.')
}

const coordinate =
  (min: number, max: number): Check =>
  (v) => {
    if (v === null || v === undefined || v === '') return { value: null }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return fail(`Must be a number from ${min} to ${max}.`)
    return { value: v }
  }

const CHECKS: Record<Exclude<SiteSettingsField, 'openingHours'>, Check> = {
  whatsappNumber: optional((v) => {
    const n = normalizeE164(v as string)
    return n ? { value: n } : fail('Use the international format, e.g. +263 77 123 4567.')
  }),
  enquiryTemplate: template,
  generalEnquiryMessage: requiredText(MAX_LENGTH.generalEnquiryMessage),
  phone: optional((v) => (PHONE.test(v as string) ? { value: v } : fail('Use digits, spaces, ( ) and -, e.g. +263 242 123 456.'))),
  email: optional((v) => {
    const s = v as string
    if (s.length > MAX_LENGTH.email || !EMAIL.test(s)) return fail('Enter a valid email address.')
    return { value: s }
  }),
  address: text(MAX_LENGTH.address),
  holidayNote: text(MAX_LENGTH.holidayNote),
  mapUrl: httpsUrl(),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
  instagramUrl: httpsUrl(SOCIAL_DOMAINS.instagramUrl),
  facebookUrl: httpsUrl(SOCIAL_DOMAINS.facebookUrl),
  tiktokUrl: httpsUrl(SOCIAL_DOMAINS.tiktokUrl),
  aboutHeadline: text(MAX_LENGTH.aboutHeadline),
  aboutStory: text(MAX_LENGTH.aboutStory),
  aboutImageKey: imageKey,
  heroHeadline: requiredText(MAX_LENGTH.heroHeadline),
  heroSubline: requiredText(MAX_LENGTH.heroSubline),
  heroImageKeyDesktop: imageKey,
  heroImageKeyMobile: imageKey,
  statement: requiredText(MAX_LENGTH.statement),
  trustLabel1: requiredText(MAX_LENGTH.trustLabel),
  trustLabel2: requiredText(MAX_LENGTH.trustLabel),
  trustLabel3: requiredText(MAX_LENGTH.trustLabel),
  seoTitle: requiredText(MAX_LENGTH.seoTitle),
  seoDescription: requiredText(MAX_LENGTH.seoDescription),
  seoShareImageKey: imageKey,
  fewLeftThreshold: (v) =>
    Number.isInteger(v) && (v as number) >= FEW_LEFT_MIN && (v as number) <= FEW_LEFT_MAX
      ? { value: v }
      : fail(`Must be a whole number from ${FEW_LEFT_MIN} to ${FEW_LEFT_MAX}.`),
  showItemNumber: (v) => (typeof v === 'boolean' ? { value: v } : fail('Must be on or off.')),
}

export function validateSiteSettingsInput(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: { _form: 'Expected a JSON object of settings.' } }
  }
  const body = input as Record<string, unknown>
  const errors: FieldErrors = {}
  const value: Record<string, unknown> = {}

  for (const key of Object.keys(body)) {
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) errors[key] = 'Unknown field.'
  }

  for (const field of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    const raw = body[field]
    if (field === 'openingHours') {
      if (raw === null) {
        value.openingHours = null
        continue
      }
      const r = validateOpeningHours(raw)
      if (r.ok) value.openingHours = r.value
      else Object.assign(errors, r.errors)
      continue
    }
    const r = CHECKS[field](raw)
    if ('error' in r) errors[field] = r.error
    else value[field] = r.value
  }

  // A map pin needs both coordinates.
  const hasLat = Object.prototype.hasOwnProperty.call(body, 'latitude')
  const hasLng = Object.prototype.hasOwnProperty.call(body, 'longitude')
  if (hasLat !== hasLng) {
    errors[hasLat ? 'longitude' : 'latitude'] = 'Enter both latitude and longitude, or neither.'
  } else if (hasLat && !errors.latitude && !errors.longitude && (value.latitude === null) !== (value.longitude === null)) {
    errors[value.latitude === null ? 'latitude' : 'longitude'] = 'Enter both latitude and longitude, or neither.'
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: value as Partial<SiteSettingsData> }
}
