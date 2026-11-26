// VYRA Marketing hub (ZP-1200): small input validators. Pure. Throw WebsiteError 400.
import { WebsiteError } from '@/lib/website/http'

const bad = (message: string, field: string) => new WebsiteError(400, message, { field })

export function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new WebsiteError(400, 'Expected a JSON object.')
  return body as Record<string, unknown>
}

export function onlyKeys(o: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw bad(`Unknown field "${k}"`, k)
}

export function text(v: unknown, field: string, max: number, opts: { required?: boolean } = {}): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (opts.required) throw bad(`${field} is required.`, field)
    return null
  }
  if (typeof v !== 'string') throw bad(`${field} must be text.`, field)
  const t = v.trim()
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(t)) throw bad(`${field} has characters that are not allowed.`, field)
  if (t.length > max) throw bad(`${field} is too long (at most ${max} characters).`, field)
  return t
}

export function requiredText(v: unknown, field: string, max: number): string {
  return text(v, field, max, { required: true }) as string
}

export function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw bad(`${field} must be a whole number from ${min} to ${max}.`, field)
  }
  return v
}

export function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw bad(`${field} must be true or false.`, field)
  return v
}

export function oneOf<T extends string>(v: unknown, field: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    throw bad(`${field} must be one of: ${values.join(', ')}.`, field)
  }
  return v as T
}

export function date(v: unknown, field: string): Date | null {
  if (v === null || v === '') return null
  if (typeof v !== 'string') throw bad(`${field} must be a date.`, field)
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw bad(`${field} is not a valid date.`, field)
  return d
}

export function idList(v: unknown, field: string, max = 200): number[] {
  if (!Array.isArray(v) || v.length > max) throw bad(`${field} must be a list of at most ${max} ids.`, field)
  const ids = v.map((x) => {
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 1) throw bad(`${field} has an invalid id.`, field)
    return x
  })
  return [...new Set(ids)]
}

/** Storage keys of product images: short strings without path tricks. */
export function imageKeys(v: unknown, field: string, max = 10): string[] {
  if (!Array.isArray(v) || v.length > max) throw bad(`${field} must be a list of at most ${max} photos.`, field)
  return v.map((k) => {
    if (typeof k !== 'string' || k.length === 0 || k.length > 200 || !/^[A-Za-z0-9._\/-]+$/.test(k) || k.includes('..')) {
      throw bad(`${field} has an invalid photo key.`, field)
    }
    return k
  })
}
