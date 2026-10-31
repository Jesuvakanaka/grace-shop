// Slugs for public product and category URLs (ZP-482). Pure.

export const SLUG_MAX_LENGTH = 80
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FALLBACK_SLUG = 'product'

/**
 * Words the public site or admin may use as path segments, so they can
 * never be a product or category slug. Generated slugs get a suffix
 * ("new-2"); a slug typed by hand is refused.
 */
export const RESERVED_SLUGS: readonly string[] = Object.freeze([
  'new',
  'edit',
  'preview',
  'admin',
  'api',
  'site',
  'search',
  'categories',
  'collections',
  'shop',
  'p',
])
const RESERVED = new Set(RESERVED_SLUGS)

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug)
}

// Letters that NFKD does not decompose into ASCII + combining marks.
const FOLD: Record<string, string> = {
  ß: 'ss', ẞ: 'ss', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ø: 'o', Ø: 'o',
  ł: 'l', Ł: 'l', đ: 'd', Đ: 'd', ð: 'd', Ð: 'd', þ: 'th', Þ: 'th', ı: 'i',
}
const FOLD_PATTERN = new RegExp(`[${Object.keys(FOLD).join('')}]`, 'g')

/**
 * Lowercase ASCII words joined by single hyphens, at most SLUG_MAX_LENGTH
 * characters. Accents are folded ("Crème" -> "creme", "straße" ->
 * "strasse"); apostrophes are dropped ("Women's" -> "womens"); other
 * characters become word breaks. Returns "" when nothing usable is left
 * (e.g. a name in Chinese only). Reserved words are NOT removed here; see
 * uniqueSlug and planSlugChange.
 */
export function slugify(name: string): string {
  const slug = String(name ?? '')
    .replace(FOLD_PATTERN, (c) => FOLD[c])
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return trimToLength(slug, SLUG_MAX_LENGTH)
}

function trimToLength(slug: string, max: number): string {
  return slug.length <= max ? slug : slug.slice(0, max).replace(/-+$/, '')
}

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value)
}

/**
 * slugify(base), or with -2, -3, ... appended until `exists` says it is free.
 * The suffixed slug still fits SLUG_MAX_LENGTH. An empty base becomes
 * "product"; a reserved word gets a suffix ("new" -> "new-2"). `exists`
 * must cover live slugs AND old (redirect) slugs.
 */
export function uniqueSlug(base: string, exists: (slug: string) => boolean): string {
  const root = slugify(base) || FALLBACK_SLUG
  const taken = (s: string) => isReservedSlug(s) || exists(s)
  if (!taken(root)) return root
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${trimToLength(root, SLUG_MAX_LENGTH - suffix.length)}${suffix}`
    if (!taken(candidate)) return candidate
  }
}

export type SlugChangeInput = {
  productId: number
  currentSlug: string | null
  /** Requested slug; normalised with slugify. */
  newSlug: string
  /** Product that currently has the new slug as its live slug, if any. */
  liveOwnerId: number | null
  /** Product that the new slug redirects to, if any. */
  redirectOwnerId: number | null
}

export type SlugChangePlan =
  | {
      ok: true
      changed: boolean
      slug: string
      /** Old slug to record as a redirect to this product. */
      addRedirect: string | null
      /** This product's own redirect to delete, because the slug is live again. */
      removeRedirect: string | null
    }
  | { ok: false; error: string }

/**
 * Decide what a slug change does. Invariant kept: no redirect's oldSlug is
 * ever a live slug, and redirects point at products (not slugs), so they
 * cannot chain or loop.
 */
export function planSlugChange(input: SlugChangeInput): SlugChangePlan {
  const slug = slugify(input.newSlug)
  if (!slug) return { ok: false, error: 'Slug must contain at least one letter or digit' }
  if (isReservedSlug(slug)) {
    return { ok: false, error: `Slug "${slug}" is reserved for the website; choose another (e.g. "${slug}-1")` }
  }
  if (slug === input.currentSlug) {
    return { ok: true, changed: false, slug, addRedirect: null, removeRedirect: null }
  }
  if (input.liveOwnerId !== null && input.liveOwnerId !== input.productId) {
    return { ok: false, error: `Slug "${slug}" is already used by another product` }
  }
  if (input.redirectOwnerId !== null && input.redirectOwnerId !== input.productId) {
    return { ok: false, error: `Slug "${slug}" is an old address of another product` }
  }
  return {
    ok: true,
    changed: true,
    slug,
    addRedirect: input.currentSlug,
    removeRedirect: input.redirectOwnerId === input.productId ? slug : null,
  }
}
