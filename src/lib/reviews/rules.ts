// ZP-508: customer review rules. Pure; safe on the client (the review form
// shows the same limits and the "Shown as" name) and the server.
//
// Owner decisions: only verified buyers (one-time link from the owner), stars
// + a plain-text comment (no threads), a shop rating as well as the piece
// rating, every review approved by the owner, no seeded or admin-authored
// reviews. Tested in tests/reviews-rules.test.ts. See docs/storefront/reviews.md.

export const REVIEW_COMMENT_MIN = 10
export const REVIEW_COMMENT_MAX = 1000
/** Longest name the customer may type (only "First L." is stored). */
export const REVIEW_NAME_MAX = 60
export const REVIEW_REPLY_MAX = 500
export const REVIEW_NOTE_MAX = 300
/** The owner's optional first-name hint on a link (prefills the form). */
export const CUSTOMER_HINT_MAX = 40
/** A review link works for this many days. */
export const REVIEW_INVITE_DAYS = 30

/** Phone photos are 2-8 MB; a bigger review photo is refused before decoding. */
export const REVIEW_PHOTO_MAX_BYTES = 10 * 1024 * 1024
/** Photo uploads one review link may make (each replaces the previous one). */
export const REVIEW_PHOTO_MAX_UPLOADS = 5
/** The review photo endpoint takes the link's token in this header (checked before the body is read). */
export const REVIEW_TOKEN_HEADER = 'x-review-token'

/** What the public page and API say about a link that is not open. */
export const LINK_MESSAGES = {
  invalid: 'This review link is not valid.',
  expired: 'This review link has expired.',
  used: 'This review link has already been used.',
} as const

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'HIDDEN'

export type ValidReview = {
  stars: number
  /** Shop stars given alongside a piece review; always null for a shop-only review. */
  shopStars: number | null
  comment: string
  /** "Tendai M." */
  displayName: string
  /** "Tendai", for the thank-you screen only (not stored). */
  firstName: string
  /** Attach the photo uploaded with this link. */
  photo: boolean
  /** "VYRA may show this photo with my review". False whenever photo is false. */
  photoConsent: boolean
}

export type FieldErrors = Record<string, string>
export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors }

// ------------------------------------------------------------------ text

/** C0/C1 control characters except newline and tab, plus bidi overrides and zero-width characters. */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g

/**
 * A comment as stored: Unicode NFC, \r\n -> \n, tabs -> spaces, control and
 * invisible characters dropped, trailing spaces per line removed, at most one
 * blank line in a row, trimmed. It stays plain text: nothing is parsed as
 * HTML or links; the storefront renders it escaped (React text).
 */
