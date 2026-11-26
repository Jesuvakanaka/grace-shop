// Listing draft type and validation. Pure.
import {
  ALT_TEXT_MAX,
  PUBLIC_DESCRIPTION_MAX,
  PUBLIC_NAME_MAX,
  SHORT_TEXT_MAX,
} from '@/lib/website/labels'

export const DETAILS_MAX = 12

export type ListingDraft = {
  publicName: string
  description: string
  categoryId: number | null
  colours: string | null
  sizes: string | null
  fabric: string | null
  care: string | null
  altText: string
  details: string[]
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max).trim() : ''
}

function optStr(v: unknown, max: number): string | null {
  return str(v, max) || null
}

export function parseListingDraft(value: unknown, categoryIds: number[]): ListingDraft {
  const o = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const cat = typeof o.categoryId === 'number' && categoryIds.includes(o.categoryId) ? o.categoryId : null
  const details = (Array.isArray(o.details) ? o.details : [])
    .map((d) => str(d, SHORT_TEXT_MAX))
    .filter(Boolean)
    .slice(0, DETAILS_MAX)
  return {
    publicName: str(o.publicName, PUBLIC_NAME_MAX),
    description: str(o.description, PUBLIC_DESCRIPTION_MAX),
    categoryId: cat,
    colours: optStr(o.colours, SHORT_TEXT_MAX),
    sizes: optStr(o.sizes, SHORT_TEXT_MAX),
    fabric: optStr(o.fabric, SHORT_TEXT_MAX),
    care: optStr(o.care, SHORT_TEXT_MAX),
    altText: str(o.altText, ALT_TEXT_MAX),
    details,
  }
}