export function normaliseComment(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL, '')
    .replace(/[  ]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** One-line text: control characters dropped, whitespace collapsed, trimmed. */
function oneLine(raw: string): string {
  return raw.normalize('NFC').replace(CONTROL, '').replace(/\s+/g, ' ').trim()
}

// ------------------------------------------------------------------ names

/** Anything that is not a letter, combining mark, apostrophe or hyphen separates name parts. */
const NAME_SEPARATOR = /[^\p{L}\p{M}'’-]+/gu

function nameParts(raw: string): string[] {
  return raw
    .normalize('NFC')
    .replace(NAME_SEPARATOR, ' ')
    .split(' ')
    .map((p) => p.replace(/^['’-]+|['’-]+$/g, ''))
    .filter((p) => /\p{L}/u.test(p))
}

const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase('en') + s.slice(1)

/** First name (capitalised, at most 30 characters), or null. */
export function firstNameOf(raw: string): string | null {
  const first = nameParts(raw)[0]
  return first ? capitalise(first.slice(0, 30)) : null
}

/**
 * The public name: first name + initial of the last name ("Tendai M."), or
 * just the first name. Digits, symbols and markup are dropped (a phone
 * number typed by mistake never shows). Null when no letters are left.
 */
export function deriveDisplayName(raw: string): string | null {
  const parts = nameParts(raw)
  const first = firstNameOf(raw)
  if (!first) return null
  if (parts.length < 2) return first
  const initial = Array.from(parts[parts.length - 1])[0]
  return `${first} ${initial.toLocaleUpperCase('en')}.`
}

// -------------------------------------------------------------- profanity

/**
 * A short word list (English, plus common masked spellings). A match only
 * FLAGS the review for the owner; it never blocks or edits it. Whole words
 * only, so "Scunthorpe" or "assessment" do not match.
 */
const PROFANITY = [
  'fuck', 'fucking', 'fucked', 'f\\*ck', 'f\\*\\*k', 'shit', 'shitty', 'sh\\*t', 'bullshit', 'bitch', 'bastard',
  'asshole', 'arsehole', 'cunt', 'dick', 'dickhead', 'piss', 'pissed', 'crap', 'whore', 'slut', 'wanker', 'twat',
  'motherfucker', 'scam', 'scammer', 'scammers',
]
const PROFANITY_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${PROFANITY.join('|')})(?![\\p{L}\\p{N}])`, 'iu')

export function containsProfanity(text: string): boolean {
  return PROFANITY_RE.test(text)
}

// ------------------------------------------------------------- validation

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStars = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5

const SUBMISSION_FIELDS = new Set(['token', 'stars', 'shopStars', 'comment', 'name', 'photo', 'photoConsent'])

/**
 * Validate the public review form. `token` may be present (it is checked
 * elsewhere); any other unknown field is an error, so a client can never set
 * status, displayName, product or the like.
 */
export function validateReviewSubmission(
  input: unknown,
  ctx: { shopOnly: boolean; photoUploaded: boolean },
): Result<ValidReview> {
  if (!isObject(input)) return { ok: false, errors: { form: 'Expected a review.' } }
  const errors: FieldErrors = {}
  for (const key of Object.keys(input)) if (!SUBMISSION_FIELDS.has(key)) errors[key] = 'Unexpected field.'

  if (!isStars(input.stars)) errors.stars = 'Choose from 1 to 5 stars.'

  let shopStars: number | null = null
  if (!ctx.shopOnly && input.shopStars !== undefined && input.shopStars !== null) {
    if (isStars(input.shopStars)) shopStars = input.shopStars
    else errors.shopStars = 'Choose from 1 to 5 stars, or leave it empty.'
  }

  let comment = ''
  if (typeof input.comment !== 'string') errors.comment = 'Tell other shoppers about it.'
  else {
    comment = normaliseComment(input.comment)
    const len = Array.from(comment).length
    if (len < REVIEW_COMMENT_MIN) errors.comment = `At least ${REVIEW_COMMENT_MIN} characters, please.`
    else if (len > REVIEW_COMMENT_MAX) errors.comment = `At most ${REVIEW_COMMENT_MAX} characters, please.`
  }

  let displayName: string | null = null
  let firstName: string | null = null
  if (typeof input.name !== 'string' || input.name.trim() === '') errors.name = 'Your first name, please.'
  else if (input.name.length > REVIEW_NAME_MAX) errors.name = `At most ${REVIEW_NAME_MAX} characters.`
  else {
    displayName = deriveDisplayName(input.name)
    firstName = firstNameOf(input.name)
    if (!displayName || !firstName) errors.name = 'Please use letters for your name.'
  }

  const photo = input.photo ?? false
  const consent = input.photoConsent ?? false
  if (typeof photo !== 'boolean') errors.photo = 'Invalid value.'
  else if (photo && ctx.shopOnly) errors.photo = 'A photo can only be added to a piece review.'
  else if (photo && !ctx.photoUploaded) errors.photo = 'The photo did not upload. Please choose it again.'
  if (typeof consent !== 'boolean') errors.photoConsent = 'Invalid value.'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      stars: input.stars as number,
      shopStars,
      comment,
      displayName: displayName as string,
      firstName: firstName as string,
      photo: photo as boolean,
      photoConsent: (photo as boolean) && (consent as boolean),
    },
  }
}

/** The owner's optional first-name hint on a new link. */
export function validateCustomerHint(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'The name must be text.' }
  const value = oneLine(raw)
  if (value.length > CUSTOMER_HINT_MAX) return { ok: false, error: `At most ${CUSTOMER_HINT_MAX} characters.` }
  return { ok: true, value: value || null }
}

// ------------------------------------------------------------- moderation

export type ModerationAction =
  | { type: 'approve' }
  | { type: 'hide'; note: string | null }
  | { type: 'unpublish' }
  | { type: 'reply'; reply: string | null }

/**
 * PATCH /api/website/reviews/:id body. approve (PENDING/HIDDEN -> APPROVED),
 * hide with an optional private note (-> HIDDEN), unpublish (APPROVED ->
 * PENDING, back in the queue), reply (set or, with an empty reply, remove
 * the public "Reply from VYRA"). There is deliberately no way to change the
 * stars, comment or name.
 */
export function parseModerationAction(body: unknown): { ok: true; value: ModerationAction } | { ok: false; error: string } {
  if (!isObject(body)) return { ok: false, error: 'Expected an action.' }
  switch (body.action) {
    case 'approve':
      return { ok: true, value: { type: 'approve' } }
    case 'unpublish':
      return { ok: true, value: { type: 'unpublish' } }
    case 'hide': {
      if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') return { ok: false, error: 'The note must be text.' }
      const note = typeof body.note === 'string' ? normaliseComment(body.note) : ''
      if (note.length > REVIEW_NOTE_MAX) return { ok: false, error: `The note can be at most ${REVIEW_NOTE_MAX} characters.` }
      return { ok: true, value: { type: 'hide', note: note || null } }
    }
    case 'reply': {
      if (body.reply !== undefined && body.reply !== null && typeof body.reply !== 'string') return { ok: false, error: 'The reply must be text.' }
      const reply = typeof body.reply === 'string' ? normaliseComment(body.reply) : ''
      if (reply.length > REVIEW_REPLY_MAX) return { ok: false, error: `The reply can be at most ${REVIEW_REPLY_MAX} characters.` }
      return { ok: true, value: { type: 'reply', reply: reply || null } }
    }
    default:
      return { ok: false, error: 'Unknown action.' }
  }
}
